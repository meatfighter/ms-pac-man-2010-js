/** Capacity/JSON safety only. Gameplay domains belong to field owners.
 * Counts are charged per serialized occurrence, including shared aliases.
 * Reject accessors/toJSON before traversing them; validation never runs code.
 */
export function isSnapshotJsonWithinBudget(value: unknown): boolean {
    const ancestors = new Set<object>();
    let containers = 0;
    let children = 0;
    let chars = 0;
    function visit(current: unknown, depth: number): boolean {
        if (depth > 64) return false;
        if (current === null || typeof current === "boolean") return true;
        if (typeof current === "number") return Number.isFinite(current);
        if (typeof current === "string") return current.length <= 4096 && (chars += current.length) <= 1_500_000;
        if (typeof current !== "object" || ancestors.has(current)) return false;
        if (++containers > 65_536 || "toJSON" in current) return false;
        const array = Array.isArray(current);
        const prototype = Object.getPrototypeOf(current);
        if (!array && prototype !== Object.prototype && prototype !== null) return false;
        const keys = Reflect.ownKeys(current);
        if ((children += keys.length) > 524_288) return false;
        ancestors.add(current);
        let items = 0;
        for (const key of keys) {
            if (array && key === "length") continue;
            if (typeof key !== "string" || key === "__proto__" || key === "constructor" || key === "prototype") return false;
            const descriptor = Object.getOwnPropertyDescriptor(current, key);
            if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return false;
            if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= current.length)) return false;
            if ((chars += key.length) > 1_500_000 || !visit(descriptor.value, depth + 1)) return false;
            items++;
        }
        ancestors.delete(current);
        return !array || items === current.length;
    }
    try {
        return visit(value, 0);
    } catch {
        return false;
    }
}
