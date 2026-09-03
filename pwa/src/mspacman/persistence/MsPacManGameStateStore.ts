import type { GameContainer } from "slick2d-ts";
import { createBrowserStorageKeys } from "../../app/BrowserStorageKeys";
import type { Main } from "../Main";
import { FIRST_PUBLIC_GAME_STATE_VERSION, GAME_STATE_VERSION, type MsPacManGameStateSnapshot } from "./GameStateSnapshot";
import { MsPacManGameStateSerializer } from "./MsPacManGameStateSerializer";

export class MsPacManGameStateStore {
    private readonly serializer = new MsPacManGameStateSerializer();

    public constructor(private readonly appVersion: string) {}

    public save(main: Main): boolean {
        if (!main.isStateSaveReady()) {
            return false;
        }

        try {
            const snapshot = this.serializer.createSnapshot(main, this.appVersion);
            localStorage.setItem(createBrowserStorageKeys().gameState, JSON.stringify(snapshot));
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

        return snapshot;
    }

    private shouldPreserveUnsupportedPublicSnapshot(snapshot: unknown): boolean {
        if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) {
            return false;
        }
        const version = Reflect.get(snapshot, "version");
        return typeof version === "number" && Number.isInteger(version) && version >= FIRST_PUBLIC_GAME_STATE_VERSION && version !== GAME_STATE_VERSION;
    }
}
