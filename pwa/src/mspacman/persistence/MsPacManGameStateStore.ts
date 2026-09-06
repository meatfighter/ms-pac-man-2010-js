import type { GameContainer } from "slick2d-ts";
import { createBrowserStorageKeys } from "../../app/BrowserStorageKeys";
import type { Main } from "../Main";
import { FIRST_PUBLIC_GAME_STATE_VERSION, GAME_STATE_VERSION, type MsPacManGameStateSnapshot } from "./GameStateSnapshot";
import { MsPacManGameStateSerializer } from "./MsPacManGameStateSerializer";

const JAVA_INT_MIN = -2_147_483_648;
const JAVA_INT_MAX = 2_147_483_647;
const MAX_GAMEPLAY_NUMBER_MAGNITUDE = 100_000;
const MAX_SNAPSHOT_STRING_LENGTH = 4_096;
import { MAX_SNAPSHOT_TEXT_LENGTH } from "../../app/SnapshotLimits.js";

export class MsPacManGameStateStore {
    private readonly serializer = new MsPacManGameStateSerializer();

    public constructor(private readonly appVersion: string) {}

    public save(main: Main): boolean {
        if (!main.isStateSaveReady()) {
            return false;
        }

        try {
            if (this.hasProtectedStoredSnapshot()) {
                return false;
            }
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
        } catch {}
    }

    private readSnapshot(): MsPacManGameStateSnapshot | null {
        const text = localStorage.getItem(createBrowserStorageKeys().gameState);
        if (text === null) {
            return null;
        }
        if (text.length > MAX_SNAPSHOT_TEXT_LENGTH) {
            // An older client cannot safely classify a larger public snapshot.
            return null;
        }

        let snapshot: unknown;
        try {
            snapshot = JSON.parse(text) as unknown;
        } catch {
            this.clear();
            return null;
        }

        if (!this.serializer.isSupportedSnapshot(snapshot)) {
            if (this.shouldPreserveUnsupportedPublicSnapshot(snapshot)) {
                return null;
            }
            this.clear();
            return null;
        }
        if (!hasReasonableSnapshotValues(snapshot)) {
            this.clear();
            return null;
        }

        normalizeTransientState(snapshot);
        return snapshot;
    }

    private hasProtectedStoredSnapshot(): boolean {
        const text = localStorage.getItem(createBrowserStorageKeys().gameState);
        if (text === null) {
            return false;
        }
        if (text.length > MAX_SNAPSHOT_TEXT_LENGTH) {
            return true;
        }
        try {
            return this.shouldPreserveUnsupportedPublicSnapshot(JSON.parse(text) as unknown);
        } catch {
            return false;
        }
    }

    private shouldPreserveUnsupportedPublicSnapshot(snapshot: unknown): boolean {
        if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) {
            return false;
        }
        const version = Reflect.get(snapshot, "version");
        return typeof version === "number" && Number.isInteger(version) && version >= FIRST_PUBLIC_GAME_STATE_VERSION && version !== GAME_STATE_VERSION;
    }
}

function normalizeTransientState(snapshot: MsPacManGameStateSnapshot): void {
    // Score submission is best-effort network work tied to the current page
    // lifetime. Preserve ordinary state exactly, but if the saved initials screen
    // had already submitted, never restore a request that cannot still exist.
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
