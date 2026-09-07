/** One writable tab per deployment. Never steal a lock from a running session. */
export class GameSessionOwnership {
    public owned = false;
    private releaseLock: (() => void) | null = null;
    private readonly name = `game-session:${new URL(".", location.href).pathname}`;
    private channel: BroadcastChannel | null = null;
    private starting = false;
    private hidden = false;

    public constructor(
        private readonly root: HTMLElement,
        private readonly acquired: () => void,
        private readonly relinquish: () => void
    ) {}

    public start(): void {
        if (!("locks" in navigator) || !("BroadcastChannel" in globalThis)) {
            this.showMessage("This browser cannot safely share saved progress between tabs. Please use a current browser.");
            return;
        }
        this.channel = new BroadcastChannel(this.name);
        this.channel.addEventListener("message", (event: MessageEvent<unknown>) => {
            if (event.data === "takeover" && this.owned) {
                this.release();
                this.showMessage("Your game moved to another tab.");
            }
        });
        window.addEventListener("pagehide", () => {
            this.hidden = true;
            this.release();
        });
        window.addEventListener("pageshow", (event) => {
            if (event.persisted) {
                this.hidden = false;
                void this.acquire(false);
            }
        });
        void this.acquire(false);
    }

    private release(): void {
        if (!this.owned) {
            return;
        }
        // Saving and destroying are synchronous; ownership remains valid until both finish.
        // If cleanup throws, retain the lock so another tab cannot race surviving callbacks.
        this.relinquish();
        this.owned = false;
        this.releaseLock?.();
        this.releaseLock = null;
    }

    private async tryAcquire(): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            void navigator.locks
                .request(this.name, { ifAvailable: true }, async (lock) => {
                    if (lock === null || this.hidden) {
                        resolve(false);
                        return;
                    }
                    const held = new Promise<void>((release) => {
                        this.releaseLock = release;
                    });
                    this.owned = true;
                    try {
                        this.acquired();
                        resolve(true);
                    } catch (error) {
                        this.release();
                        reject(error);
                    }
                    await held;
                })
                .catch(reject);
        });
    }

    private async acquire(takeover: boolean): Promise<void> {
        if (this.starting || this.owned || this.hidden) {
            return;
        }
        this.starting = true;
        try {
            const deadline = Date.now() + (takeover ? 5000 : 0);
            do {
                if (await this.tryAcquire()) {
                    return;
                }
                if (!takeover || this.hidden) {
                    break;
                }
                this.channel?.postMessage("takeover");
                await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
            } while (Date.now() < deadline);
            if (!this.hidden) {
                this.showMessage(takeover ? "The other tab has not released your game. Close it, then try again." : "Your game is open in another tab.");
            }
        } catch (error) {
            console.warn("Unable to acquire game session.", error);
            this.showMessage("Unable to open your saved progress safely. Close other game tabs and try again.");
        } finally {
            this.starting = false;
        }
    }

    private showMessage(message: string): void {
        const screen = document.createElement("main");
        screen.className = "session-ownership-screen";
        screen.setAttribute("aria-live", "polite");

        const panel = document.createElement("section");
        panel.className = "session-ownership-panel";

        const text = document.createElement("span");
        text.className = "session-ownership-message";
        text.textContent = message;
        panel.append(text);

        if ("locks" in navigator && "BroadcastChannel" in globalThis) {
            const button = document.createElement("button");
            button.className = "start-button";
            button.type = "button";
            button.textContent = "Continue here";
            button.addEventListener("click", () => {
                button.disabled = true;
                void this.acquire(true);
            });
            panel.append(button);
        }

        screen.append(panel);
        this.root.replaceChildren(screen);
    }
}
