/** Best-effort screen wake lock tied to a caller-owned activity intent. */
export class ScreenWakeLockManager {
    private desired = false;
    private sentinel: WakeLockSentinel | null = null;
    private syncQueued = false;
    private syncing = false;
    private visibilityLost = document.visibilityState !== "visible";
    private focusLost = !document.hasFocus();

    public constructor() {
        window.addEventListener("pagehide", this.handlePageHide);
        window.addEventListener("pageshow", this.handlePageShow);
        window.addEventListener("blur", this.handleBlur);
        window.addEventListener("focus", this.handleFocus);
        document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }

    /** Requests a screen wake lock while foreground activity should remain visible. */
    public setDesired(desired: boolean): void {
        this.desired = desired;
        this.queueSync();
    }

    private readonly handlePageHide = (): void => {
        this.visibilityLost = true;
        this.queueSync();
    };

    private readonly handlePageShow = (): void => {
        this.syncForegroundState();
        this.queueSync();
    };

    private readonly handleBlur = (): void => {
        this.focusLost = true;
        this.queueSync();
    };

    private readonly handleFocus = (): void => {
        this.focusLost = false;
        this.visibilityLost = document.visibilityState !== "visible";
        this.queueSync();
    };

    private readonly handleVisibilityChange = (): void => {
        this.syncForegroundState();
        this.queueSync();
    };

    private syncForegroundState(): void {
        this.visibilityLost = document.visibilityState !== "visible";
        if (!this.visibilityLost) {
            this.focusLost = !document.hasFocus();
        }
    }

    private queueSync(): void {
        this.syncQueued = true;
        if (this.syncing) {
            return;
        }
        this.syncing = true;
        void this.runSyncLoop();
    }

    private async runSyncLoop(): Promise<void> {
        try {
            while (this.syncQueued) {
                this.syncQueued = false;
                await this.syncOnce();
            }
        } finally {
            this.syncing = false;
            if (this.syncQueued) {
                this.queueSync();
            }
        }
    }

    private async syncOnce(): Promise<void> {
        if (!this.shouldHoldLock()) {
            await this.releaseCurrent();
            return;
        }
        if (this.sentinel !== null && !this.sentinel.released) {
            return;
        }
        this.sentinel = null;
        if (!("wakeLock" in navigator)) {
            return;
        }

        let sentinel: WakeLockSentinel;
        try {
            sentinel = await navigator.wakeLock.request("screen");
        } catch {
            return;
        }

        if (!this.shouldHoldLock()) {
            await this.releaseSentinel(sentinel);
            return;
        }

        this.sentinel = sentinel;
        sentinel.addEventListener(
            "release",
            () => {
                if (this.sentinel === sentinel) {
                    this.sentinel = null;
                }
            },
            { once: true }
        );
    }

    private shouldHoldLock(): boolean {
        return this.desired && !this.visibilityLost && !this.focusLost && document.visibilityState === "visible" && document.hasFocus();
    }

    private async releaseCurrent(): Promise<void> {
        const sentinel = this.sentinel;
        this.sentinel = null;
        if (sentinel !== null && !sentinel.released) {
            await this.releaseSentinel(sentinel);
        }
    }

    private async releaseSentinel(sentinel: WakeLockSentinel): Promise<void> {
        try {
            await sentinel.release();
        } catch {
            // Wake locks are best-effort; release failures must not affect the game.
        }
    }
}
