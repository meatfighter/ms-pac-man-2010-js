import "./styles.css";
import type { GameContainer } from "slick2d-ts";
import { RESOURCE_REFS } from "./resourceManifest";
import { APP_VERSION, CACHE_BUST } from "./version";
import type { Main as MsPacManMain } from "../mspacman/Main";
import { MsPacManGameStateStore } from "../mspacman/persistence/MsPacManGameStateStore";

type SlickRuntime = typeof import("slick2d-ts");

type RuntimeInput = {
    clearKeyPressedRecord(): void;
    pause(): void;
    resume(): void;
};

type RuntimeContainer = {
    destroy(): void;
    getInput(): RuntimeInput;
    isFullscreen(): boolean;
    setAlwaysRender(alwaysRender: boolean): void;
    setClearEachFrame(clearEachFrame: boolean): void;
    setDisplayMode(width: number, height: number, fullscreen: boolean): Promise<void> | void;
    setErrorHandler(errorHandler: (error: unknown) => void): void;
    setHighDpiEnabled(enabled: boolean): void;
    setLoopSuspended(suspended: boolean): void;
    setMaxDevicePixelRatio(maxDevicePixelRatio: number): void;
    setMusicVolume(volume: number): void;
    setShowFPS(showFPS: boolean): void;
    setSmoothDeltas(smoothDeltas: boolean): void;
    setSoundVolume(volume: number): void;
    setVSync(vsync: boolean): void;
    start(): Promise<void>;
    stopSoundEffects(): void;
};

const app = document.querySelector<HTMLDivElement>("#app");
const GAME_CURSOR_HIDE_DELAY_MS = 3000;
const HIGH_DPI_ENABLED = true;
const MAX_DEVICE_PIXEL_RATIO = 2;

if (!app) {
    throw new Error("Missing #app root.");
}

let slickRuntime: SlickRuntime | null = null;
let container: RuntimeContainer | null = null;
let game: MsPacManMain | null = null;
let activeGameHost: HTMLElement | null = null;
let menuOverlay: HTMLElement | null = null;
let resizeObserver: ResizeObserver | null = null;
let resizeAnimationFrame = 0;
let hamburgerVisibilityAnimationFrame = 0;
let cursorGameHost: HTMLElement | null = null;
let cursorHideTimer = 0;
let pointerOverGameHost = false;
let liveMenuOpen = false;
let suspendedByVisibilityLoss = document.visibilityState !== "visible";
let suspendedByFocusLoss = !document.hasFocus();
let runtimeResourcesLoaded = false;
let runtimeGameLoadingCompleted = false;
let volume = safeReadVolume();
const gameStateStore = new MsPacManGameStateStore(APP_VERSION);

setupGlobalErrorHandlers();
setupPageLifecycleHandlers();
void registerServiceWorker();
renderMenu();

function renderMenu(errorText = ""): void {
    destroyGame();
    const canContinue = gameStateStore.hasValidSave();
    renderMenuUi(app, canContinue, errorText, false);
}

function renderMenuUi(parent: HTMLElement, canContinue: boolean, errorText: string, overlay: boolean): HTMLElement {
    const menuRoot = document.createElement("main");
    menuRoot.className = overlay ? "shell menu-overlay" : "shell";
    if (overlay) {
        menuRoot.dataset.liveMenu = "true";
    }
    menuRoot.innerHTML = `
        <section class="menu" aria-label="Ms. Pac-Man 2010 menu">
            <div class="menu-actions">
                <div class="volume-control">
                    <span class="volume-icon" id="volumeIcon" aria-hidden="true">${volumeIcon(volume)}</span>
                    <input id="volumeInput" type="range" min="0" max="100" step="1" value="${Math.round(volume * 100)}" aria-label="Volume">
                    <span class="volume-value" id="volumeValue">${Math.round(volume * 100)}</span>
                </div>
                <div class="menu-buttons">
                    <button id="newGameButton" class="start-button" type="button">New Game</button>
                    <button id="continueButton" class="start-button" type="button"${canContinue ? "" : " disabled"}>Continue</button>
                </div>
                ${errorText ? `<p class="error-text">${escapeHtml(errorText)}</p>` : ""}
            </div>
        </section>
    `;
    if (overlay) {
        parent.appendChild(menuRoot);
    } else {
        parent.replaceChildren(menuRoot);
    }

    const volumeInput = menuRoot.querySelector<HTMLInputElement>("#volumeInput");
    const volumeValue = menuRoot.querySelector<HTMLElement>("#volumeValue");
    const newGameButton = menuRoot.querySelector<HTMLButtonElement>("#newGameButton");
    const continueButton = menuRoot.querySelector<HTMLButtonElement>("#continueButton");

    volumeInput?.addEventListener("input", () => {
        volume = Number(volumeInput.value) / 100;
        writeVolume(volume);
        updateVolumeUi(volumeInput, volumeValue);
        applyVolume();
    });
    if (volumeInput) {
        updateVolumeUi(volumeInput, volumeValue);
    }

    newGameButton?.addEventListener("click", () => {
        gameStateStore.clear();
        destroyGame();
        void startGame(false);
    });

    continueButton?.addEventListener("click", () => {
        if (hasLiveSuspendedGame()) {
            resumeLiveGameFromMenu();
            return;
        }
        void startGame(true);
    });

    return menuRoot;
}

async function startGame(restoreSavedGame: boolean): Promise<void> {
    try {
        await configureSlickRuntime();
        await unlockAudio();
        if (!runtimeResourcesLoaded) {
            renderBoot(0);
            await preloadResources((loaded, total) => {
                renderBoot(loaded / total);
            });
            runtimeResourcesLoaded = true;
        }
        renderGameHost();
        await mountGame(restoreSavedGame);
    } catch (error) {
        console.error(error);
        renderLoadError(error, restoreSavedGame);
    }
}

function renderBoot(progress: number): void {
    const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
    app.innerHTML = `
        <main class="shell">
            <section class="boot" aria-live="polite">
                <div class="progress-shell" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
                    <div class="progress-bar" style="--progress: ${percent}%"></div>
                </div>
            </section>
        </main>
    `;
}

function renderLoadError(error: unknown, restoreSavedGame = false): void {
    void error;
    app.innerHTML = `
        <main class="shell">
            <section class="boot boot-error">
                <div class="failure-icon" aria-hidden="true">&#x1F480;</div>
                <div class="boot-title">Unable to start.</div>
                <p class="error-text">Check your connection and try again.</p>
                <button id="retryButton" class="retry-button" type="button">Retry</button>
            </section>
        </main>
    `;
    document.querySelector<HTMLButtonElement>("#retryButton")?.addEventListener("click", () => {
        void startGame(restoreSavedGame);
    });
}

function renderGameHost(): void {
    app.innerHTML = `
        <div class="game-host" id="gameHost"></div>
        <button class="hamburger" id="menuButton" type="button" aria-label="Return to menu" title="Return to menu" hidden>
            <span></span>
        </button>
    `;
    document.querySelector<HTMLButtonElement>("#menuButton")?.addEventListener("click", () => {
        returnToMenu();
    });
}

async function mountGame(restoreSavedGame: boolean): Promise<void> {
    const host = document.querySelector<HTMLDivElement>("#gameHost");
    if (!host) {
        throw new Error("Missing game host.");
    }

    const skipInternalLoadingScreen = runtimeGameLoadingCompleted;
    const [{ AppGameContainer, Display, ResourceLoader }, { Main }, { ScalableGame2 }] = await Promise.all([
        getSlickRuntime(),
        import("../mspacman/Main"),
        import("../mspacman/ScalableGame2")
    ]);

    const mainGame = new Main();
    const scalableGame = new ScalableGame2(mainGame, 800, 600, true);
    const appContainer = new AppGameContainer(scalableGame);
    appContainer.setHighDpiEnabled(HIGH_DPI_ENABLED);
    appContainer.setMaxDevicePixelRatio(MAX_DEVICE_PIXEL_RATIO);
    container = appContainer;
    mainGame.scalableGame = scalableGame;
    mainGame.appGameContainer = appContainer;
    mainGame.windowedDisplayModeProvider = getResponsiveWindowedDisplayMode;
    mainGame.pauseStateChangeHandler = handleGamePauseStateChanged;
    game = mainGame;
    if (restoreSavedGame) {
        mainGame.loadingCompleteHandler = (gc: GameContainer): boolean => {
            if (!gameStateStore.restore(mainGame, gc)) {
                throw new Error("Saved game could not be restored.");
            }
            return true;
        };
    }

    Display.setParent(host);
    container.setErrorHandler((error) => {
        renderLoadError(error, restoreSavedGame);
    });
    activeGameHost = host;
    const displayMode = getResponsiveWindowedDisplayMode();
    await container.setDisplayMode(displayMode.width, displayMode.height, false);
    container.setAlwaysRender(true);
    container.setVSync(true);
    container.setSmoothDeltas(false);
    container.setShowFPS(false);
    container.setClearEachFrame(true);
    await container.start();
    if (skipInternalLoadingScreen) {
        mainGame.completeLoadingImmediately(appContainer);
        runtimeGameLoadingCompleted = true;
        await ResourceLoader.waitForAll();
    }
    startResponsiveGameSizing(host);
    startGameCursorAutoHide(host);
    startHamburgerVisibilityMonitor();
    applyVolume();
}

async function preloadResources(onProgress: (loaded: number, total: number, ref: string) => void): Promise<void> {
    const { ResourceLoader } = await getSlickRuntime();
    ResourceLoader.clearFailures();
    ResourceLoader.setCacheBust(CACHE_BUST);
    ResourceLoader.setRetryOptions(3, 300);
    for (let i = 0; i < RESOURCE_REFS.length; i++) {
        const ref = RESOURCE_REFS[i];
        await ResourceLoader.loadResource(ref);
        onProgress(i + 1, RESOURCE_REFS.length, ref);
    }
}

async function unlockAudio(): Promise<void> {
    const { SoundStore } = await getSlickRuntime();
    const context = SoundStore.get().getAudioContext();
    if (context && context.state !== "running") {
        await context.resume();
    }
}

function applyVolume(): void {
    writeVolume(volume);
    const musicVolume = volume;
    const soundVolume = Math.sqrt(volume);
    if (slickRuntime) {
        slickRuntime.SoundStore.get().setMusicVolume(musicVolume);
        slickRuntime.SoundStore.get().setSoundVolume(soundVolume);
    }
    container?.setMusicVolume(musicVolume);
    container?.setSoundVolume(soundVolume);
}

function updateVolumeUi(volumeInput: HTMLInputElement, volumeValue: HTMLElement | null): void {
    const volumePercent = Math.round(volume * 100);
    const volumeIconElement = document.querySelector<HTMLElement>("#volumeIcon");
    volumeInput.style.setProperty("--thumb-position", `${volumePercent}%`);
    if (volumeValue) {
        volumeValue.textContent = String(volumePercent);
    }
    if (volumeIconElement) {
        volumeIconElement.innerHTML = volumeIcon(volume);
    }
}

function volumeIcon(value: number): string {
    const waves = Math.round(value * 100) === 0
        ? `<path d="M18 9l5 5m0-5l-5 5"></path>`
        : value < 0.33
            ? `<path d="M17 10a4 4 0 0 1 0 4"></path>`
            : value < 0.66
                ? `<path d="M17 8a6 6 0 0 1 0 8"></path><path d="M20 6a9 9 0 0 1 0 12"></path>`
                : `<path d="M17 8a6 6 0 0 1 0 8"></path><path d="M20 6a9 9 0 0 1 0 12"></path><path d="M23 4a12 12 0 0 1 0 16"></path>`;

    return `
        <svg viewBox="0 0 26 24" focusable="false" aria-hidden="true">
            <path d="M3 9v6h5l6 5V4L8 9H3z"></path>
            ${waves}
        </svg>
    `;
}

function destroyGame(): void {
    removeMenuOverlay();
    stopHamburgerVisibilityMonitor();
    stopGameCursorAutoHide();
    stopResponsiveGameSizing();
    game?.stopAllSounds();
    container?.destroy();
    container = null;
    game = null;
    slickRuntime?.Display.setParent(null);
}

function saveCurrentGameState(): boolean {
    if (!game || !game.isStateSaveReady()) {
        return false;
    }
    return gameStateStore.save(game);
}

function hasLiveSuspendedGame(): boolean {
    return liveMenuOpen
        && menuOverlay !== null
        && game !== null
        && container !== null
        && activeGameHost !== null
        && !game.isLoadingScreenActive();
}

function showLiveMenuOverlay(): void {
    if (!game || !container || !activeGameHost || liveMenuOpen) {
        return;
    }

    liveMenuOpen = true;
    game.setBrowserSuspended(true);
    container.stopSoundEffects();
    container.setLoopSuspended(true);
    container.getInput().pause();
    game.input.clearKeyPressedRecord();
    saveCurrentGameState();
    stopHamburgerVisibilityMonitor();
    setHamburgerHidden(true);
    stopGameCursorAutoHide();
    menuOverlay = renderMenuUi(app, true, "", true);
}

function resumeLiveGameFromMenu(): void {
    const currentGame = game;
    const currentContainer = container;
    const host = activeGameHost;
    if (!liveMenuOpen || !menuOverlay || !currentGame || !currentContainer || !host) {
        destroyGame();
        void startGame(true);
        return;
    }

    removeMenuOverlay();
    currentContainer.getInput().resume();
    currentContainer.getInput().clearKeyPressedRecord();
    currentGame.input.clearKeyPressedRecord();
    startGameCursorAutoHide(host);
    startHamburgerVisibilityMonitor();
    applyVolume();
    scheduleResponsiveGameResize();
    focusGameCanvas();
    syncCurrentGameLifecycleState();
}

function removeMenuOverlay(): void {
    menuOverlay?.remove();
    menuOverlay = null;
    liveMenuOpen = false;
}

function focusGameCanvas(): void {
    const canvas = activeGameHost?.querySelector<HTMLCanvasElement>("canvas");
    if (!canvas) {
        return;
    }
    canvas.tabIndex = -1;
    canvas.focus({ preventScroll: true });
}

function returnToMenu(): void {
    if (game?.isLoadingScreenActive()) {
        return;
    }
    if (game && container && activeGameHost && game.isStateSaveReady()) {
        showLiveMenuOverlay();
        return;
    }
    game?.setBrowserSuspended(true);
    container?.stopSoundEffects();
    saveCurrentGameState();
    renderMenu();
}

function suspendCurrentGame(): void {
    if (!game || game.isLoadingScreenActive()) {
        return;
    }
    game.setBrowserSuspended(true);
    container?.stopSoundEffects();
    container?.setLoopSuspended(true);
    saveCurrentGameState();
}

function resumeCurrentGame(): void {
    syncCurrentGameLifecycleState();
}

function syncCurrentGameLifecycleState(): void {
    if (!game || game.isLoadingScreenActive()) {
        return;
    }
    if (liveMenuOpen || suspendedByVisibilityLoss || suspendedByFocusLoss || document.visibilityState !== "visible" || !document.hasFocus()) {
        suspendCurrentGame();
    } else {
        game.setBrowserSuspended(false);
        container?.setLoopSuspended(false);
    }
}

function startGameCursorAutoHide(host: HTMLElement): void {
    stopGameCursorAutoHide();
    cursorGameHost = host;
    pointerOverGameHost = isElementHovered(host);
    host.addEventListener("pointerenter", handleGamePointerEnter);
    host.addEventListener("pointerleave", handleGamePointerLeave);
    host.addEventListener("pointermove", handleGameMouseInput);
    host.addEventListener("pointerdown", handleGameMouseInput);
    host.addEventListener("pointerup", handleGameMouseInput);
    host.addEventListener("wheel", handleGameMouseInput, { passive: true });
    showGameCursor();
    scheduleGameCursorHide();
}

function stopGameCursorAutoHide(): void {
    if (cursorGameHost) {
        cursorGameHost.removeEventListener("pointerenter", handleGamePointerEnter);
        cursorGameHost.removeEventListener("pointerleave", handleGamePointerLeave);
        cursorGameHost.removeEventListener("pointermove", handleGameMouseInput);
        cursorGameHost.removeEventListener("pointerdown", handleGameMouseInput);
        cursorGameHost.removeEventListener("pointerup", handleGameMouseInput);
        cursorGameHost.removeEventListener("wheel", handleGameMouseInput);
        cursorGameHost.classList.remove("cursor-hidden");
    }
    clearGameCursorHideTimer();
    pointerOverGameHost = false;
    cursorGameHost = null;
}

function handleGamePointerEnter(): void {
    pointerOverGameHost = true;
    handleGameMouseInput();
}

function handleGamePointerLeave(): void {
    pointerOverGameHost = false;
    showGameCursor();
    clearGameCursorHideTimer();
}

function handleGameMouseInput(): void {
    showGameCursor();
    scheduleGameCursorHide();
}

function handleGamePauseStateChanged(paused: boolean): void {
    showGameCursor();
    if (paused) {
        clearGameCursorHideTimer();
    } else {
        scheduleGameCursorHide();
    }
}

function scheduleGameCursorHide(): void {
    clearGameCursorHideTimer();
    if (!cursorGameHost || !pointerOverGameHost || game?.paused) {
        return;
    }
    cursorHideTimer = window.setTimeout(() => {
        cursorHideTimer = 0;
        hideGameCursorIfIdle();
    }, GAME_CURSOR_HIDE_DELAY_MS);
}

function hideGameCursorIfIdle(): void {
    if (!cursorGameHost || !pointerOverGameHost || game?.paused) {
        showGameCursor();
        return;
    }
    cursorGameHost.classList.add("cursor-hidden");
}

function showGameCursor(): void {
    cursorGameHost?.classList.remove("cursor-hidden");
}

function clearGameCursorHideTimer(): void {
    if (cursorHideTimer !== 0) {
        clearTimeout(cursorHideTimer);
        cursorHideTimer = 0;
    }
}

function isElementHovered(element: HTMLElement): boolean {
    try {
        return element.matches(":hover");
    } catch {
        return false;
    }
}

function startHamburgerVisibilityMonitor(): void {
    stopHamburgerVisibilityMonitor();
    updateHamburgerVisibility();
}

function stopHamburgerVisibilityMonitor(): void {
    if (hamburgerVisibilityAnimationFrame !== 0) {
        cancelAnimationFrame(hamburgerVisibilityAnimationFrame);
        hamburgerVisibilityAnimationFrame = 0;
    }
}

function updateHamburgerVisibility(): void {
    const hidden = game === null || game.isLoadingScreenActive();
    setHamburgerHidden(hidden);
    if (!hidden) {
        runtimeGameLoadingCompleted = true;
        syncCurrentGameLifecycleState();
    }
    if (hidden && game !== null) {
        hamburgerVisibilityAnimationFrame = requestAnimationFrame(() => {
            hamburgerVisibilityAnimationFrame = 0;
            updateHamburgerVisibility();
        });
    }
}

function setHamburgerHidden(hidden: boolean): void {
    const hamburger = document.querySelector<HTMLButtonElement>("#menuButton");
    if (hamburger) {
        hamburger.hidden = hidden;
    }
}

function startResponsiveGameSizing(host: HTMLElement): void {
    stopResponsiveGameSizing();
    activeGameHost = host;
    if ("ResizeObserver" in window) {
        resizeObserver = new ResizeObserver(scheduleResponsiveGameResize);
        resizeObserver.observe(host);
    }
    window.addEventListener("resize", scheduleResponsiveGameResize);
    document.addEventListener("fullscreenchange", scheduleResponsiveGameResize);
    scheduleResponsiveGameResize();
}

function stopResponsiveGameSizing(): void {
    resizeObserver?.disconnect();
    resizeObserver = null;
    activeGameHost = null;
    window.removeEventListener("resize", scheduleResponsiveGameResize);
    document.removeEventListener("fullscreenchange", scheduleResponsiveGameResize);
    if (resizeAnimationFrame !== 0) {
        cancelAnimationFrame(resizeAnimationFrame);
        resizeAnimationFrame = 0;
    }
}

function scheduleResponsiveGameResize(): void {
    if (resizeAnimationFrame !== 0) {
        return;
    }
    resizeAnimationFrame = requestAnimationFrame(() => {
        resizeAnimationFrame = 0;
        applyResponsiveWindowedDisplayMode();
    });
}

function applyResponsiveWindowedDisplayMode(): void {
    if (!container || !activeGameHost || container.isFullscreen() || document.fullscreenElement !== null) {
        return;
    }

    const displayMode = getResponsiveWindowedDisplayMode();
    try {
        void Promise.resolve(container.setDisplayMode(displayMode.width, displayMode.height, false))
            .catch(reportResponsiveResizeError);
    } catch (error) {
        reportResponsiveResizeError(error);
    }
}

function reportResponsiveResizeError(error: unknown): void {
    console.error(error);
    renderLoadError(error);
}

function getResponsiveWindowedDisplayMode(): { width: number; height: number } {
    const host = activeGameHost ?? document.querySelector<HTMLElement>("#gameHost");
    const fallbackWidth = window.innerWidth || 800;
    const fallbackHeight = window.innerHeight || 600;
    if (!host) {
        return {
            width: Math.max(1, Math.trunc(fallbackWidth)),
            height: Math.max(1, Math.trunc(fallbackHeight))
        };
    }

    const rect = host.getBoundingClientRect();
    const width = host.clientWidth || rect.width || fallbackWidth;
    const height = host.clientHeight || rect.height || fallbackHeight;
    return {
        width: Math.max(1, Math.trunc(width)),
        height: Math.max(1, Math.trunc(height))
    };
}

async function configureSlickRuntime(): Promise<void> {
    const { ResourceLoader } = await getSlickRuntime();
    ResourceLoader.clearFailures();
    ResourceLoader.setCacheBust(CACHE_BUST);
    ResourceLoader.setRetryOptions(3, 300);
}

async function getSlickRuntime(): Promise<SlickRuntime> {
    if (!slickRuntime) {
        slickRuntime = await import("slick2d-ts");
    }
    return slickRuntime;
}

function setupGlobalErrorHandlers(): void {
    window.addEventListener("error", (event) => {
        showStartupError(event.error ?? event.message);
    });
    window.addEventListener("unhandledrejection", (event) => {
        showStartupError(event.reason);
    });
}

function setupPageLifecycleHandlers(): void {
    window.addEventListener("pagehide", () => {
        suspendedByVisibilityLoss = true;
        syncCurrentGameLifecycleState();
    });
    window.addEventListener("pageshow", () => {
        suspendedByVisibilityLoss = document.visibilityState !== "visible";
        suspendedByFocusLoss = !document.hasFocus();
        syncCurrentGameLifecycleState();
    });
    window.addEventListener("blur", () => {
        suspendedByFocusLoss = true;
        syncCurrentGameLifecycleState();
    });
    window.addEventListener("focus", () => {
        suspendedByFocusLoss = false;
        resumeCurrentGame();
    });
    document.addEventListener("visibilitychange", () => {
        suspendedByVisibilityLoss = document.visibilityState !== "visible";
        syncCurrentGameLifecycleState();
    });
}

function showStartupError(error: unknown): void {
    if (app.childElementCount === 0) {
        renderMenu(formatError(error));
    }
}

function safeReadVolume(): number {
    try {
        return readVolume();
    } catch {
        return 0.1;
    }
}

function readVolume(): number {
    const value = Number.parseInt(localStorage.getItem("ms-pac-man-volume") ?? "10", 10);
    if (!Number.isFinite(value)) {
        return 0.1;
    }
    return Math.max(0, Math.min(1, value / 100));
}

function writeVolume(value: number): void {
    try {
        localStorage.setItem("ms-pac-man-volume", String(Math.round(value * 100)));
    } catch {
        // Local storage is optional; audio volume still applies in memory.
    }
}

async function registerServiceWorker(): Promise<void> {
    if (!("serviceWorker" in navigator)) {
        return;
    }
    if (import.meta.env.DEV) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
        return;
    }
    try {
        await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js?v=${encodeURIComponent(CACHE_BUST)}`, {
            scope: import.meta.env.BASE_URL
        });
    } catch {
        // The game still runs without PWA registration.
    }
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
