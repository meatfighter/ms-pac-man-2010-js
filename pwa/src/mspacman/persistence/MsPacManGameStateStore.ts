import type { GameContainer } from "slick2d-ts";
import { createBrowserStorageKeys } from "../../app/BrowserStorageKeys";
import type { Main } from "../Main";
import type { MsPacManGameStateSnapshot } from "./GameStateSnapshot";
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
            this.clear();
            return false;
        }
    }

    public hasValidSave(): boolean {
        try {
            return this.readSnapshot() !== null;
        } catch {
            this.clear();
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

        const snapshot = JSON.parse(text) as unknown;
        if (!this.serializer.isSupportedSnapshot(snapshot)) {
            this.clear();
            return null;
        }

        return snapshot;
    }
}
