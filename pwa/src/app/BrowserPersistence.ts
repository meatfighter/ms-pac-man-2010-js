export type SnapshotWriteFailure = "capture-failed" | "invalid-snapshot" | "encode-failed" | "too-large" | "not-authorized" | "write-failed";
export type SnapshotWriteResult = { readonly saved: true } | { readonly saved: false; readonly reason: SnapshotWriteFailure };

/** The sole reporter for one failed outgoing snapshot operation. */
export function snapshotWriteFailure(label: string, reason: SnapshotWriteFailure, error?: unknown): SnapshotWriteResult {
    if (reason !== "not-authorized") {
        console.warn(`Unable to save ${label}: ${reason}.`, ...(error === undefined ? [] : [error]));
    }
    return { saved: false, reason };
}

/** No reads, enumeration, pre-delete, backup, or read-back verification. */
export function writeCurrentSnapshot<T>(
    label: string,
    key: string,
    snapshot: T,
    validate: (value: T) => boolean,
    maxTextLength: number,
    isAuthorized: () => boolean
): SnapshotWriteResult {
    try {
        if (!validate(snapshot)) return snapshotWriteFailure(label, "invalid-snapshot");
    } catch (error) {
        return snapshotWriteFailure(label, "invalid-snapshot", error);
    }
    let text: string;
    try {
        const encoded = JSON.stringify(snapshot);
        if (typeof encoded !== "string") return snapshotWriteFailure(label, "encode-failed");
        text = encoded;
    } catch (error) {
        return snapshotWriteFailure(label, "encode-failed", error);
    }
    if (text.length > maxTextLength) return snapshotWriteFailure(label, "too-large");
    try {
        // Obtaining the storage object can itself throw. Do it before the final
        // authority check so there are no intervening callbacks before setItem.
        const storage = globalThis.localStorage;
        if (!isAuthorized()) return { saved: false, reason: "not-authorized" };
        storage.setItem(key, text);
        return { saved: true };
    } catch (error) {
        return snapshotWriteFailure(label, "write-failed", error);
    }
}

/** Separate capture errors from encoding or native storage errors. */
export function captureAndWriteSnapshot<T>(
    label: string,
    key: string,
    capture: () => T,
    validate: (value: T) => boolean,
    maxTextLength: number,
    isAuthorized: () => boolean
): SnapshotWriteResult {
    let snapshot: T;
    try {
        snapshot = capture();
    } catch (error) {
        return snapshotWriteFailure(label, "capture-failed", error);
    }
    return writeCurrentSnapshot(label, key, snapshot, validate, maxTextLength, isAuthorized);
}

/** Scalar preferences use the same last-boundary ownership rule. */
export function writePreference(label: string, key: string, text: string, isAuthorized: () => boolean): boolean {
    try {
        const storage = globalThis.localStorage;
        if (!isAuthorized()) return false;
        storage.setItem(key, text);
        return true;
    } catch (error) {
        console.warn(`Unable to save ${label}.`, error);
        return false;
    }
}

export function removePreference(label: string, key: string, isAuthorized: () => boolean): boolean {
    try {
        const storage = globalThis.localStorage;
        if (!isAuthorized()) return false;
        storage.removeItem(key);
        return true;
    } catch (error) {
        console.warn(`Unable to clear ${label}.`, error);
        return false;
    }
}

/** Pure read: malformed/unsupported data never causes a write or removal. */
export function readCurrentJson<T>(key: string, maxTextLength: number, validate: (value: unknown) => value is T): T | null {
    try {
        const text = globalThis.localStorage.getItem(key);
        if (text === null || text.length > maxTextLength) return null;
        const value: unknown = JSON.parse(text);
        return validate(value) ? value : null;
    } catch {
        return null;
    }
}
