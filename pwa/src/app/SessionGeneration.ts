/** Invalidates asynchronous browser work that belongs to a superseded game session. */
export class SessionGeneration {
    private generation = 0;

    public begin(): number {
        return ++this.generation;
    }

    public invalidate(): void {
        this.generation++;
    }

    public isCurrent(generation: number): boolean {
        return generation === this.generation;
    }
}
