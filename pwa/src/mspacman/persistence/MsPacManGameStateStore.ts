import { hasReasonableSnapshotValues } from "./SnapshotValuePolicy.js";
import { captureAndWriteSnapshot, removePreference, type SnapshotWriteResult } from "../../app/BrowserPersistence.js";
import type { GameContainer } from "slick2d-ts";
import { createBrowserStorageKeys } from "../../app/BrowserStorageKeys";
import { MAX_SNAPSHOT_TEXT_LENGTH } from "../../app/SnapshotLimits.js";
import type { Main } from "../Main";
import { type MsPacManGameStateSnapshot } from "./GameStateSnapshot";
import { MsPacManGameStateSerializer } from "./MsPacManGameStateSerializer";

export type StoredMsPacManGameStateInspection =
    | { readonly status: "read-failed" }
    | { readonly status: "missing" }
    | { readonly status: "invalid" }
    | { readonly status: "current"; readonly snapshot: MsPacManGameStateSnapshot };

export type MsPacManGameStateWriteResult = SnapshotWriteResult;

/** Only the current exact schema is supported in its deployment-scoped storage slot. */
export class MsPacManGameStateStore {
    private readonly serializer = new MsPacManGameStateSerializer();

    public constructor(private readonly appVersion: string) {}

    public save(main: Main, isAuthorized: () => boolean): MsPacManGameStateWriteResult {
        if (!main.isStateSaveReady()) return { saved: false, reason: "invalid-snapshot" };
        return captureAndWriteSnapshot(
            "Ms. Pac-Man game state",
            createBrowserStorageKeys().gameState,
            () => this.serializer.createSnapshot(main, this.appVersion),
            (snapshot) => this.isSnapshotValid(snapshot),
            MAX_SNAPSHOT_TEXT_LENGTH,
            isAuthorized
        );
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
        return removePreference("Ms. Pac-Man game state", createBrowserStorageKeys().gameState, isAuthorized);
    }

    public inspectStoredGameState(): StoredMsPacManGameStateInspection {
        let text: string | null;
        try {
            text = globalThis.localStorage.getItem(createBrowserStorageKeys().gameState);
        } catch {
            return { status: "read-failed" };
        }
        if (text === null) return { status: "missing" };
        if (text.length > MAX_SNAPSHOT_TEXT_LENGTH) return { status: "invalid" };
        try {
            const snapshot: unknown = JSON.parse(text);
            return this.isSnapshotValid(snapshot) ? { status: "current", snapshot: snapshot as MsPacManGameStateSnapshot } : { status: "invalid" };
        } catch {
            return { status: "invalid" };
        }
    }

    private isSnapshotValid(snapshot: unknown): snapshot is MsPacManGameStateSnapshot {
        return this.serializer.isSupportedSnapshot(snapshot) && hasReasonableSnapshotValues(snapshot);
    }
}
