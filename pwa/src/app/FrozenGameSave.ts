import type { SnapshotWriteResult } from "./BrowserPersistence.js";

export interface SaveableRuntime {
    isStateSaveReady(): boolean;
}
export interface FreezableContainer {
    isDestroyed(): boolean;
    isLoopSuspended(): boolean;
}
export interface FrozenGameSaveOptions {
    readonly label: string;
    readonly reason: string;
    readonly game: SaveableRuntime | null;
    readonly container: FreezableContainer | null;
    readonly sameTarget: () => boolean;
    readonly accepted: () => boolean;
    readonly owned: () => boolean;
    readonly cleanupSafe: () => boolean;
    readonly write: (authorized: () => boolean) => SnapshotWriteResult | null;
    readonly didSave: () => void;
}

/** No reads, retries, native cleanup, or interpretation of an older stored record. */
export function saveFrozenGame(options: FrozenGameSaveOptions): boolean {
    const { game, container } = options;
    const skipped = (reason: string): false => {
        try {
            console.warn(`Unable to save ${options.label} during ${options.reason}: ${reason}.`);
        } catch {
            /* A diagnostic sink cannot become a resource-cleanup failure. */
        }
        return false;
    };
    // Empty/unaccepted candidates and nonowners are expected lifecycle no-ops.
    if (game === null || container === null || !options.sameTarget() || !options.accepted() || !options.owned()) return false;
    if (!options.cleanupSafe()) return skipped("cleanup-already-unsafe");
    if (container.isDestroyed()) return skipped("container-destroyed");
    if (!container.isLoopSuspended()) return skipped("loop-not-suspended");
    if (!game.isStateSaveReady()) return skipped("state-not-ready");
    const authorized = (): boolean =>
        !container.isDestroyed() && container.isLoopSuspended() && options.sameTarget() && options.accepted() && options.cleanupSafe() && options.owned();
    const result = options.write(authorized);
    if (result === null) return skipped("store-unavailable");
    if (result.saved === false) {
        // Store/BrowserPersistence already reports capture/validation/encoding/write errors.
        return result.reason === "not-authorized" ? skipped("authority-changed-before-write") : false;
    }
    // Native setItem success is real, but must not bless a replacement runtime.
    if (authorized()) options.didSave();
    return true;
}
