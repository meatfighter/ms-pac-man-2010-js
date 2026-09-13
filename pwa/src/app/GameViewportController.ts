import type { AppGameContainer } from "slick2d-ts";
import {
    exitBrowserFullscreen,
    getBrowserFullscreenCapability,
    getBrowserFullscreenElement,
    requestBrowserFullscreen,
    type BrowserFullscreenCapability
} from "slick2d-ts/slick/util/BrowserFullscreen";

const GAME_WIDTH = 800;
const GAME_HEIGHT = 600;
const GAME_CURSOR_HIDE_DELAY_MS = 3000;
const FULLSCREEN_REQUEST_SETTLE_TIMEOUT_MS = 1500;
const FULLSCREEN_CHANGE_EVENTS = ["fullscreenchange", "webkitfullscreenchange"] as const;

type DisplayMode = { width: number; height: number };

type PendingFullscreenRequest = Readonly<{
    shell: HTMLElement;
    presentation: number;
    promise: Promise<boolean>;
}>;

export interface GameViewportCallbacks {
    readonly isSessionCurrent: (session: number) => boolean;
    readonly isGameplayActive: () => boolean;
    readonly isGameplayRunning: () => boolean;
    readonly returnToMenu: () => void;
    readonly fullscreenExited: () => void;
    readonly reportResizeError: (error: unknown) => void;
}

export class GameViewportController {
    private shell: HTMLElement | null = null;
    private host: HTMLElement | null = null;
    private container: AppGameContainer | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private resizeAnimationFrame = 0;
    private fullscreenResizeSettleAnimationFrame = 0;
    private cursorHost: HTMLElement | null = null;
    private cursorHideTimer = 0;
    private pointerOverHost = false;
    private sessionGeneration = 0;
    private presentationGeneration = 0;
    private shellWasFullscreen = false;
    private fullscreenEntryAuthorized = false;
    private fullscreenRequestSerial = 0;
    private fullscreenSuppressedPresentation: number | null = null;
    private visibilityTransitionSerial = 0;
    private readonly pendingFullscreenRequests = new Set<PendingFullscreenRequest>();
    private readonly retiredFullscreenShells = new WeakSet<HTMLElement>();

    public constructor(
        private readonly root: HTMLElement,
        private readonly callbacks: GameViewportCallbacks
    ) {
        this.addFullscreenChangeListener(this.handleFullscreenChange);
    }

    public attach(container: AppGameContainer, sessionGeneration: number): void {
        this.container = container;
        this.sessionGeneration = sessionGeneration;
    }

    public get gameHost(): HTMLElement | null {
        return this.host;
    }

    public get gameShell(): HTMLElement | null {
        return this.shell;
    }

    public getFullscreenCapability(): BrowserFullscreenCapability {
        return getBrowserFullscreenCapability();
    }

    public createShell(sessionGeneration: number): HTMLElement {
        if (this.shell !== null) {
            throw new Error("The previous Ms. Pac-Man game shell must be cleared before creating another one.");
        }
        this.presentationGeneration++;
        this.fullscreenRequestSerial = 0;
        this.fullscreenEntryAuthorized = false;
        this.fullscreenSuppressedPresentation = null;
        this.root.innerHTML = `
            <div id="game-shell" class="game-shell">
                <div class="game-host" id="gameHost"></div>
                <button class="hamburger" id="menuButton" type="button" aria-label="Return to menu" hidden>
                    <span></span>
                </button>
            </div>
        `;
        const shell = this.root.querySelector<HTMLElement>("#game-shell");
        const host = this.root.querySelector<HTMLElement>("#gameHost");
        const hamburger = this.root.querySelector<HTMLButtonElement>("#menuButton");
        if (shell === null || host === null || hamburger === null) {
            throw new Error("Unable to create the Ms. Pac-Man game shell.");
        }
        this.shell = shell;
        this.host = host;
        this.sessionGeneration = sessionGeneration;
        this.shellWasFullscreen = false;
        hamburger.addEventListener("click", this.callbacks.returnToMenu);
        return host;
    }

    public clear(): void {
        const targetShell = this.shell;
        const targetPresentation = this.presentationGeneration;
        this.fullscreenRequestSerial++;
        this.fullscreenEntryAuthorized = false;
        this.fullscreenSuppressedPresentation = null;
        this.discardPendingFullscreenRequests(targetShell, targetPresentation);
        if (targetShell !== null) {
            this.retiredFullscreenShells.add(targetShell);
        }

        const targetIsFullscreen = targetShell !== null && getBrowserFullscreenElement() === targetShell;
        let visibilityTransition = 0;
        let fullscreenExit: Promise<boolean> | null = null;
        if (targetIsFullscreen && targetShell !== null) {
            visibilityTransition = ++this.visibilityTransitionSerial;
            this.root.style.visibility = "hidden";
            fullscreenExit = this.requestExitForSpecificShell(targetShell);
        }

        this.stopHamburgerVisibilityMonitor();
        this.stopCursorAutoHide();
        this.stopResponsiveSizing();
        this.shellWasFullscreen = false;
        this.shell = null;
        this.host = null;
        this.container = null;
        this.presentationGeneration++;

        if (fullscreenExit !== null && targetShell !== null) {
            void fullscreenExit.finally(() => {
                this.retiredFullscreenShells.delete(targetShell);
                if (visibilityTransition === this.visibilityTransitionSerial) {
                    this.root.style.visibility = "";
                }
            });
        }
    }

    public focusCanvas(): void {
        const canvas = this.host?.querySelector<HTMLCanvasElement>("canvas");
        if (canvas === null || canvas === undefined) {
            return;
        }
        try {
            canvas.focus({ preventScroll: true });
        } catch {
            canvas.focus();
        }
    }

    public hideHamburger(): void {
        const hamburger = this.root.querySelector<HTMLButtonElement>("#menuButton");
        if (hamburger !== null) {
            hamburger.hidden = true;
        }
    }

    public startResponsiveSizing(host: HTMLElement): void {
        this.stopResponsiveSizing();
        this.host = host;
        if ("ResizeObserver" in window) {
            this.resizeObserver = new ResizeObserver(this.scheduleResize);
            this.resizeObserver.observe(host);
        }
        window.addEventListener("resize", this.scheduleResize);
        window.visualViewport?.addEventListener("resize", this.scheduleResize);
        this.reconcileDisplayModeNow();
    }

    public stopResponsiveSizing(): void {
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        window.removeEventListener("resize", this.scheduleResize);
        window.visualViewport?.removeEventListener("resize", this.scheduleResize);
        if (this.resizeAnimationFrame !== 0) {
            cancelAnimationFrame(this.resizeAnimationFrame);
            this.resizeAnimationFrame = 0;
        }
        if (this.fullscreenResizeSettleAnimationFrame !== 0) {
            cancelAnimationFrame(this.fullscreenResizeSettleAnimationFrame);
            this.fullscreenResizeSettleAnimationFrame = 0;
        }
    }

    public scheduleResize = (): void => {
        if (this.resizeAnimationFrame !== 0) {
            return;
        }
        this.resizeAnimationFrame = requestAnimationFrame(() => {
            this.resizeAnimationFrame = 0;
            this.applyDisplayMode();
        });
    };

    public reconcileDisplayModeNow(): void {
        this.applyDisplayMode();
    }

    public getResponsiveDisplayMode(): DisplayMode {
        const host = this.host ?? this.root.querySelector<HTMLElement>("#gameHost");
        const fallback = this.getAvailableDisplayMode();
        if (host === null) {
            return fallback;
        }
        const rect = host.getBoundingClientRect();
        return getAspectFitDisplayMode(host.clientWidth || rect.width || fallback.width, host.clientHeight || rect.height || fallback.height);
    }

    public isFullscreen(): boolean {
        return this.shell !== null && getBrowserFullscreenElement() === this.shell;
    }

    public requestFullscreen(): Promise<boolean> {
        const shell = this.shell;
        const session = this.sessionGeneration;
        const presentation = this.presentationGeneration;
        if (
            shell === null ||
            this.fullscreenSuppressedPresentation === presentation ||
            !this.callbacks.isSessionCurrent(session) ||
            !this.callbacks.isGameplayActive()
        ) {
            return Promise.resolve(false);
        }
        if (this.isFullscreen()) {
            this.fullscreenEntryAuthorized = true;
            this.shellWasFullscreen = true;
            return Promise.resolve(true);
        }

        this.fullscreenEntryAuthorized = true;
        const requestSerial = ++this.fullscreenRequestSerial;
        const promise = requestBrowserFullscreen(shell).then(
            (requested) => {
                const current =
                    requestSerial === this.fullscreenRequestSerial &&
                    presentation === this.presentationGeneration &&
                    this.shell === shell &&
                    this.callbacks.isSessionCurrent(session) &&
                    this.callbacks.isGameplayActive();
                if (!current) {
                    if (requested && getBrowserFullscreenElement() === shell && !this.shouldKeepFullscreenShell(shell)) {
                        void this.requestExitForSpecificShell(shell);
                    }
                    return false;
                }
                if (!requested) {
                    this.fullscreenEntryAuthorized = false;
                    this.shellWasFullscreen = false;
                    this.reconcileDisplayModeNow();
                    return false;
                }
                const established = getBrowserFullscreenElement() === shell;
                if (established) {
                    this.shellWasFullscreen = true;
                    this.updateHamburgerVisibility();
                    this.scheduleFullscreenResize();
                    return true;
                }
                this.reconcileDisplayModeNow();
                return false;
            },
            () => {
                if (
                    requestSerial === this.fullscreenRequestSerial &&
                    presentation === this.presentationGeneration &&
                    this.shell === shell &&
                    this.callbacks.isSessionCurrent(session) &&
                    this.callbacks.isGameplayActive()
                ) {
                    this.fullscreenEntryAuthorized = false;
                    this.shellWasFullscreen = false;
                    this.reconcileDisplayModeNow();
                }
                return false;
            }
        );

        const invocationStillCurrent =
            presentation === this.presentationGeneration &&
            this.shell === shell &&
            this.callbacks.isSessionCurrent(session) &&
            this.callbacks.isGameplayActive();
        if (!invocationStillCurrent) {
            if (presentation === this.presentationGeneration && this.shell === shell) {
                this.fullscreenSuppressedPresentation = presentation;
                this.clearFullscreenSuppressionWhenSettled(promise, shell, presentation);
            }
            return promise;
        }

        const pending: PendingFullscreenRequest = { shell, presentation, promise };
        this.pendingFullscreenRequests.add(pending);
        void promise.finally(() => {
            this.pendingFullscreenRequests.delete(pending);
        });
        this.clearFullscreenSuppressionWhenSettled(promise, shell, presentation);
        return promise;
    }

    public exitFullscreenForMenu(): Promise<boolean> {
        return this.exitFullscreenForPresentation(this.shell, this.presentationGeneration);
    }

    public startHamburgerVisibilityMonitor(): void {
        this.updateHamburgerVisibility();
    }

    public stopHamburgerVisibilityMonitor(): void {
        this.hideHamburger();
    }

    public startCursorAutoHide(host: HTMLElement): void {
        this.stopCursorAutoHide();
        this.cursorHost = host;
        this.pointerOverHost = isElementHovered(host);
        host.addEventListener("pointerenter", this.handlePointerEnter);
        host.addEventListener("pointerleave", this.handlePointerLeave);
        host.addEventListener("pointermove", this.handlePointerInput);
        host.addEventListener("pointerdown", this.handlePointerInput);
        host.addEventListener("pointerup", this.handlePointerInput);
        host.addEventListener("wheel", this.handlePointerInput, { passive: true });
        this.showCursor();
        this.scheduleCursorHide();
    }

    public stopCursorAutoHide(): void {
        if (this.cursorHost !== null) {
            this.cursorHost.removeEventListener("pointerenter", this.handlePointerEnter);
            this.cursorHost.removeEventListener("pointerleave", this.handlePointerLeave);
            this.cursorHost.removeEventListener("pointermove", this.handlePointerInput);
            this.cursorHost.removeEventListener("pointerdown", this.handlePointerInput);
            this.cursorHost.removeEventListener("pointerup", this.handlePointerInput);
            this.cursorHost.removeEventListener("wheel", this.handlePointerInput);
            this.cursorHost.classList.remove("cursor-hidden");
        }
        this.clearCursorHideTimer();
        this.pointerOverHost = false;
        this.cursorHost = null;
    }

    private async exitFullscreenForPresentation(targetShell: HTMLElement | null, targetPresentation: number): Promise<boolean> {
        if (targetShell === null) {
            return true;
        }
        if (targetPresentation === this.presentationGeneration) {
            this.fullscreenRequestSerial++;
            this.fullscreenEntryAuthorized = false;
        }

        const fullscreenExit = getBrowserFullscreenElement() === targetShell ? this.requestExitForSpecificShell(targetShell) : Promise.resolve(true);
        const pendingSettled = await this.waitForPendingFullscreenRequests(targetShell, targetPresentation);
        if (!pendingSettled && targetPresentation === this.presentationGeneration && this.shell === targetShell) {
            this.fullscreenSuppressedPresentation = targetPresentation;
        }
        await fullscreenExit;

        if (getBrowserFullscreenElement() !== targetShell) {
            return true;
        }
        return await this.requestExitForSpecificShell(targetShell);
    }

    private async waitForPendingFullscreenRequests(targetShell: HTMLElement, targetPresentation: number): Promise<boolean> {
        const pending = Array.from(this.pendingFullscreenRequests).filter(
            (request) => request.presentation === targetPresentation && request.shell === targetShell
        );
        if (pending.length === 0) {
            return true;
        }

        let timer = 0;
        try {
            const settled = await Promise.race([
                Promise.all(pending.map((request) => request.promise)).then(() => true),
                new Promise<boolean>((resolve) => {
                    timer = window.setTimeout(() => resolve(false), FULLSCREEN_REQUEST_SETTLE_TIMEOUT_MS);
                })
            ]);
            if (!settled) {
                for (const request of pending) {
                    this.pendingFullscreenRequests.delete(request);
                }
            }
            return settled;
        } finally {
            if (timer !== 0) {
                clearTimeout(timer);
            }
        }
    }

    private clearFullscreenSuppressionWhenSettled(promise: Promise<boolean>, shell: HTMLElement, presentation: number): void {
        void promise.finally(() => {
            if (this.fullscreenSuppressedPresentation === presentation && this.presentationGeneration === presentation && this.shell === shell) {
                this.fullscreenSuppressedPresentation = null;
            }
        });
    }

    private discardPendingFullscreenRequests(targetShell: HTMLElement | null, targetPresentation: number): void {
        if (targetShell === null) {
            return;
        }
        for (const request of Array.from(this.pendingFullscreenRequests)) {
            if (request.presentation === targetPresentation && request.shell === targetShell) {
                this.pendingFullscreenRequests.delete(request);
            }
        }
    }

    private shouldKeepFullscreenShell(shell: HTMLElement): boolean {
        return this.shell === shell && this.fullscreenEntryAuthorized && this.callbacks.isGameplayActive();
    }

    private requestExitForSpecificShell(shell: HTMLElement): Promise<boolean> {
        if (getBrowserFullscreenElement() !== shell) {
            return Promise.resolve(true);
        }
        return new Promise<boolean>((resolve) => {
            let settled = false;
            const finishIfExited = (): void => {
                if (settled || getBrowserFullscreenElement() === shell) {
                    return;
                }
                settled = true;
                this.removeFullscreenChangeListener(finishIfExited);
                resolve(true);
            };
            this.addFullscreenChangeListener(finishIfExited);
            finishIfExited();
            if (settled) {
                return;
            }
            try {
                void exitBrowserFullscreen().then(finishIfExited, finishIfExited);
            } catch {
                // Browser/user may still complete the exit later.
            }
        });
    }

    private hideRootUntilRetiredShellExits(shell: HTMLElement): void {
        this.fullscreenRequestSerial++;
        this.shellWasFullscreen = false;
        this.fullscreenEntryAuthorized = false;
        const visibilityTransition = ++this.visibilityTransitionSerial;
        this.root.style.visibility = "hidden";
        void this.requestExitForSpecificShell(shell).finally(() => {
            this.retiredFullscreenShells.delete(shell);
            if (visibilityTransition === this.visibilityTransitionSerial) {
                this.root.style.visibility = "";
                this.reconcileDisplayModeNow();
            }
        });
    }

    private applyDisplayMode(): void {
        const container = this.container;
        if (container === null || this.host === null) {
            return;
        }
        const fullscreenElement = getBrowserFullscreenElement();
        if (fullscreenElement !== null && fullscreenElement !== this.shell) {
            return;
        }
        const displayMode = this.getResponsiveDisplayMode();
        const session = this.sessionGeneration;
        try {
            void Promise.resolve(container.setDisplayMode(displayMode.width, displayMode.height, false)).catch((error) => {
                if (this.callbacks.isSessionCurrent(session)) {
                    this.callbacks.reportResizeError(error);
                }
            });
        } catch (error) {
            if (this.callbacks.isSessionCurrent(session)) {
                this.callbacks.reportResizeError(error);
            }
        }
    }

    private getAvailableDisplayMode(): DisplayMode {
        const viewport = window.visualViewport;
        return normalizeDisplayMode(
            viewport?.width || window.innerWidth || document.documentElement.clientWidth || GAME_WIDTH,
            viewport?.height || window.innerHeight || document.documentElement.clientHeight || GAME_HEIGHT
        );
    }

    private scheduleFullscreenResize(): void {
        this.scheduleResize();
        queueMicrotask(() => this.reconcileDisplayModeNow());
        if (this.fullscreenResizeSettleAnimationFrame !== 0) {
            cancelAnimationFrame(this.fullscreenResizeSettleAnimationFrame);
        }
        this.fullscreenResizeSettleAnimationFrame = requestAnimationFrame(() => {
            this.fullscreenResizeSettleAnimationFrame = requestAnimationFrame(() => {
                this.fullscreenResizeSettleAnimationFrame = 0;
                this.scheduleResize();
            });
        });
    }

    private readonly handleFullscreenChange = (): void => {
        const fullscreenElement = getBrowserFullscreenElement();
        if (fullscreenElement !== null && this.retiredFullscreenShells.has(fullscreenElement as HTMLElement)) {
            this.hideRootUntilRetiredShellExits(fullscreenElement as HTMLElement);
            return;
        }

        const shell = this.shell;
        const presentation = this.presentationGeneration;
        const current = shell !== null && fullscreenElement === shell;
        if (current && !this.fullscreenEntryAuthorized) {
            this.hideRootUntilRetiredShellExits(shell);
            return;
        }

        const exitedGameplayFullscreen = this.shellWasFullscreen && !current;
        this.shellWasFullscreen = current;
        this.updateHamburgerVisibility();
        this.scheduleFullscreenResize();
        if (shell !== null) {
            queueMicrotask(() => {
                if (this.shell === shell && this.presentationGeneration === presentation) {
                    this.reconcileDisplayModeNow();
                }
            });
        }
        if (current && !this.callbacks.isGameplayActive()) {
            this.hideRootUntilRetiredShellExits(shell);
            return;
        }
        if (exitedGameplayFullscreen && this.callbacks.isGameplayActive()) {
            this.fullscreenEntryAuthorized = false;
            this.callbacks.fullscreenExited();
        }
    };

    private updateHamburgerVisibility(): void {
        const hamburger = this.root.querySelector<HTMLButtonElement>("#menuButton");
        const fullscreenWithoutTouchExit = this.isFullscreen() && !hasTouchCapability();
        const hidden = !this.callbacks.isGameplayRunning() || fullscreenWithoutTouchExit;
        if (hamburger !== null) {
            hamburger.hidden = hidden;
        }
    }

    private addFullscreenChangeListener(listener: EventListener): void {
        if (typeof document === "undefined") {
            return;
        }
        for (const eventName of FULLSCREEN_CHANGE_EVENTS) {
            document.addEventListener(eventName, listener);
        }
    }

    private removeFullscreenChangeListener(listener: EventListener): void {
        if (typeof document === "undefined") {
            return;
        }
        for (const eventName of FULLSCREEN_CHANGE_EVENTS) {
            document.removeEventListener(eventName, listener);
        }
    }

    private readonly handlePointerEnter = (): void => {
        this.pointerOverHost = true;
        this.handlePointerInput();
    };

    private readonly handlePointerLeave = (): void => {
        this.pointerOverHost = false;
        this.showCursor();
        this.clearCursorHideTimer();
    };

    private readonly handlePointerInput = (): void => {
        this.showCursor();
        this.scheduleCursorHide();
    };

    private scheduleCursorHide(): void {
        this.clearCursorHideTimer();
        if (this.cursorHost === null || !this.pointerOverHost) {
            return;
        }
        this.cursorHideTimer = window.setTimeout(() => {
            this.cursorHideTimer = 0;
            if (this.cursorHost === null || !this.pointerOverHost) {
                this.showCursor();
                return;
            }
            this.cursorHost.classList.add("cursor-hidden");
        }, GAME_CURSOR_HIDE_DELAY_MS);
    }

    private showCursor(): void {
        this.cursorHost?.classList.remove("cursor-hidden");
    }

    private clearCursorHideTimer(): void {
        if (this.cursorHideTimer !== 0) {
            clearTimeout(this.cursorHideTimer);
            this.cursorHideTimer = 0;
        }
    }
}

function getAspectFitDisplayMode(width: number, height: number): DisplayMode {
    const displayMode = normalizeDisplayMode(width, height);
    const gameAspectRatio = GAME_WIDTH / GAME_HEIGHT;
    const displayAspectRatio = displayMode.width / displayMode.height;
    if (displayAspectRatio > gameAspectRatio) {
        return normalizeDisplayMode(displayMode.height * gameAspectRatio, displayMode.height);
    }
    return normalizeDisplayMode(displayMode.width, displayMode.width / gameAspectRatio);
}

function normalizeDisplayMode(width: number, height: number): DisplayMode {
    return {
        width: Math.max(1, Math.trunc(width)),
        height: Math.max(1, Math.trunc(height))
    };
}

function hasTouchCapability(): boolean {
    if (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) {
        return true;
    }
    try {
        return typeof window !== "undefined" && window.matchMedia?.("(any-pointer: coarse)").matches === true;
    } catch {
        return false;
    }
}

function isElementHovered(element: HTMLElement): boolean {
    try {
        return element.matches(":hover");
    } catch {
        return false;
    }
}
