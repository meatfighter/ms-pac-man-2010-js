/** Runtime acceptance and persistent Continue eligibility are independent. */
export class PersistenceSession<T extends object> {
    private epoch = -1;
    private accepted: T | null = null;
    private rejected = false;

    public beginOwnership(epoch: number): boolean {
        if (epoch === this.epoch) return false;
        this.epoch = epoch;
        this.accepted = null;
        this.rejected = false;
        return true;
    }
    public accept(runtime: T): void { this.accepted = runtime; }
    public retire(runtime: T | null): void {
        if (runtime === this.accepted) this.accepted = null;
    }
    public canSave(runtime: T): boolean { return runtime === this.accepted; }
    public rejectStored(): void { this.rejected = true; }
    public abandonStored(): void { this.rejected = true; }
    public didSave(): void { this.rejected = false; }
    public canReadStored(): boolean { return !this.rejected; }
}

/** Launch-local marker survives error wrapping without classifying every
 * exception raised after clicking Continue as corrupt stored state. */
export class RestoreAttempt {
    public rejected = false;
    public reject(): never {
        this.rejected = true;
        throw new Error("Stored game restoration was rejected.");
    }
}
