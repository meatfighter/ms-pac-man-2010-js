const JAVA_INT_MIN = -2_147_483_648;
const JAVA_INT_MAX = 2_147_483_647;
const MAX_GAMEPLAY_NUMBER_MAGNITUDE = 100_000;
const MAX_SNAPSHOT_STRING_LENGTH = 4_096;

type Path = readonly (string | number)[];

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Additional value-budget checks; the exact-schema validator is still required. */
export function hasReasonableSnapshotValues(value: unknown): boolean {
    const root = record(value);
    const mode = root === null ? null : record(root.mode);
    const modeId = mode?.id;

    function visit(current: unknown, path: Path): boolean {
        if (current === null || typeof current === "boolean") return true;
        if (typeof current === "string") return current.length <= MAX_SNAPSHOT_STRING_LENGTH;
        if (typeof current === "number") {
            if (!Number.isFinite(current)) return false;
            const key = path[path.length - 1];
            const isModeField = path.length === 3 && path[0] === "mode" && path[1] === "fields";
            if (isModeField && modeId === "enterInitials" && key === "redOffset") return Number.isInteger(current) && current >= 0 && current <= JAVA_INT_MAX;
            if (isModeField && modeId === "selectWorld" && key === "angleOffset") return current >= 0;
            if (key === "score") return Number.isInteger(current) && current >= JAVA_INT_MIN && current <= JAVA_INT_MAX;
            if (key === "highScoreQualificationCutoff") return Number.isInteger(current) && current >= 0 && current <= JAVA_INT_MAX;
            return Math.abs(current) <= MAX_GAMEPLAY_NUMBER_MAGNITUDE;
        }
        if (Array.isArray(current)) return current.every((entry: unknown, index: number) => visit(entry, [...path, index]));
        const fields = record(current);
        return fields !== null && Object.entries(fields).every(([key, entry]) => visit(entry, [...path, key]));
    }

    return visit(value, []);
}
