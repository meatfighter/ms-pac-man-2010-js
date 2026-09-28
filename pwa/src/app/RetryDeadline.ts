export const MAX_RETRY_DELAY_MS = 3_600_000;

/** A page-lifetime deadline. This clock must never be serialized. */
export class RetryDeadline {
    private due: number | null = null;

    public constructor(private readonly monotonicNow: () => number = () => performance.now()) {}

    public get armed(): boolean {
        return this.due !== null;
    }

    public arm(delay: number): void {
        if (!Number.isFinite(delay)) throw new RangeError("Invalid retry delay.");
        this.due = this.monotonicNow() + Math.min(MAX_RETRY_DELAY_MS, Math.max(0, delay));
    }

    public remaining(): number {
        return this.due === null ? 0 : Math.max(0, this.due - this.monotonicNow());
    }
}
