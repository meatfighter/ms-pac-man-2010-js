import type { GameContainer } from "slick2d-ts";
import { createBrowserStorageKeys } from "../../app/BrowserStorageKeys";
import { MAX_SNAPSHOT_TEXT_LENGTH } from "../../app/SnapshotLimits.js";
import type { Main } from "../Main";
import { GAME_STATE_VERSION, type MsPacManGameStateSnapshot } from "./GameStateSnapshot";
import { MsPacManGameStateSerializer } from "./MsPacManGameStateSerializer";

const JAVA_INT_MIN = -2_147_483_648;
const JAVA_INT_MAX = 2_147_483_647;
const MAX_GAMEPLAY_NUMBER_MAGNITUDE = 100_000;
const MAX_SNAPSHOT_STRING_LENGTH = 4_096;

export type StoredMsPacManGameStateInspection =
    | { readonly status: "read-failed" }
    | { readonly status: "missing" }
    | { readonly status: "invalid" }
    | { readonly status: "unsupported-future"; readonly version: number }
    | { readonly status: "current"; readonly snapshot: MsPacManGameStateSnapshot };

export type MsPacManGameStateWriteResult =
    | { readonly saved: true }
    | {
          readonly saved: false;
          readonly reason:
              | "not-authorized"
              | "invalid-snapshot"
              | "read-failed"
              | "invalid-existing"
              | "unsupported-future"
              | "encode-failed"
              | "too-large"
              | "write-failed";
      };

/** Only the current exact schema is supported in its deployment-scoped storage slot. */
export class MsPacManGameStateStore {
    private readonly serializer = new MsPacManGameStateSerializer();

    public constructor(private readonly appVersion: string) {}

    public save(main: Main, isAuthorized: () => boolean): MsPacManGameStateWriteResult {
        if (!main.isStateSaveReady()) {
            return { saved: false, reason: "invalid-snapshot" };
        }
        try {
            const existing = this.inspectStoredGameState();
            switch (existing.status) {
                case "read-failed":
                    return { saved: false, reason: "read-failed" };
                case "invalid":
                    return { saved: false, reason: "invalid-existing" };
                case "unsupported-future":
                    return { saved: false, reason: "unsupported-future" };
                case "missing":
                case "current":
                    break;
            }

            const snapshot = this.serializer.createSnapshot(main, this.appVersion);
            if (!this.isSnapshotValid(snapshot)) {
                return { saved: false, reason: "invalid-snapshot" };
            }

            let text: string;
            try {
                text = JSON.stringify(snapshot);
            } catch {
                return { saved: false, reason: "encode-failed" };
            }
            if (text.length > MAX_SNAPSHOT_TEXT_LENGTH) {
                return { saved: false, reason: "too-large" };
            }
            if (!isAuthorized()) {
                return { saved: false, reason: "not-authorized" };
            }
            try {
                localStorage.setItem(createBrowserStorageKeys().gameState, text);
                return { saved: true };
            } catch (error) {
                console.warn("Unable to save MS Pac-Man game state.", error);
                return { saved: false, reason: "write-failed" };
            }
        } catch (error) {
            console.warn("Unable to save MS Pac-Man game state.", error);
            return { saved: false, reason: "encode-failed" };
        }
    }

    public restore(main: Main, gc: GameContainer): boolean {
        try {
            const stored = this.inspectStoredGameState();
            if (stored.status !== "current") {
                return false;
            }
            this.serializer.restoreSnapshot(main, gc, stored.snapshot);
            return true;
        } catch (error) {
            console.warn("Unable to restore MS Pac-Man game state.", error);
            return false;
        }
    }

    public hasValidSave(): boolean {
        return this.inspectStoredGameState().status === "current";
    }

    public clear(isAuthorized: () => boolean): boolean {
        if (!isAuthorized()) {
            return false;
        }
        try {
            localStorage.removeItem(createBrowserStorageKeys().gameState);
            return true;
        } catch (error) {
            console.warn("Unable to clear MS Pac-Man game state.", error);
            return false;
        }
    }

    public inspectStoredGameState(): StoredMsPacManGameStateInspection {
        let text: string | null;
        try {
            text = localStorage.getItem(createBrowserStorageKeys().gameState);
        } catch (error) {
            console.warn("Unable to inspect MS Pac-Man game state.", error);
            return { status: "read-failed" };
        }
        if (text === null) {
            return { status: "missing" };
        }
        if (text.length > MAX_SNAPSHOT_TEXT_LENGTH) {
            return { status: "invalid" };
        }

        let snapshot: unknown;
        try {
            snapshot = JSON.parse(text) as unknown;
        } catch {
            return { status: "invalid" };
        }

        if (
            snapshot !== null &&
            typeof snapshot === "object" &&
            !Array.isArray(snapshot) &&
            Object.hasOwn(snapshot, "version")
        ) {
            const version = Reflect.get(snapshot, "version");
            if (typeof version === "number" && Number.isInteger(version) && version > GAME_STATE_VERSION) {
                return { status: "unsupported-future", version };
            }
        }

        return this.isSnapshotValid(snapshot) ? { status: "current", snapshot } : { status: "invalid" };
    }

    private isSnapshotValid(snapshot: unknown): snapshot is MsPacManGameStateSnapshot {
        return this.serializer.isSupportedSnapshot(snapshot) && hasReasonableSnapshotValues(snapshot);
    }
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
