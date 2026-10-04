import { createBrowserStorageKeys } from "../../app/BrowserStorageKeys.js";

export const REJECTED_SAVE_DEBUG_KEY = createBrowserStorageKeys().rejectedSaveDebug;
export const REJECTED_SAVE_DEBUG_VERSION = 1;
const MAX_FULL_CHARS = 1_010_000;
const MAX_COMPACT_CHARS = 16384;
const MAX_VISITS = 600000;
const MAX_DEPTH = 64;

export type RejectedSaveStage =
    "structure-and-graph" | "values-and-audio" | "stopwatch-repeat" | "axe-knight-shield" | "presentation-resources" | "loaded-resources";

export interface RejectedSaveFailure {
    readonly stage: RejectedSaveStage;
    readonly kind: "returned-false" | "threw";
    readonly error?: unknown;
    readonly ruleCode?: string;
    readonly fieldPath?: string;
}

// Read only own data descriptors when summarizing rejected evidence. Never run
// getters, iterators or array overrides from the snapshot under investigation.
function record(value: unknown): Record<string, unknown> | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const keys = Reflect.ownKeys(value);
    if (keys.length > 512) return result;
    for (const key of keys) {
        if (typeof key !== "string") continue;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor && "value" in descriptor) result[key] = descriptor.value;
    }
    return result;
}

function scalar(value: unknown): string | number | boolean | null {
    if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
    if (typeof value === "string") return value.slice(0, 256);
    if (typeof value === "boolean") return value;
    return null;
}

function errorDetails(error: unknown): { name: string; message: string } | null {
    if (error === undefined) return null;
    try {
        return error instanceof Error
            ? { name: error.name.slice(0, 80), message: error.message.slice(0, 1024) }
            : { name: "ThrownValue", message: String(error).slice(0, 1024) };
    } catch {
        return { name: "UnreadableThrownValue", message: "Unable to describe validator exception" };
    }
}

function boundedJson(value: unknown, limit: number): string {
    // Inspect descriptors before JSON.stringify: toJSON, accessors, sparse
    // arrays and non-plain objects can silently change the rejected evidence.
    // Shared references are valid JSON trees; only ancestor cycles are rejected.
    let inspected = 0;
    let inspectedChars = 0;
    const path = new Set<object>();
    function inspect(child: unknown, depth: number): void {
        if (++inspected > MAX_VISITS || depth > MAX_DEPTH) throw new Error("debug-inspection-budget");
        if (typeof child === "string") {
            inspectedChars += child.length;
            if (inspectedChars > limit) throw new Error("debug-string-budget");
        }
        if (typeof child === "number" && !Number.isFinite(child)) throw new Error("debug-non-json-number");
        if (["undefined", "bigint", "symbol", "function"].includes(typeof child)) throw new Error("debug-non-json-value");
        if (child === null || typeof child !== "object") return;
        if (path.has(child)) throw new Error("debug-cycle");
        const array = Array.isArray(child);
        const prototype = Object.getPrototypeOf(child);
        if (!array && prototype !== Object.prototype && prototype !== null) throw new Error("debug-non-plain-object");
        if ("toJSON" in child) throw new Error("debug-to-json");
        path.add(child);
        const keys = Reflect.ownKeys(child);
        if (keys.length > MAX_VISITS - inspected) throw new Error("debug-visit-budget");
        let elements = 0;
        for (const key of keys) {
            if (array && key === "length") continue;
            if (typeof key !== "string") throw new Error("debug-symbol-key");
            const descriptor = Object.getOwnPropertyDescriptor(child, key);
            if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new Error("debug-non-json-property");
            if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= child.length)) throw new Error("debug-array-property");
            inspectedChars += key.length;
            if (inspectedChars > limit) throw new Error("debug-string-budget");
            inspect(descriptor.value, depth + 1);
            elements++;
        }
        if (array && elements !== child.length) throw new Error("debug-sparse-array");
        path.delete(child);
    }
    inspect(value, 0);
    let visits = 0;
    let stringBudget = 0;
    const ancestors: object[] = [];
    const text = JSON.stringify(value, function (this: unknown, key: string, child: unknown): unknown {
        if (++visits > MAX_VISITS) throw new Error("debug-visit-budget");
        stringBudget += key.length;
        if (typeof child === "string") stringBudget += child.length;
        if (stringBudget > limit) throw new Error("debug-string-budget");
        if (typeof child === "number" && !Number.isFinite(child)) throw new Error("debug-non-json-number");
        if (["undefined", "bigint", "symbol", "function"].includes(typeof child)) {
            throw new Error("debug-non-json-value");
        }
        if (child !== null && typeof child === "object") {
            while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) ancestors.pop();
            if (ancestors.includes(child)) throw new Error("debug-cycle");
            if (ancestors.length >= MAX_DEPTH) throw new Error("debug-depth-budget");
            ancestors.push(child);
        }
        return child;
    });
    if (typeof text !== "string" || text.length > limit) throw new Error("debug-text-budget");
    return text;
}

function summarize(snapshot: unknown): Record<string, unknown> {
    const root = record(snapshot);
    const main = record(root?.mainFields);
    const mode = record(root?.mode);
    const world = record(root?.gameMode);
    const entities = Array.isArray(world?.entities) ? world.entities : [];
    return {
        schemaVersion: scalar(root?.version),
        savedAt: scalar(root?.savedAt),
        kind: scalar(root?.kind),
        mode: scalar(root?.modeId ?? mode?.id),
        stageIndex: scalar(main?.stageIndex),
        worldIndex: scalar(main?.worldIndex),
        entityCount: entities.length,
        entityTypes: [...new Set(entities.slice(0, 4096).map((entity) => scalar(record(entity)?.type)))].slice(0, 128)
    };
}

let recording = false;

export function retainRejectedSave(snapshot: unknown, appVersion: string, failure: RejectedSaveFailure, isAuthorized: () => boolean): void {
    if (recording) return;
    recording = true;
    try {
        if (!isAuthorized()) return;
        const base = {
            debugFormatVersion: REJECTED_SAVE_DEBUG_VERSION,
            reason: "invalid-snapshot-before-save",
            capturedAt: new Date().toISOString(),
            appVersion: appVersion.slice(0, 256),
            buildStamp: typeof __BUILD_STAMP__ === "string" ? __BUILD_STAMP__ : null,
            failedStage: failure.stage,
            failureKind: failure.kind,
            ruleCode: failure.ruleCode ?? failure.stage,
            fieldPath: failure.fieldPath ?? null,
            error: errorDetails(failure.error),
            summary: summarize(snapshot)
        };
        let full: string | null = null;
        let omittedReason = "full-record-unavailable";
        try {
            full = boundedJson({ ...base, snapshotIncluded: true, snapshot }, MAX_FULL_CHARS);
        } catch (error) {
            omittedReason = errorDetails(error)?.message ?? "full-record-not-serializable";
        }
        if (!isAuthorized()) return;
        const storage = globalThis.localStorage;
        if (full !== null) {
            if (!isAuthorized()) return;
            try {
                storage.setItem(REJECTED_SAVE_DEBUG_KEY, full);
                return;
            } catch {
                omittedReason = "full-record-storage-write-failed";
            }
        }
        const compact = boundedJson({ ...base, snapshotIncluded: false, snapshotOmittedReason: omittedReason }, MAX_COMPACT_CHARS);
        if (!isAuthorized()) return;
        storage.setItem(REJECTED_SAVE_DEBUG_KEY, compact);
    } catch {
        // Evidence is best-effort. Never throw into save or departure cleanup.
    } finally {
        recording = false;
    }
}
