import { verifyCounterParity } from "./CounterParityVerification.js";
import { EnterInitialsMode } from "./mspacman/EnterInitialsMode.js";
import { Sys } from "slick2d-ts";
import { PlayingMode } from "./mspacman/PlayingMode.js";
import {
    MsPacManGameStateSerializer,
    isValidMsPacManGameStateSnapshot,
    isValidSnapshotForLoadedResources
} from "./mspacman/persistence/MsPacManGameStateSerializer.js";
import { createBrowserStorageKeys } from "./app/BrowserStorageKeys.js";
import { verifyAuthoritativeSave } from "./PersistenceContractVerification.js";
import { AppGameContainer, Display, ResourceLoader, SoundStore, type SoundPlaybackSnapshot } from "slick2d-ts";
import { RESOURCE_REFS } from "./app/resourceManifest.js";
import { getResourceVersion } from "./app/ResourceVersions.js";
import { Main } from "./mspacman/Main.js";
import { MsPacManGameStateStore } from "./mspacman/persistence/MsPacManGameStateStore.js";
import { ScalableGame2 } from "./mspacman/ScalableGame2.js";

const result = document.querySelector<HTMLElement>("#result");
const host = document.querySelector<HTMLElement>("#game-host");
if (result === null || host === null) {
    throw new Error("Browser verification fixture is missing required elements.");
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function preloadRuntimeResources(): Promise<void> {
    ResourceLoader.clearCache();
    ResourceLoader.removeAllResourceLocations();
    ResourceLoader.addResourceLocation(new URL("./", window.location.href));
    ResourceLoader.setCacheBust(null);
    ResourceLoader.setCacheVersionResolver(getResourceVersion);
    const refs = Array.from(new Set(RESOURCE_REFS));
    const audio = refs.filter((ref) => ref.endsWith(".ogg"));
    const other = refs.filter((ref) => !ref.endsWith(".ogg"));
    await Promise.all([ResourceLoader.preloadResources(other, { concurrency: 6 }), SoundStore.get().preloadAudioBuffers(audio, { concurrency: 4 })]);
}

async function waitForGameReady(main: Main): Promise<void> {
    const deadline = performance.now() + 15_000;
    while (main.isLoadingScreenActive() && performance.now() < deadline) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    assert(!main.isLoadingScreenActive(), "Real Ms. Pac-Man Main did not complete browser startup.");
}

async function mountMain(restore: ((main: Main, container: AppGameContainer) => boolean) | null): Promise<{
    main: Main;
    buffered: ScalableGame2;
    container: AppGameContainer;
}> {
    host.replaceChildren();
    Display.setParent(host);
    const main = new Main();
    const buffered = new ScalableGame2(main, 800, 600, true);
    const container = new AppGameContainer(buffered, 1000, 750, false);
    container.setPreserveAudioCacheOnDestroy(true);
    container.setLoopSuspended(false);
    container.setHighDpiEnabled(true);
    container.setMaxDevicePixelRatio(2);
    container.setAlwaysRender(true);
    container.setVSync(true);
    container.setSmoothDeltas(false);
    container.setShowFPS(false);
    container.setClearEachFrame(true);
    main.appGameContainer = container;
    if (restore !== null) {
        main.loadingCompleteHandler = () => {
            container.setLoopSuspended(true);
            assert(restore(main, container), "Saved state restore failed; default startup must not count as restoration.");
            return true;
        };
    }
    await container.setDisplayMode(1000, 750, false);
    await container.start();
    await ResourceLoader.waitForAll();
    await waitForGameReady(main);
    assert(buffered.getPresentationInfo().physicalWidth > 0, "Buffered presentation did not acquire a physical width.");
    return { main, buffered, container };
}

async function verify(): Promise<void> {
    localStorage.clear();
    await preloadRuntimeResources();

    if (new URLSearchParams(location.search).get("suite") === "high-score-seed") {
        const mounted = await mountMain(null);
        const { main, container } = mounted;
        container.setLoopSuspended(true);
        main.score = 123450;
        main.worldIndex = 0;
        main.demoMode = false;
        main.setMode(Main.enterInitialsMode, container);
        Reflect.set(Main.enterInitialsMode, "editingIndex", 2);
        Reflect.set(Main.enterInitialsMode, "fadeState", 0);
        Reflect.set(Main.enterInitialsMode, "fadeIndex", 0);
        const serializer = new MsPacManGameStateSerializer();
        const snapshot = serializer.createSnapshot(main, "durability-seed");
        assert(isValidMsPacManGameStateSnapshot(snapshot) && isValidSnapshotForLoadedResources(main, snapshot), "Valid loaded initials seed");
        Reflect.set(window, "scoreDurabilitySeed", JSON.stringify(snapshot));
        main.invalidateBrowserLifetime();
        main.stopAllSounds();
        container.destroy();
        Display.setParent(null);
        return;
    }
    if (new URLSearchParams(location.search).get("suite") === "counter-parity") {
        await verifyCounterParity(mountMain);
        return;
    }
    const store = new MsPacManGameStateStore("browser-verify");
    const first = await mountMain(null);
    verifyAuthoritativeSave(createBrowserStorageKeys().gameState, first.main, (main) => store.save(main, () => true));
    const savedMode = first.main.getCurrentModeIdForState();
    assert(savedMode === "attract", `Expected the real game to start in attract mode, got ${savedMode}.`);
    first.main.score = 123450;
    first.main.lives = 3;

    const blueGhosts = soundStateForRef("soundfx/blue_ghosts.ogg", [{ fraction: 0.35, gain: 0.8 }], 0);
    const clapping = soundStateForRef("soundfx/clapping.ogg", [{ fraction: 0.2, gain: 1 }], 0);
    const died = soundStateForRef("soundfx/died.ogg", [{ fraction: 0.3, gain: 0.6 }], 0);
    const speech = soundStateForRef("soundfx/speaking_2_7.ogg", [{ fraction: 0.4, gain: 1 }], 0);
    const overlappingPellets = soundStateForRef(
        "soundfx/ate_pellot.ogg",
        [
            { fraction: 0.25, gain: 0.5 },
            { fraction: 0.125, gain: 0.25 }
        ],
        null
    );
    first.main.blueGhostsSound.restorePlaybackState(blueGhosts);
    first.main.clappingSound.restorePlaybackState(clapping);
    first.main.diedSound.restorePlaybackState(died);
    first.main.speaking[1][7].restorePlaybackState(speech);
    first.main.atePellotSound.restorePlaybackState(overlappingPellets);

    const saveResult = store.save(first.main, () => true);
    assert(saveResult.saved, `Real browser Main could not create a save-state snapshot: ${JSON.stringify(saveResult)}`);
    first.buffered.setScalingPreference("smooth");
    first.buffered.setScalingPreference("pixel-perfect");
    first.buffered.setScalingPreference("crisp");
    first.main.invalidateBrowserLifetime();
    first.container.destroy();
    Display.setParent(null);

    const second = await mountMain((main, container) => store.restore(main, container));
    assert(second.main.getCurrentModeIdForState() === savedMode, "A fresh browser Main did not restore the saved mode.");
    assert(second.main.isStateSaveReady(), "Restored browser Main is not save-state ready.");
    assert(second.main.score === 123450 && second.main.lives === 3, "Fresh Main must restore non-default score and lives.");
    assertSoundState(second.main.blueGhostsSound.capturePlaybackState(), blueGhosts, "blue ghosts");
    assertSoundState(second.main.clappingSound.capturePlaybackState(), clapping, "stage-clear clapping");
    assertSoundState(second.main.diedSound.capturePlaybackState(), died, "death");
    assertSoundState(second.main.speaking[1][7].capturePlaybackState(), speech, "speech");
    assertSoundState(second.main.atePellotSound.capturePlaybackState(), overlappingPellets, "overlapping pellet voices");
    assert(second.main.extraLifeSound.capturePlaybackState().voices.length === 0, "Unlisted Sound state should restore empty.");
    verifyInitialsEdges(second);
    await verifyTerminalGameplay(second);
    await verifyCounterParity(mountMain);
    assert(
        store.clear(() => true),
        "Real browser save-state cleanup failed."
    );
}

function soundStateForRef(ref: string, voices: Array<{ fraction: number; gain: number }>, activeVoiceIndex: number | null): SoundPlaybackSnapshot {
    const buffer = SoundStore.get().getDecodedAudioBuffer(ref);
    assert(buffer !== null && Number.isFinite(buffer.duration) && buffer.duration > 0, `Missing decoded duration for ${ref}.`);
    return {
        voices: voices.map(({ fraction, gain }) => {
            assert(fraction > 0 && fraction < 1, `Invalid test offset fraction for ${ref}: ${fraction}`);
            return {
                looped: false,
                playbackRate: 1,
                positionSeconds: buffer.duration * fraction,
                gain,
                spatialPosition: null
            };
        }),
        activeVoiceIndex
    };
}

function assertSoundState(actual: SoundPlaybackSnapshot, expected: SoundPlaybackSnapshot, label: string): void {
    assert(
        JSON.stringify(actual) === JSON.stringify(expected),
        `${label} Sound playback state did not round-trip exactly. expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`
    );
}

void verify().then(
    () => {
        result.dataset.status = "passed";
        result.textContent = "Real Ms. Pac-Man 2010 browser boot/save/restore verification passed.";
    },
    (error: unknown) => {
        console.error(error);
        result.dataset.status = "failed";
        result.textContent = error instanceof Error ? (error.stack ?? error.message) : String(error);
    }
);

/** Real actors, original maze geometry, terminal save and fresh-runtime continuation. */
async function verifyTerminalGameplay(initial: Awaited<ReturnType<typeof mountMain>>): Promise<void> {
    let mounted: Awaited<ReturnType<typeof mountMain>> | null = initial;
    const serializer = new MsPacManGameStateSerializer();
    const store = new MsPacManGameStateStore("terminal-browser");
    const originalClock = Object.getOwnPropertyDescriptor(Sys, "getTime");
    assert(originalClock !== undefined, "Missing runtime clock descriptor");
    let now = Sys.getTime();
    const release = (): void => {
        document.querySelector("canvas")?.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowRight", key: "ArrowRight", bubbles: true }));
    };
    const destroy = (): void => {
        if (mounted === null) return;
        release();
        mounted.main.stopAllSounds();
        mounted.main.invalidateBrowserLifetime();
        mounted.container.destroy();
        Display.setParent(null);
        mounted = null;
    };
    const step = (): void => {
        assert(mounted !== null, "Missing terminal runtime");
        mounted.container.getInput().poll(1000, 750);
        now += 11;
        mounted.main.nextFrameTime = now - 1;
        mounted.main.update(mounted.container, 11);
    };
    try {
        Object.defineProperty(Sys, "getTime", { configurable: true, value: () => now });
        for (const scenario of ["pellet", "energizer", "death", "reserve"] as const) {
            if (mounted === null) mounted = await mountMain(null);
            const { main, container } = mounted;
            await new Promise<void>((resolve, reject) => {
                const button = document.createElement("button");
                button.id = "terminal-audio";
                button.textContent = "Run terminal audio case";
                button.onclick = () => {
                    button.remove();
                    void SoundStore.get()
                        .beginPlaybackGenerationFromUserGesture()
                        .then((ok) => {
                            if (ok) resolve();
                            else reject(new Error("Terminal fixture needs committed audio playback"));
                        }, reject);
                };
                document.body.append(button);
            });
            container.setLoopSuspended(true);
            container.getInput().resume();
            main.setBrowserSuspended(false);
            main.demoMode = false;
            main.stageIndex = 7;
            main.worldIndex = 0;
            main.score = scenario === "energizer" || scenario === "death" ? 9950 : 0;
            main.lives = scenario === "reserve" ? 1 : 0;
            const world = main.getPlayingModeForState();
            main.setMode(world, container);
            world.fadeState = PlayingMode.FADE_NONE;
            world.readyTimer = 0;
            world.exitIndex = 4;
            world.chaseMode = true;
            const player = world.mspacman;
            const completion = scenario === "pellet" || scenario === "energizer";
            if (completion) {
                const type = scenario === "energizer" ? PlayingMode.TYPE_ENERGIZER : PlayingMode.TYPE_PELLOT;
                let selected = false;
                for (let y = 0; y < 31; y++)
                    for (let x = 0; x < 28; x++) {
                        const cell = world.typeMap[y][x];
                        if (cell === type && !selected) {
                            player.x = x * 16;
                            player.y = y * 16;
                            selected = true;
                        } else if (cell === PlayingMode.TYPE_PELLOT || cell === PlayingMode.TYPE_ENERGIZER) {
                            world.typeMap[y][x] = PlayingMode.TYPE_EMPTY;
                            world.tileMap[y][x] = 47;
                        }
                    }
                assert(selected, "No real consumable arena tile");
                world.pelletsRemaining = 1;
                player.speedBoost = true;
            } else {
                player.x = 216;
                player.y = 368;
                const tile = player.getType(player.x + 8, player.y + 8);
                if (tile === PlayingMode.TYPE_PELLOT || tile === PlayingMode.TYPE_ENERGIZER) {
                    player.setType(player.x + 8, player.y + 8, PlayingMode.TYPE_EMPTY);
                    player.setTile(player.x + 8, player.y + 8, 47);
                    world.pelletsRemaining--;
                }
                world.redEnergizerPresent = true;
            }
            player.direction = Main.RIGHT;
            player.speedRemainder = Math.fround(0.9);
            world.regionCounts.fill(0);
            for (const ghost of world.ghosts) {
                if (ghost.ghostIndex === Main.RED) {
                    ghost.x = player.x + 1;
                    ghost.y = player.y;
                    ghost.direction = Main.LEFT;
                    ghost.inHome = false;
                    ghost.exitingHome = false;
                    ghost.blue = false;
                    ghost.eyeBalls = false;
                }
                ghost.speedRemainder = Math.fround(0.9);
                world.incrementRegionCount(ghost);
            }
            const ghostCalls = [0, 0, 0, 0];
            const restores: Array<() => void> = [];
            let playerBoundary: string | null = null;
            const playerState = (): string =>
                JSON.stringify([player.x, player.y, player.direction, player.spriteIndex, player.spriteIndexIncrementor, player.pellotDampensSpeed]);
            const ate = world.atePellot;
            world.atePellot = (...args: Parameters<PlayingMode["atePellot"]>): void => {
                ate.apply(world, args);
                if (world.finished) playerBoundary = playerState();
            };
            restores.push(() => {
                world.atePellot = ate;
            });
            for (const ghost of world.ghosts) {
                const update = ghost.update;
                ghost.update = (gc): void => {
                    ghostCalls[ghost.ghostIndex]++;
                    update.call(ghost, gc);
                };
                restores.push(() => {
                    ghost.update = update;
                });
            }
            try {
                const canvas = document.querySelector("canvas");
                assert(canvas !== null, "Missing canvas");
                canvas.focus();
                canvas.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight", key: "ArrowRight", bubbles: true }));
                step();
                if (completion) {
                    assert(world.finished && !world.playerKilledFlag, scenario + ": completion followed by death");
                    assert(playerState() === playerBoundary, scenario + ": player work after completion");
                    assert(
                        ghostCalls.every((v) => v === 0),
                        scenario + ": ghost tail after completion"
                    );
                    assert(main.score === (scenario === "energizer" ? 10010 : 10), scenario + ": lost tile points");
                    assert(main.lives === (scenario === "energizer" ? 1 : 0), "Final energizer reserve credit");
                    assert(main.clappingSound.capturePlaybackState().voices.length > 0, "Applause canceled");
                    for (const sound of [main.atePellotSound, main.ateEnergizerSound, main.blueGhostsSound])
                        assert(sound.capturePlaybackState().voices.length === 0, "Post-completion cue");
                } else {
                    assert(world.playerKilledFlag && !world.finished, "Contact did not cause death");
                    assert(
                        main.score === (scenario === "death" ? 9950 : 0) && main.lives === (scenario === "reserve" ? 1 : 0),
                        "Post-death bonus/reserve award"
                    );
                    assert(world.redEnergizerPresent && world.energizerTimer === 0, "Post-death red bonus tail");
                    assert(ghostCalls[0] === 1 && ghostCalls.slice(1).every((v) => v === 0), "Post-death ghost tail");
                }
                for (const actor of [player, ...world.ghosts])
                    assert(actor.speedRemainder >= 0 && actor.speedRemainder < 1, "Invalid terminal motion fraction");
                const snapshot = serializer.createSnapshot(main, "terminal-browser");
                assert(isValidMsPacManGameStateSnapshot(snapshot) && isValidSnapshotForLoadedResources(main, snapshot), "Terminal snapshot rejected");
                assert(store.save(main, () => true).saved, "Terminal store save failed");
            } finally {
                for (const restore of restores.reverse()) restore();
                release();
            }
            destroy();
            let observed = false;
            mounted = await mountMain((fresh, gc) => {
                const restored = store.restore(fresh, gc);
                if (restored) {
                    gc.setLoopSuspended(true);
                    observed = true;
                }
                return restored;
            });
            assert(observed, "Terminal restore callback missing");
            mounted.container.setLoopSuspended(true);
            const resumed = mounted.main.getPlayingModeForState();
            assert(completion ? resumed.finished : resumed.playerKilledFlag, "Restored terminal ownership lost");
            assert(mounted.main !== main && mounted.container !== container, "Restore reused the old runtime");
            // Complete the logical one-shot in the fixture. Continuation must not
            // request clapping again just because its saved mode remains finished.
            mounted.main.clappingSound.restorePlaybackState({ voices: [], activeVoiceIndex: null });
            if (completion) {
                for (let i = 0; i < 599; i++) step();
                assert(resumed.finishedTimer === 599 && resumed.fadeState === PlayingMode.FADE_NONE, "Completion timer drift");
                step();
                assert(Number(resumed.finishedTimer) === 600 && Number(resumed.fadeState) === PlayingMode.FADE_OUT, "600-tick completion lost");
                assert(mounted.main.clappingSound.capturePlaybackState().voices.length === 0, "Completed applause replayed");
                for (let i = 0; i < 24; i++) step();
                assert(mounted.main.stageIndex === 8, "Completion failed to advance the same restored stage");
            } else {
                for (let i = 0; i < 91; i++) step();
                assert(resumed.playerSpiraling && resumed.musicFadeOutTimer === 91 && resumed.spiralTimer === 0, "Death music timing changed");
                for (let i = 0; i < 182; i++) step();
                assert(Number(resumed.spiralTimer) === 182 && !resumed.gameOver, "Death spiral timing changed");
                step();
                if (scenario === "death")
                    assert(resumed.gameOver && mounted.main.lives === 0 && mounted.main.score === 9950, "Spurious reserve prevented game over");
                else {
                    assert(!resumed.gameOver && Number(resumed.fadeState) === PlayingMode.FADE_OUT, "Reserve did not request respawn");
                    for (let i = 0; i < 24; i++) step();
                    assert(!resumed.playerKilledFlag && mounted.main.lives === 0 && resumed.readyTimer > 0, "Ordinary reserve respawn changed");
                }
            }
            destroy();
        }
    } finally {
        destroy();
        store.clear(() => true);
        document.querySelector("#terminal-audio")?.remove();
        Object.defineProperty(Sys, "getTime", originalClock);
    }
}

function verifyInitialsEdges(mounted: Awaited<ReturnType<typeof mountMain>>): void {
    const { main, container } = mounted;
    const input = container.getInput();
    const canvas = host.querySelector("canvas");
    assert(canvas !== null, "Initials canvas");
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "getGamepads");
    const pad = {
        id: "initials-edge-pad",
        index: 0,
        connected: true,
        mapping: "standard",
        timestamp: 1,
        axes: [0, 0],
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }))
    };
    container.setLoopSuspended(true);
    canvas.focus();
    const poll = (): void => {
        pad.timestamp++;
        input.poll(800, 600);
    };
    const key = (type: string, code: string): void => {
        canvas.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }));
    };
    try {
        Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad] });
        poll();
        for (const controller of [false, true]) {
            const mode = new EnterInitialsMode();
            mode.init(main, container);
            Reflect.set(mode, "editingIndex", 1);
            if (controller) {
                pad.axes = [-1, 1];
            } else {
                key("keydown", "ArrowLeft");
                key("keydown", "ArrowDown");
            }
            poll();
            mode.update(container);
            mode.update(container);
            assert(Reflect.get(mode, "editingIndex") === 0 && Reflect.get(mode, "initials") === "AAA", "Real Input poll queued losing initials edge");
            mode.update(container);
            assert(Reflect.get(mode, "initials") === "AAA", "Held initials input repeated");
            pad.axes = [0, 0];
            key("keyup", "ArrowLeft");
            key("keyup", "ArrowDown");
            poll();
            mode.update(container);
            if (controller) pad.axes = [0, 1];
            else key("keydown", "ArrowDown");
            poll();
            mode.update(container);
            assert(Reflect.get(mode, "initials") === "BAA", "First fresh initials Down lost");
            pad.axes = [0, 0];
            key("keyup", "ArrowDown");
            poll();
            mode.update(container);
        }
    } finally {
        pad.axes = [0, 0];
        key("keyup", "ArrowLeft");
        key("keyup", "ArrowDown");
        poll();
        input.clearKeyPressedRecord();
        input.clearControlPressedRecord();
        if (descriptor) Object.defineProperty(navigator, "getGamepads", descriptor);
        else Reflect.deleteProperty(navigator, "getGamepads");
        container.setLoopSuspended(false);
    }
}
