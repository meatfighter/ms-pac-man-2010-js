import { isSnapshotJsonWithinBudget } from "../../app/SnapshotJsonBudget.js";

/** JSON/capacity check only; no duplicate gameplay-number magnitudes. */
export function hasReasonableSnapshotValues(value: unknown): boolean {
    return isSnapshotJsonWithinBudget(value);
}
