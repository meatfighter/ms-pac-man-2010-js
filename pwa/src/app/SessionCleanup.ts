/** Page-lifetime safety latch. A later no-op cannot erase a failed exit. */
export class SessionCleanup {
    private error: Error | null = null;
    private suspensionDepth = 0;
    private suspensionRevision = 0;
    private saveRevision: number | null = null;
    /** A nested departure can retire a pending capture without making cleanup unsafe. */

    public get saveAllowed(): boolean {
        return this.suspensionDepth === 0 || (this.suspensionDepth === 1 && this.saveRevision === this.suspensionRevision);
    }

    public get safe(): boolean {
        return this.error === null;
    }

    public get failure(): Error | null {
        return this.error;
    }

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

    public trySave(save: () => boolean): boolean {
        try {
            return save();
        } catch (error) {
            try {
                console.warn("Unable to save game state during session transition.", error);
            } catch {
                /* Diagnostic sinks cannot interrupt resource retirement. */
            }
            return false;
        }
    }
    /** Freeze first, save once, then attempt every resource cleanup step. */

    public freezeSaveAndRun(freeze: () => void, save: (() => boolean) | null, ...steps: Array<() => void>): boolean {
        const revision = ++this.suspensionRevision;
        const outermost = this.suspensionDepth++ === 0;
        try {
            const frozenSafely = this.run(freeze);
            if (outermost && frozenSafely && revision === this.suspensionRevision && save !== null) {
                this.saveRevision = revision;
                this.trySave(save);
            }
        } finally {
            if (outermost) this.saveRevision = null;
            try {
                this.run(...steps);
            } finally {
                this.suspensionDepth--;
            }
        }
        // This result describes resource safety, NOT whether storage succeeded.
        return this.safe;
    }

    public assertSafe(): void {
        if (this.error !== null) throw this.error;
    }
}
