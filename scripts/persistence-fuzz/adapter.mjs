/* global document, location */
import { ResourceLoader } from "slick2d-ts";
import { RuntimeLoader } from "/src/app/RuntimeLoader.ts";
import { beginGameAudio, commitGameAudio, releaseGameAudio } from "/src/app/PlaybackSession.ts";
import { MsPacManGameStateSerializer } from "/src/mspacman/persistence/MsPacManGameStateSerializer.ts";
import { createBrowserStorageKeys } from "/src/app/BrowserStorageKeys.ts";
import { Main } from "/src/mspacman/Main.ts";
import { random } from "./prng.mjs";

export const gameId = "ms-pac-man-2010-js";
export const key = createBrowserStorageKeys().gameState;
export const debugKey = createBrowserStorageKeys().rejectedSaveDebug;
export const serializer = new MsPacManGameStateSerializer();
export { beginGameAudio, commitGameAudio, releaseGameAudio };
export async function mount(restore, version) {
    ResourceLoader.removeAllResourceLocations();
    ResourceLoader.addResourceLocation(new URL("/", location.href));
    const runtime = await new RuntimeLoader(() => {}).prepare();
    const store = new runtime.MsPacManGameStateStore(version);
    runtime.slick.Display.setParent(document.querySelector("#game-host"));
    const main = new runtime.Main();
    const game = new runtime.ScalableGame2(main, 800, 600, true);
    const container = new runtime.slick.AppGameContainer(game, 800, 600, false);
    main.appGameContainer = container;
    container.setPreserveAudioCacheOnDestroy(true);
    container.setLoopSuspended(true);
    if (restore)
        main.loadingCompleteHandler = (gc) => {
            if (!store.restore(main, gc)) throw new Error("RESTORE_REJECTED");
            return true;
        };
    await container.start();
    await runtime.slick.ResourceLoader.waitForAll();
    return { main, container, game, store, runtime };
}
export function seed({ main, container }, spec) {
    main.demoMode = false;
    main.lives = 5;
    main.score = 0;
    main.worldIndex = spec.world;
    main.stageIndex = spec.stage;
    main.random.setSeed(spec.gameSeed);
    main.setMode(Main.playingMode, container);
    const world = main.getPlayingModeForState(),
        player = world.mspacman;
    if (spec.lane === "natural") return { strategy: "normal-maze-entry", x: player.x, y: player.y, world: spec.world, stage: spec.stage };
    const candidates = [];
    for (let y = 0; y < world.typeMap.length; y++)
        for (let x = 0; x < world.typeMap[y].length; x++) {
            if (world.typeMap[y][x] === 3) continue;
            const adjacent = [
                [x, (y + 30) % 31],
                [x, (y + 1) % 31],
                [(x + 27) % 28, y],
                [(x + 1) % 28, y]
            ];
            const directions = adjacent.flatMap(([tx, ty], direction) => (world.typeMap[ty][tx] !== 3 ? [direction] : []));
            if (directions.length) candidates.push({ x: x * 16, y: y * 16, directions });
        }
    if (!candidates.length) throw new Error("SETUP: maze has no movable non-wall cell");
    const rng = random(spec.setupSeed),
        point = candidates[rng.int(candidates.length)];
    player.x = point.x;
    player.y = point.y;
    player.direction = point.directions[rng.int(point.directions.length)];
    return { strategy: "passable-aligned-cell", x: player.x, y: player.y, direction: player.direction, world: spec.world, stage: spec.stage };
}
export function retire(mounted) {
    mounted.main.stopAllSounds();
    mounted.main.invalidateBrowserLifetime();
    mounted.container.destroy();
    mounted.runtime.slick.Display.setParent(null);
}
import { hasReasonableSnapshotValues } from "/src/mspacman/persistence/SnapshotValuePolicy.ts";
import { isValidSnapshotForLoadedResources } from "/src/mspacman/persistence/MsPacManGameStateSerializer.ts";
export function validate(main, snapshot) {
    if (!serializer.isSupportedSnapshot(snapshot)) return "structure-and-graph";
    if (!hasReasonableSnapshotValues(snapshot)) return "values-and-audio";
    return isValidSnapshotForLoadedResources(main, snapshot) ? null : "loaded-resources";
}

export function diagnose(_main, snapshot, stage) {
    // Do not invent a specific field cause when the production gate returns only
    // a boolean. Mode plus the complete snapshot supports later diagnosis.
    return { ownerType: `mode:${snapshot.mode.id}`, ruleCode: stage };
}

// Benchmark the former outgoing preflight boundary with the current serializer.
export function validateBaseline(main, snapshot) {
    if (!serializer.isSupportedSnapshot(snapshot)) return "structure-and-graph";
    if (!hasReasonableSnapshotValues(snapshot)) return "values-and-audio";
    return null;
}

export function observedStratum({ main }) {
    return { stage: main.stageIndex, world: main.worldIndex, hard: false };
}
