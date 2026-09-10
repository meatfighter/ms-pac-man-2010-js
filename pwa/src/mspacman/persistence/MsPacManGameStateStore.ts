import type { GameContainer } from "slick2d-ts";
import { createBrowserStorageKeys } from "../../app/BrowserStorageKeys";
import { MAX_SNAPSHOT_TEXT_LENGTH } from "../../app/SnapshotLimits.js";
import type { Main } from "../Main";
import type { MsPacManGameStateSnapshot } from "./GameStateSnapshot";
import { MsPacManGameStateSerializer } from "./MsPacManGameStateSerializer";

const JAVA_INT_MIN = -2_147_483_648;
const JAVA_INT_MAX = 2_147_483_647;
const MAX_GAMEPLAY_NUMBER_MAGNITUDE = 100_000;
const MAX_SNAPSHOT_STRING_LENGTH = 4_096;

/** Only the current development schema is supported in its deployment-scoped storage slot. */
export class MsPacManGameStateStore {
    private readonly serializer = new MsPacManGameStateSerializer();

    public constructor(private readonly appVersion: string) {}

    public save(main: Main): boolean {
        if (!main.isStateSaveReady()) {
            return false;
        }
        try {
            const snapshot = this.serializer.createSnapshot(main, this.appVersion);
            normalizeTransientState(snapshot);
            if (!this.serializer.isSupportedSnapshot(snapshot) || !hasReasonableSnapshotValues(snapshot)) {
                return false;
            }
            const text = JSON.stringify(snapshot);
            if (text.length > MAX_SNAPSHOT_TEXT_LENGTH) {
                return false;
            }
            localStorage.setItem(createBrowserStorageKeys().gameState, text);
            return true;
        } catch (error) {
            console.warn("Unable to save MS Pac-Man game state.", error);
            return false;
        }
    }

    public restore(main: Main, gc: GameContainer): boolean {
        try {
            const snapshot = this.readSnapshot();
            if (snapshot === null) {
                return false;
            }
            this.serializer.restoreSnapshot(main, gc, snapshot);
            return true;
        } catch (error) {
            console.warn("Unable to restore MS Pac-Man game state.", error);
            return false;
        }
    }

    public hasValidSave(): boolean {
        try {
            return this.readSnapshot() !== null;
        } catch (error) {
            console.warn("Unable to inspect MS Pac-Man game state.", error);
            return false;
        }
    }

    public clear(): void {
        try {
            localStorage.removeItem(createBrowserStorageKeys().gameState);
        } catch (error) {
            console.warn("Unable to clear MS Pac-Man game state.", error);
        }
    }

    private readSnapshot(): MsPacManGameStateSnapshot | null {
        const text = localStorage.getItem(createBrowserStorageKeys().gameState);
        if (text === null) {
            return null;
        }
        if (text.length > MAX_SNAPSHOT_TEXT_LENGTH) {
            this.clear();
            return null;
        }
        let snapshot: unknown;
        try {
            snapshot = JSON.parse(text) as unknown;
        } catch {
            this.clear();
            return null;
        }
        if (!this.serializer.isSupportedSnapshot(snapshot) || !hasReasonableSnapshotValues(snapshot)) {
            this.clear();
            return null;
        }
        normalizeTransientState(snapshot);
        return snapshot;
    }
}

function normalizeTransientState(snapshot: MsPacManGameStateSnapshot): void {
    // An old network request cannot survive a page lifetime. Do not resubmit it
    // merely because the persisted initials screen had already submitted.
    if (snapshot.mode.id === "enterInitials" && snapshot.mode.fields.enterPressed === true) {
        snapshot.mainFields.uploadComplete = true;
    }
    snapshot.submittedScore = null;
}

function hasReasonableSnapshotValues(value: unknown, key = ""): boolean {
    if (value === null || typeof value === "boolean") {
        return true;
    }
    if (typeof value === "string") {
        return value.length <= MAX_SNAPSHOT_STRING_LENGTH;
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            return false;
        }
        if (key === "score") {
            return Number.isInteger(value) && value >= JAVA_INT_MIN && value <= JAVA_INT_MAX;
        }
        return Math.abs(value) <= MAX_GAMEPLAY_NUMBER_MAGNITUDE;
    }
    if (Array.isArray(value)) {
        return value.every((entry) => hasReasonableSnapshotValues(entry));
    }
    if (typeof value !== "object") {
        return false;
    }
    for (const [entryKey, entryValue] of Object.entries(value)) {
        if (!hasReasonableSnapshotValues(entryValue, entryKey)) {
            return false;
        }
    }
    return true;
}
