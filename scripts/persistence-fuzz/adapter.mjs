import { invokeObservedRestore } from "./failure-protocol.mjs";
/* global document, location */
import { ResourceLoader } from "slick2d-ts";
import { RuntimeLoader } from "/src/app/RuntimeLoader.ts";
import { beginGameAudio, commitGameAudio, releaseGameAudio } from "/src/app/PlaybackSession.ts";
import { MsPacManGameStateSerializer } from "/src/mspacman/persistence/MsPacManGameStateSerializer.ts";
import { createBrowserStorageKeys } from "/src/app/BrowserStorageKeys.ts";
import { PlayingMode } from "/src/mspacman/PlayingMode.ts";
import { Main } from "/src/mspacman/Main.ts";
import { random } from "./prng.mjs";

export const gameId = "ms-pac-man-2010-js";
export const key = createBrowserStorageKeys().gameState;
export const debugKey = createBrowserStorageKeys().rejectedSaveDebug;
export const serializer = new MsPacManGameStateSerializer();
export { beginGameAudio, commitGameAudio, releaseGameAudio };
export async function mount(restore, version, probe) {
    ResourceLoader.removeAllResourceLocations();
    ResourceLoader.addResourceLocation(new URL("/", location.href));
    probe.stage = "runtime-prepare";
    const runtime = await new RuntimeLoader(() => {}).prepare();
    probe.restoreWitness.resourcesPrepared = true;
    probe.stage = "runtime-mount";
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
            probe.stage = "restore";
            probe.restoreWitness.expectedBytesVerified = typeof probe.expectedText === "string" && localStorage.getItem(key) === probe.expectedText;
            if (!probe.restoreWitness.expectedBytesVerified) throw new Error("Restore input bytes do not match this document's expected slot");
            if (!invokeObservedRestore(store, main, gc, probe.restoreWitness)) throw new Error("RESTORE_REJECTED");
            return true;
        };
    await container.start();
    await runtime.slick.ResourceLoader.waitForAll();
    return { main, container, game, store, runtime };
}
export function seed({ main, container }, spec, step) {
    main.demoMode = false;
    main.lives = 5;
    main.score = 0;
    main.worldIndex = spec.world;
    main.stageIndex = spec.stage;
    main.random.setSeed(spec.gameSeed);
    main.setMode(Main.playingMode, container);
    const world = main.getPlayingModeForState(),
        player = world.mspacman;
    let startupCallbacks = 0;
    while ((world.readyTimer > 0 || world.fadeState !== PlayingMode.FADE_NONE) && startupCallbacks++ < 300)
        step({ mask: 0, deltaMs: 11, renderCount: 1 }, "setup-producer");
    if (world.readyTimer > 0 || world.fadeState !== PlayingMode.FADE_NONE) throw new Error("SETUP: maze introduction did not reach gameplay");
    if (spec.recordingBoundary) {
        const { index, offset } = spec.recordingBoundary;
        const robot = main.robotInputs[index];
        robot.reset();
        const length = robot.data.length;
        for (let step = 0; step < length + offset; step++) robot.update();
        if (robot.getState().index !== length + offset) throw new Error("SETUP: recorded input producer did not reach boundary");
        return { strategy: "explicit-boundary", recording: { index, length, offset, cursor: robot.getState().index }, x: player.x, y: player.y };
    }
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
    // Ask the actual movement predicates after placement, including wrap rules.
    const headings = [
        [Main.UP, "canMoveUp"],
        [Main.DOWN, "canMoveDown"],
        [Main.LEFT, "canMoveLeft"],
        [Main.RIGHT, "canMoveRight"]
    ].filter(([, method]) => player[method]());
    if (!headings.length) throw new Error("SETUP: production movement rejects candidate footprint");
    player.direction = headings[rng.int(headings.length)][0];
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

// Benchmark substitution of only the extra resource preflight in the CURRENT stack.
export function validateBaseline(main, snapshot) {
    if (!serializer.isSupportedSnapshot(snapshot)) return "structure-and-graph";
    if (!hasReasonableSnapshotValues(snapshot)) return "values-and-audio";
    return null;
}

export function observedStratum({ main }) {
    return { stage: main.stageIndex, world: main.worldIndex, hard: false };
}

export { captureContext, transitionProjection } from "./transitions.mjs";
export function instrument({ main }, observer) {
    if (main.mode !== Main.playingMode) return;
    const world = main.getPlayingModeForState();
    observer.actor(world.mspacman, true);
    observer.input(world.input);
    for (const ghost of world.ghosts) observer.actor(ghost);
}
