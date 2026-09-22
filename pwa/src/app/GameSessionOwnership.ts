/** One writer per deployment, including across save-schema versions. */
export class GameSessionOwnership {
    private acquisitionFailed = false;
    private nativeAcquisitionPending = false;
    private screenGeneration = 0;
    private holdingLock = false;
    private releaseLock: (() => void) | null = null;
    private readonly name = `game-session:${new URL(".", location.href).pathname}`;
    private channel: BroadcastChannel | null = null;
    private channelListener: ((event: MessageEvent<unknown>) => void) | null = null;
    private installed = false;
    private disposed = false;
    private disposing = false;
    private disposeAfterRelease = false;
    private sleeping = false;
    private releasing = false;
    private cleanupFailed = false;
    private attemptSerial = 0;
    private pendingAttempt: number | null = null;
    private ownershipEpoch = 0;
    private finishRetryDelay: (() => void) | null = null;

    public constructor(
        private readonly root: HTMLElement,
        private readonly acquired: () => void,
        private readonly relinquish: () => void
    ) {}

    /** Remains true during synchronous relinquishment so the final save is authorized. */
    public get owned(): boolean {
        return this.holdingLock && !this.cleanupFailed && !this.disposed;
    }

    public get epoch(): number {
        return this.ownershipEpoch;
    }

    /** Startup/async work is forbidden as soon as relinquishment begins. */
    public isCurrent(epoch: number): boolean {
        return this.owned && !this.sleeping && !this.releasing && !this.disposing && epoch === this.ownershipEpoch;
    }

    public start(): void {
        if (this.installed || this.disposed) {
            return;
        }
        this.installed = true;
        if (!this.supportsOwnership()) {
            this.showMessage("This browser cannot safely share saved progress between tabs. Please use a current browser.", false);
            return;
        }
        window.addEventListener("pagehide", this.sleep);
        window.addEventListener("pageshow", this.wake);
        document.addEventListener("freeze", this.sleep);
        document.addEventListener("resume", this.wake);
        document.addEventListener("visibilitychange", this.visible);
        void this.acquire(false);
    }

    /** Failed cleanup retains the native lock and permanently revokes this tab's write capability. */
    public dispose(): void {
        if (this.disposed || this.disposing) {
            return;
        }
        if (this.releasing) {
            this.disposeAfterRelease = true;
            this.invalidateAcquisition();
            return;
        }
        this.disposing = true;
        this.invalidateAcquisition();
        if (!this.release()) {
            this.disposing = false;
            this.showCleanupFailure();
            return;
        }
        this.disposed = true;
        this.disposing = false;
        window.removeEventListener("pagehide", this.sleep);
        window.removeEventListener("pageshow", this.wake);
        document.removeEventListener("freeze", this.sleep);
        document.removeEventListener("resume", this.wake);
        document.removeEventListener("visibilitychange", this.visible);
        this.closeChannel();
    }

    private readonly message = (event: MessageEvent<unknown>): void => {
        if (event.data !== "takeover" || !this.owned || this.disposed || this.releasing) {
            return;
        }
        this.invalidateAcquisition();
        if (this.release()) {
            this.showMessage("Your game moved to another tab.");
        } else {
            this.showCleanupFailure();
        }
    };

    private readonly sleep = (): void => {
        if (this.disposed) {
            return;
        }
        this.sleeping = true;
        this.invalidateAcquisition();
        this.release();
        this.closeChannel();
    };

    private readonly wake = (): void => {
        if (this.disposed || this.disposing || this.releasing || document.visibilityState === "hidden") {
            return;
        }
        this.sleeping = false;
        if (this.acquisitionFailed) {
            this.showMessage("Ownership acquisition did not settle. Reload this tab.", false);
            return;
        }
        if (this.cleanupFailed) {
            this.showCleanupFailure();
            return;
        }
        if (!this.owned) {
            void this.acquire(false);
        }
    };

    private readonly visible = (): void => {
        if (this.sleeping && document.visibilityState === "visible") {
            this.wake();
        }
    };

    private supportsOwnership(): boolean {
        return typeof navigator.locks?.request === "function" && typeof globalThis.BroadcastChannel === "function";
    }

    private openChannel(): void {
        if (this.channel !== null) {
            return;
        }
        const channel = new BroadcastChannel(this.name);
        const listener = (event: MessageEvent<unknown>): void => {
            if (this.channel === channel) {
                this.message(event);
            }
        };
        try {
            channel.addEventListener("message", listener);
            this.channel = channel;
            this.channelListener = listener;
        } catch (error) {
            try {
                channel.close();
            } catch {
                // A partially opened channel must not replace the owned channel.
            }
            throw error;
        }
    }

    private closeChannel(): void {
        const channel = this.channel;
        const listener = this.channelListener;
        this.channel = null;
        this.channelListener = null;
        if (channel === null) {
            return;
        }
        try {
            if (listener !== null) {
                channel.removeEventListener("message", listener);
            }
        } catch (error) {
            console.warn("Unable to detach the old session channel listener.", error);
        }
        try {
            channel.close();
        } catch (error) {
            console.warn("Unable to close the old session channel.", error);
        }
    }

    private release(): boolean {
        if (this.cleanupFailed || this.releasing) {
            return false;
        }
        if (!this.holdingLock) {
            return true;
        }
        this.ownershipEpoch++;
        this.releasing = true;
        try {
            // The lock and final-save capability remain ours until cleanup finishes.
            this.relinquish();
        } catch (error) {
            this.cleanupFailed = true;
            console.error("Unable to relinquish safely; retaining the native lock and requiring reload.", error);
            return false;
        } finally {
            this.releasing = false;
        }
        this.holdingLock = false;
        const release = this.releaseLock;
        this.releaseLock = null;
        release?.();
        if (this.disposeAfterRelease) {
            this.disposeAfterRelease = false;
            this.dispose();
        }
        return true;
    }

    private invalidateAcquisition(): void {
        this.attemptSerial++;
        this.pendingAttempt = null;
        this.finishRetryDelay?.();
    }

    private isAttemptCurrent(attempt: number): boolean {
        return !this.disposed && !this.disposing && !this.sleeping && !this.cleanupFailed && !this.releasing && attempt === this.attemptSerial;
    }

    private tryAcquire(attempt: number, budget: number): Promise<boolean> {
        this.nativeAcquisitionPending = true;
        return new Promise<boolean>((resolve, reject) => {
            let eligible = true;
            let granted = false;
            const timer = setTimeout(() => {
                eligible = false;
                this.acquisitionFailed = true;
                if (!this.sleeping && !this.disposed) this.showMessage("Ownership acquisition did not settle. Reload this tab.", false);
                reject(new Error("Native ownership acquisition timed out. Reload this tab."));
            }, budget);
            void Promise.resolve()
                .then(() =>
                    navigator.locks.request(this.name, { ifAvailable: true }, async (lock) => {
                        this.nativeAcquisitionPending = false;
                        clearTimeout(timer);
                        if (!eligible || lock === null || !this.isAttemptCurrent(attempt) || document.visibilityState === "hidden") {
                            resolve(false);
                            return;
                        }
                        const held = new Promise<void>((release) => {
                            this.releaseLock = release;
                        });
                        granted = true;
                        this.holdingLock = true;
                        const epoch = ++this.ownershipEpoch;
                        try {
                            this.acquired();
                            resolve(this.owned && epoch === this.ownershipEpoch && this.isAttemptCurrent(attempt));
                        } catch (error) {
                            this.release();
                            reject(error);
                        }
                        // If relinquishment failed, keep this callback pending and keep the lock.
                        await held;
                    })
                )
                .then(() => {
                    if (!granted && attempt !== this.attemptSerial && !this.sleeping && !this.disposed && !this.acquisitionFailed) void this.acquire(false);
                })
                .catch((error: unknown) => {
                    this.nativeAcquisitionPending = false;
                    clearTimeout(timer);
                    eligible = false;
                    reject(error);
                });
        });
    }

    private async acquire(takeover: boolean): Promise<void> {
        if (
            this.acquisitionFailed ||
            this.nativeAcquisitionPending ||
            this.pendingAttempt !== null ||
            this.holdingLock ||
            this.sleeping ||
            this.disposed ||
            this.disposing ||
            this.cleanupFailed ||
            this.releasing
        ) {
            return;
        }
        const attempt = ++this.attemptSerial;
        this.pendingAttempt = attempt;
        try {
            this.openChannel();
            const deadline = performance.now() + 5000;
            do {
                if (await this.tryAcquire(attempt, Math.max(1, deadline - performance.now()))) {
                    return;
                }
                if (!this.isAttemptCurrent(attempt) || !takeover) {
                    break;
                }
                this.channel?.postMessage("takeover");
                if (!this.isAttemptCurrent(attempt)) {
                    break;
                }
                await this.retryDelay();
            } while (this.isAttemptCurrent(attempt) && performance.now() < deadline);
            if (this.isAttemptCurrent(attempt)) {
                this.showMessage(takeover ? "The other tab has not released your game. Close it, then try again." : "Your game is open in another tab.");
            }
        } catch (error) {
            if (this.cleanupFailed) {
                this.showCleanupFailure();
            } else if (this.isAttemptCurrent(attempt)) {
                console.warn("Unable to acquire game session.", error);
                this.showMessage(
                    this.acquisitionFailed
                        ? "Ownership acquisition did not settle. Reload this tab."
                        : "Unable to open saved progress safely. Close other game tabs and try again.",
                    !this.owned && !this.acquisitionFailed
                );
            }
        } finally {
            if (this.pendingAttempt === attempt) {
                this.pendingAttempt = null;
            }
        }
    }

    private retryDelay(): Promise<void> {
        return new Promise<void>((resolve) => {
            const finish = (): void => {
                clearTimeout(timer);
                if (this.finishRetryDelay === finish) {
                    this.finishRetryDelay = null;
                }
                resolve();
            };
            const timer = setTimeout(finish, 100);
            this.finishRetryDelay = finish;
        });
    }

    private showCleanupFailure(): void {
        if (this.disposed || this.sleeping) return;
        const screenGeneration = ++this.screenGeneration;
        const screen = document.createElement("main");
        screen.className = "session-ownership-screen";
        screen.setAttribute("role", "alert");
        const panel = document.createElement("section");
        panel.className = "session-ownership-panel";
        const text = document.createElement("p");
        text.textContent = "This session could not be stopped safely. Reload this tab before continuing.";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "start-button";
        button.textContent = "Reload";
        button.addEventListener("click", () => {
            if (screenGeneration === this.screenGeneration && screen.isConnected) window.location.reload();
        });
        panel.append(text, button);
        screen.append(panel);
        this.root.replaceChildren(screen);
        if (screenGeneration === this.screenGeneration && screen.isConnected && document.hasFocus()) screen.querySelector<HTMLButtonElement>("button")?.focus();
    }

    private showMessage(message: string, allowRetry = true): void {
        if (this.disposed || this.sleeping) {
            return;
        }
        const screenGeneration = ++this.screenGeneration;
        const screen = document.createElement("main");
        screen.className = "session-ownership-screen";
        screen.setAttribute("aria-live", "polite");
        const panel = document.createElement("section");
        panel.className = "session-ownership-panel";
        const text = document.createElement("span");
        text.className = "session-ownership-message";
        text.textContent = message;
        panel.append(text);
        if (this.acquisitionFailed) {
            const reload = document.createElement("button");
            reload.type = "button";
            reload.textContent = "Reload";
            reload.addEventListener("click", () => {
                if (screenGeneration === this.screenGeneration && screen.isConnected) window.location.reload();
            });
            panel.append(reload);
        }
        if (allowRetry && !this.cleanupFailed && !this.acquisitionFailed && this.supportsOwnership()) {
            const button = document.createElement("button");
            button.className = "start-button";
            button.type = "button";
            button.textContent = "Continue Here";
            button.addEventListener("click", () => {
                if (
                    screenGeneration !== this.screenGeneration ||
                    !screen.isConnected ||
                    !button.isConnected ||
                    this.pendingAttempt !== null ||
                    this.holdingLock ||
                    this.disposed ||
                    this.disposing ||
                    this.sleeping ||
                    this.cleanupFailed ||
                    this.releasing
                ) {
                    return;
                }
                button.disabled = true;
                void this.acquire(true);
            });
            panel.append(button);
        }
        screen.append(panel);
        this.root.replaceChildren(screen);
        if (screenGeneration === this.screenGeneration && screen.isConnected && document.hasFocus()) screen.querySelector<HTMLButtonElement>("button")?.focus();
    }
}
