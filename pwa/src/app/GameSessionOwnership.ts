/** One writer per deployment, including across save-schema versions. */
export class GameSessionOwnership {
    public owned = false;
    private releaseLock: (() => void) | null = null;
    private readonly name = `game-session:${new URL(".", location.href).pathname}`;
    private channel: BroadcastChannel | null = null;
    private installed = false;
    private disposed = false;
    private sleeping = false;
    private attemptSerial = 0;
    private pendingAttempt: number | null = null;
    private ownershipEpoch = 0;

    public constructor(
        private readonly root: HTMLElement,
        private readonly acquired: () => void,
        private readonly relinquish: () => void
    ) {}

    public get epoch(): number {
        return this.ownershipEpoch;
    }

    public isCurrent(epoch: number): boolean {
        return this.owned && !this.sleeping && !this.disposed && epoch === this.ownershipEpoch;
    }

    public start(): void {
        if (this.installed || this.disposed) {
            return;
        }
        this.installed = true;
        if (!("locks" in navigator) || !("BroadcastChannel" in globalThis)) {
            this.showMessage("This browser cannot safely share saved progress between tabs. Please use a current browser.");
            return;
        }
        this.openChannel();
        window.addEventListener("pagehide", this.sleep);
        window.addEventListener("pageshow", this.wake);
        document.addEventListener("freeze", this.sleep);
        document.addEventListener("resume", this.wake);
        document.addEventListener("visibilitychange", this.visible);
        void this.acquire(false);
    }

    /** Failed relinquishment deliberately retains the lock rather than permitting two writers. */
    public dispose(): void {
        if (this.disposed || !this.release()) {
            return;
        }
        this.disposed = true;
        this.attemptSerial++;
        this.pendingAttempt = null;
        window.removeEventListener("pagehide", this.sleep);
        window.removeEventListener("pageshow", this.wake);
        document.removeEventListener("freeze", this.sleep);
        document.removeEventListener("resume", this.wake);
        document.removeEventListener("visibilitychange", this.visible);
        this.closeChannel();
    }

    private readonly message = (event: MessageEvent<unknown>): void => {
        if (event.data !== "takeover" || !this.owned || this.disposed) {
            return;
        }
        if (this.release()) {
            this.showMessage("Your game moved to another tab.");
        } else {
            this.showMessage("Unable to close this session safely. Reload this tab before continuing elsewhere.", false);
        }
    };

    private readonly sleep = (): void => {
        if (this.disposed) {
            return;
        }
        this.sleeping = true;
        this.attemptSerial++;
        this.pendingAttempt = null;
        this.release();
        this.closeChannel();
    };

    private readonly wake = (): void => {
        if (this.disposed || document.visibilityState === "hidden") {
            return;
        }
        this.sleeping = false;
        this.openChannel();
        if (!this.owned) {
            void this.acquire(false);
        }
    };

    private readonly visible = (): void => {
        if (this.sleeping && document.visibilityState === "visible") {
            this.wake();
        }
    };

    private openChannel(): void {
        if (this.channel === null && "BroadcastChannel" in globalThis) {
            this.channel = new BroadcastChannel(this.name);
            this.channel.addEventListener("message", this.message);
        }
    }

    private closeChannel(): void {
        this.channel?.removeEventListener("message", this.message);
        this.channel?.close();
        this.channel = null;
    }

    private release(): boolean {
        if (!this.owned) {
            return true;
        }
        try {
            // Save/freeze/destroy while this tab still owns the write capability.
            this.relinquish();
        } catch (error) {
            console.error("Unable to relinquish the current game safely; retaining its lock.", error);
            return false;
        }
        this.owned = false;
        this.ownershipEpoch++;
        const release = this.releaseLock;
        this.releaseLock = null;
        release?.();
        return true;
    }

    private isAttemptCurrent(attempt: number): boolean {
        return !this.disposed && !this.sleeping && attempt === this.attemptSerial;
    }

    private tryAcquire(attempt: number): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            void navigator.locks.request(this.name, { ifAvailable: true }, async (lock) => {
                if (lock === null || !this.isAttemptCurrent(attempt)) {
                    resolve(false);
                    return;
                }
                const held = new Promise<void>((release) => {
                    this.releaseLock = release;
                });
                this.owned = true;
                const epoch = ++this.ownershipEpoch;
                try {
                    this.acquired();
                    resolve(this.owned && epoch === this.ownershipEpoch && this.isAttemptCurrent(attempt));
                } catch (error) {
                    this.release();
                    reject(error);
                }
                // Even an acquired-callback failure must not release a lock whose
                // surviving game could not be safely relinquished.
                await held;
            }).catch(reject);
        });
    }

    private async acquire(takeover: boolean): Promise<void> {
        if (this.pendingAttempt !== null || this.owned || this.sleeping || this.disposed) {
            return;
        }
        const attempt = ++this.attemptSerial;
        this.pendingAttempt = attempt;
        try {
            const deadline = Date.now() + (takeover ? 5000 : 0);
            do {
                if (await this.tryAcquire(attempt)) {
                    return;
                }
                if (!this.isAttemptCurrent(attempt) || !takeover) {
                    break;
                }
                this.channel?.postMessage("takeover");
                await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
            } while (this.isAttemptCurrent(attempt) && Date.now() < deadline);
            if (this.isAttemptCurrent(attempt)) {
                this.showMessage(takeover ? "The other tab has not released your game. Close it, then try again." : "Your game is open in another tab.");
            }
        } catch (error) {
            if (this.isAttemptCurrent(attempt)) {
                console.warn("Unable to acquire game session.", error);
                this.showMessage("Unable to open saved progress safely. Close other game tabs and try again.", !this.owned);
            }
        } finally {
            if (this.pendingAttempt === attempt) {
                this.pendingAttempt = null;
            }
        }
    }

    private showMessage(message: string, allowRetry = true): void {
        if (this.disposed || this.sleeping) {
            return;
        }
        const screen = document.createElement("main");
        screen.className = "session-ownership-screen";
        screen.setAttribute("aria-live", "polite");
        const panel = document.createElement("section");
        panel.className = "session-ownership-panel";
        const text = document.createElement("span");
        text.className = "session-ownership-message";
        text.textContent = message;
        panel.append(text);
        if (allowRetry && "locks" in navigator && "BroadcastChannel" in globalThis) {
            const button = document.createElement("button");
            button.className = "start-button";
            button.type = "button";
            button.textContent = "Continue Here";
            button.addEventListener("click", () => {
                if (this.pendingAttempt !== null || this.owned) {
                    return;
                }
                button.disabled = true;
                void this.acquire(true);
            });
            panel.append(button);
        }
        screen.append(panel);
        this.root.replaceChildren(screen);
    }
}
