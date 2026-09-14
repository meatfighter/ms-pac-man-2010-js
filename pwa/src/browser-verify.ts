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

    const store = new MsPacManGameStateStore("browser-verify");
    const first = await mountMain(null);
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

    assert(store.save(first.main), "Real browser Main could not create a save-state snapshot.");
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
    second.main.invalidateBrowserLifetime();
    second.container.destroy();
    Display.setParent(null);
    store.clear();
}

function soundStateForRef(
    ref: string,
    voices: Array<{ fraction: number; gain: number }>,
    activeVoiceIndex: number | null
): SoundPlaybackSnapshot {
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
