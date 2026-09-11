/** Page-lifetime safety latch. A later no-op cannot erase a failed exit. */
export class SessionCleanup {
    private error: Error | null = null;

    public get safe(): boolean {
        return this.error === null;
    }

    public get failure(): Error | null {
        return this.error;
    }

    /** Execute every essential step, even if an earlier step or prior exit failed. */
    public run(...steps: Array<() => void>): boolean {
        const failures: unknown[] = [];
        for (const step of steps) {
            try {
                step();
            } catch (error) {
                failures.push(error);
            }
        }
        if (failures.length !== 0) {
            this.error ??= new AggregateError(failures, "The session could not be stopped safely. Reload this tab.");
        }
        return this.safe;
    }

    /** Storage failure is not permission to skip resource retirement or lose a live game. */
    public trySave(save: () => boolean): boolean {
        try {
            return save();
        } catch (error) {
            console.warn("Unable to save progress; the last successful save is unchanged.", error);
            return false;
        }
    }

    /** Relinquish callbacks must call this before the native writer lock is released. */
    public assertSafe(): void {
        if (this.error !== null) {
            throw this.error;
        }
    }
}
