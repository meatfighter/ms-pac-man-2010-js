import { RetryDeadline } from "./RetryDeadline.js";
import type { HighScoreClient } from "../mspacman/HighScoreClient.js";
import { HighScoreService, type HighScoreRequestContext } from "../mspacman/HighScoreService.js";
import type { RemoteHighScore } from "../mspacman/HighScoreProtocol.js";
import { HighScoreOutbox, MAX_RETRY_DELAY_MS } from "./HighScoreOutbox.js";

const RETRY_DELAYS_MS = [30_000, 120_000, 600_000, MAX_RETRY_DELAY_MS] as const;
const RESULT_WAIT_MS = 5_000;
const LOCAL_FAILURE_DELAY_MS = 120_000;
type Waiter = (scores: RemoteHighScore[] | null) => void;

/** Foreground, one-request-at-a-time pump. Not a service-worker/background-sync job. */
export class HighScoreSync implements HighScoreClient {
    private disposed = false;
    private active: AbortController | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private wantGet = true;
    private readonly localDeadline: RetryDeadline;
    private readonly getDeadline: RetryDeadline;
    private latest: RemoteHighScore[] | null = null;
    private readonly waiters = new Set<Waiter>();

    public constructor(
        private readonly outbox: HighScoreOutbox,
        private readonly authorized: () => boolean,
        private readonly publish: (scores: RemoteHighScore[]) => void,
        monotonicNow: () => number = () => performance.now()
    ) {
        this.localDeadline = new RetryDeadline(monotonicNow);
        this.getDeadline = new RetryDeadline(monotonicNow);
    }

    public start(): void {
        this.kick();
    }

    public enqueueScore(candidate: RemoteHighScore): boolean {
        if (!this.current() || !this.outbox.enqueue(candidate)) return false;
        this.latest = null;
        this.kick();
        return true;
    }

    public requestScores(context: HighScoreRequestContext = {}): Promise<RemoteHighScore[] | null> {
        const current = (): boolean => this.current() && !context.signal?.aborted && (context.isCurrent?.() ?? true);
        if (!current()) return Promise.resolve(null);
        this.wantGet = true;
        if (this.latest !== null && this.outbox.first() === null) {
            const result = this.latest.map((entry) => ({ ...entry }));
            this.kick();
            return Promise.resolve(result);
        }
        return new Promise((resolve) => {
            let done = false;
            const finish: Waiter = (scores) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                this.waiters.delete(finish);
                context.signal?.removeEventListener("abort", abort);
                resolve(current() && scores !== null ? scores.map((entry) => ({ ...entry })) : null);
            };
            const abort = (): void => finish(null);
            this.waiters.add(finish);
            context.signal?.addEventListener("abort", abort, { once: true });
            const timer = setTimeout(abort, RESULT_WAIT_MS);
            if (!current()) abort();
            else this.kick();
        });
    }

    /** Visibility/online events wake the pump but never override its persisted backoff. */
    public wake(): void {
        if (!this.current()) return;
        if (document.visibilityState === "hidden") {
            this.clearTimer();
            this.active?.abort();
            this.settleWaiters(null);
            return;
        }
        this.wantGet = true;
        this.kick();
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.clearTimer();
        this.active?.abort();
        this.settleWaiters(null);
        this.latest = null;
    }

    private current(): boolean {
        return !this.disposed && this.authorized();
    }

    private foreground(): boolean {
        return this.current() && document.visibilityState !== "hidden";
    }

    private clearTimer(): void {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
    }

    private scheduleKick(delay: number): void {
        this.timer = setTimeout(
            () => {
                this.timer = null;
                this.kick();
            },
            Math.min(MAX_RETRY_DELAY_MS, Math.max(1, Math.ceil(delay)))
        );
    }

    private kick(): void {
        if (!this.foreground() || this.active !== null) return;
        this.clearTimer();
        const pending = this.outbox.first();
        if (pending === null && !this.wantGet) return;
        const localWait = this.localDeadline.remaining();
        if (localWait > 0) {
            this.scheduleKick(localWait);
            return;
        }
        const now = Date.now();
        // Repair through drive(), under its existing active/current ownership guard.
        if (pending !== null && this.outbox.needsDeadlineRepair(now)) {
            void this.drive(pending);
            return;
        }
        const wait = pending === null ? this.getDeadline.remaining() : this.outbox.delay(now);
        if (wait > 0) {
            this.scheduleKick(wait);
            return;
        }
        void this.drive(pending);
    }

    private async drive(candidate: RemoteHighScore | null): Promise<void> {
        const controller = new AbortController();
        this.active = controller;
        const current = (): boolean => this.foreground() && this.active === controller && !controller.signal.aborted;
        let retryAfterMs = 0;
        const context: HighScoreRequestContext = {
            signal: controller.signal,
            isCurrent: current,
            onRetryAfter: (delay) => {
                retryAfterMs = Math.max(retryAfterMs, delay);
            }
        };
        try {
            if (!current()) return;
            if (candidate !== null) {
                const now = Date.now();
                if (!this.outbox.prepareForDelivery(now)) {
                    this.localDeadline.arm(LOCAL_FAILURE_DELAY_MS);
                    this.settleWaiters(null);
                    return;
                }
                if (!current()) return;
                // A timing repair can happen now even though transmission must wait.
                // The existing finally clears active and kick schedules the remaining wait.
                if (this.outbox.delay(now) > 0) return;
                if (!this.outbox.reserveAttempt(Date.now())) {
                    this.localDeadline.arm(LOCAL_FAILURE_DELAY_MS);
                    this.settleWaiters(null);
                    return;
                }
                if (!current()) return;
            }
            if (candidate === null) this.wantGet = false;
            const scores =
                candidate === null
                    ? await HighScoreService.downloadScores(context)
                    : await HighScoreService.submitScore(candidate.world, candidate.score, candidate.initials, context);
            if (!current()) return;
            if (scores === null) {
                if (candidate !== null) {
                    const index = Math.min(this.outbox.failureCount, RETRY_DELAYS_MS.length - 1);
                    const delay = Math.max(RETRY_DELAYS_MS[index] ?? MAX_RETRY_DELAY_MS, retryAfterMs);
                    this.localDeadline.arm(delay);
                    this.outbox.defer(Date.now(), delay);
                } else {
                    this.getDeadline.arm(Math.max(30_000, retryAfterMs));
                }
                this.settleWaiters(null);
                return;
            }
            if (candidate !== null && !this.outbox.acknowledge(candidate, Date.now())) {
                this.localDeadline.arm(LOCAL_FAILURE_DELAY_MS);
                this.settleWaiters(null);
                return;
            }
            // A GET that began before an enqueue, or a partial drain, is not final authority.
            if (this.outbox.first() !== null) {
                this.settleWaiters(null);
                return;
            }
            this.latest = scores.map((entry) => ({ ...entry }));
            this.wantGet = false;
            this.getDeadline.arm(1_000);
            this.settleWaiters(this.latest);
            try {
                this.publish(this.latest.map((entry) => ({ ...entry })));
            } catch (error) {
                console.warn("Unable to present the current high-score table.", error);
            }
        } catch (error) {
            if (current()) {
                console.warn("High-score synchronization failed.", error);
                this.localDeadline.arm(LOCAL_FAILURE_DELAY_MS);
                if (candidate !== null) this.outbox.defer(Date.now(), LOCAL_FAILURE_DELAY_MS);
                this.settleWaiters(null);
            }
        } finally {
            if (this.active === controller) this.active = null;
            this.kick();
        }
    }

    private settleWaiters(scores: RemoteHighScore[] | null): void {
        for (const finish of Array.from(this.waiters)) finish(scores);
    }
}
