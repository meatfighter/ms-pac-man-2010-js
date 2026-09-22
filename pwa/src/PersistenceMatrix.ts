import { Sys, ResourceLoader, type AppGameContainer } from "slick2d-ts";
import { beginGameAudio, commitGameAudio, releaseGameAudio } from "./app/PlaybackSession.js";
import { RuntimeLoader } from "./app/RuntimeLoader.js";
import { MsPacManGameStateSerializer } from "./mspacman/persistence/MsPacManGameStateSerializer.js";
import { createBrowserStorageKeys } from "./app/BrowserStorageKeys.js";

if (!import.meta.env.DEV || !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
    throw new Error("Persistence matrix is a local development fixture only.");
}
const gameHost = document.querySelector<HTMLElement>("#game-host")!;
const status = document.querySelector<HTMLElement>("#status")!;
const failure = document.querySelector<HTMLElement>("#failure")!;
const startButton = document.querySelector<HTMLButtonElement>("#start")!;
const verifyButton = document.querySelector<HTMLButtonElement>("#verify")!;
const resumeButton = document.querySelector<HTMLButtonElement>("#resume")!;
const casePicker = document.querySelector<HTMLSelectElement>("#case")!;
const notes = document.querySelector<HTMLInputElement>("#notes")!;
const cases: readonly string[] = [
    "Attract",
    "Select World",
    "Intro",
    "Playing ready/fade",
    "Playing movement",
    "Powerup/frightened",
    "Death/game-over",
    "Robot demo",
    "Act 1",
    "Act 2",
    "Act 3",
    "Act 4",
    "Act 5",
    "Act 6",
    "Act 7",
    "Real stage 8 Ending",
    "Ending phases",
    "Initials editing",
    "Initials submitted",
    "Hall of Fame",
    "Post-ending Select World"
];
for (const name of cases) casePicker.add(new Option(name, name));
const records: Array<Record<string, unknown>> = [];
let mounted: Mounted | null = null;
let busy = false;
let lockHeld = false;
let clock = 1_000_000;
const originalNow = Date.now;
const originalTime = Sys.getTime;
let wallOrigin = originalNow() - originalTime();
const label = "ms-pac-man-2010-js";

// Resource roots are the actual game's normal dev root, not this fixture's
// isolated /__persistence_matrix__/ storage scope.
ResourceLoader.removeAllResourceLocations();
ResourceLoader.addResourceLocation(new URL("../", location.href));
const loader = new RuntimeLoader(() => {});
let runtime: Awaited<ReturnType<RuntimeLoader["prepare"]>>;
type Main = InstanceType<Awaited<ReturnType<RuntimeLoader["prepare"]>>["Main"]>;
type Mounted = { main: Main; container: AppGameContainer };
const serializer = new MsPacManGameStateSerializer();
type Snapshot = ReturnType<MsPacManGameStateSerializer["createSnapshot"]>;
let store: InstanceType<Awaited<ReturnType<RuntimeLoader["prepare"]>>["MsPacManGameStateStore"]>;
async function prepare(): Promise<void> {
    runtime = await loader.prepare();
    store = new runtime.MsPacManGameStateStore(label);
}
async function mount(restore: boolean): Promise<Mounted> {
    gameHost.replaceChildren();
    runtime.slick.Display.setParent(gameHost);
    const main = new runtime.Main();
    const game = new runtime.ScalableGame2(main, 800, 600, true);
    const container = new runtime.slick.AppGameContainer(game, 800, 600, false);
    main.appGameContainer = container;
    container.setPreserveAudioCacheOnDestroy(true);
    container.setLoopSuspended(true);
    if (restore)
        main.loadingCompleteHandler = (gc) => {
            assert(store.restore(main, gc), "Fresh Pac restore rejected.");
            return true;
        };
    mounted = { main, container };
    await container.start();
    await runtime.slick.ResourceLoader.waitForAll();
    assert(main.isStateSaveReady(), "Pac init did not become save-ready.");
    return { main, container };
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}
function normalized(snapshot: Snapshot): string {
    const copy = JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>;
    delete copy.savedAt;
    // nextFrameTime is a reconstructed wall-clock schedule, not game progress.
    const fields = copy.mainFields;
    if (fields && typeof fields === "object" && !Array.isArray(fields)) delete (fields as Record<string, unknown>).nextFrameTime;
    return JSON.stringify(copy);
}
function freeze(): void {
    if (!mounted) return;
    mounted.container.setLoopSuspended(true);
    mounted.main.setBrowserSuspended(true);
    mounted.container.getInput().pause();
    releaseGameAudio();
}
function retire(): void {
    const previous = mounted;
    mounted = null;
    if (!previous) return;
    previous.main.stopAllSounds();
    previous.main.invalidateBrowserLifetime();
    previous.container.destroy();
    runtime.slick.Display.setParent(null);
}
function controlledTrace(value: Mounted, count: number): string[] {
    const trace: string[] = [];
    Date.now = () => wallOrigin + clock;
    Sys.getTime = () => clock;
    try {
        value.main.setBrowserSuspended(false);
        value.main.resetNextFrameTime();
        for (let frame = 0; frame < count; frame++) {
            clock += 10;
            value.main.update(value.container, 10);
            trace.push(normalized(serializer.createSnapshot(value.main, label)));
        }
        value.main.setBrowserSuspended(true);
        return trace;
    } finally {
        Date.now = originalNow;
        Sys.getTime = originalTime;
    }
}
async function execute(action: () => Promise<void>): Promise<void> {
    if (busy || !lockHeld) return;
    busy = true;
    failure.textContent = "";
    startButton.disabled = verifyButton.disabled = resumeButton.disabled = true;
    try {
        await action();
    } catch (error) {
        console.error(error);
        failure.textContent = error instanceof Error ? (error.stack ?? error.message) : String(error);
        status.textContent = "FAILED — not a passing evidence row.";
        try {
            freeze();
            retire();
        } catch (cleanupError) {
            console.error(cleanupError);
        }
    } finally {
        busy = false;
        startButton.disabled = false;
        verifyButton.disabled = mounted === null;
        resumeButton.disabled = mounted === null || mounted.container.isLoopSuspended() === false;
    }
}
startButton.addEventListener(
    "click",
    () =>
        void execute(async () => {
            freeze();
            retire();
            const audio = beginGameAudio();
            await prepare();
            mounted = await mount(false);
            assert(await audio.ready, "Playback preparation rejected.");
            assert(await commitGameAudio(audio), "Playback attachment rejected.");
            mounted.container.getInput().resume();
            mounted.main.setBrowserSuspended(false);
            mounted.container.setLoopSuspended(false);
            mounted.container.getInput().clearKeyPressedRecord();
            gameHost.querySelector<HTMLCanvasElement>("canvas")?.focus();
            status.textContent = "Drive the real game to a listed phase, then Pause and verify. No phase is fabricated by this fixture.";
        })
);
verifyButton.addEventListener(
    "click",
    () =>
        void execute(async () => {
            assert(mounted, "No runtime.");
            const name = casePicker.value;
            assert(notes.value.trim().length > 0, "Record the actual stage/phase/transition evidence before verifying.");
            freeze();
            assert(mounted.main.isStateSaveReady(), "This phase is not save-ready.");
            clock = originalTime();
            wallOrigin = originalNow() - clock;
            const baselineClock = clock;
            Date.now = () => wallOrigin + clock;
            Sys.getTime = () => clock;
            let source: Snapshot;
            try {
                assert(store.save(mounted.main, () => lockHeld).saved, "Production store rejected the real runtime.");
                const text = localStorage.getItem(createBrowserStorageKeys().gameState);
                assert(text !== null, "Production save is absent.");
                source = JSON.parse(text) as Snapshot;
            } finally {
                Date.now = originalNow;
                Sys.getTime = originalTime;
            }
            const expected = controlledTrace(mounted, 12);
            retire();
            clock = baselineClock;
            // Logical-only fresh restoration occurs while physical playback is deferred.
            Date.now = () => wallOrigin + clock;
            Sys.getTime = () => clock;
            try {
                mounted = await mount(true);
            } finally {
                Date.now = originalNow;
                Sys.getTime = originalTime;
            }
            Date.now = () => wallOrigin + clock;
            Sys.getTime = () => clock;
            let restored: Snapshot;
            try {
                restored = serializer.createSnapshot(mounted.main, label);
            } finally {
                Date.now = originalNow;
                Sys.getTime = originalTime;
            }
            assert(normalized(restored) === normalized(source), "Immediate durable recapture differs; do not discard additional fields to hide the mismatch.");
            const actual = controlledTrace(mounted, 12);
            assert(JSON.stringify(actual) === JSON.stringify(expected), "Fresh runtime continuation differs from the original neutral-input trace.");
            const entry = {
                case: name,
                evidence: notes.value.trim(),
                sourceMode: source.mode.id,
                passed: true,
                continuationFrames: 12,
                snapshot: source,
                capturedAt: new Date().toISOString(),
                userAgent: navigator.userAgent
            };
            records.push(entry);
            status.textContent = `Passed comparison for ${name}. This does not itself certify that the selected descriptive phase was reached; retain the recorded snapshot and transition notes.`;
            notes.value = "";
        })
);
resumeButton.addEventListener(
    "click",
    () =>
        void execute(async () => {
            assert(mounted, "No runtime.");
            const audio = beginGameAudio();
            assert(await audio.ready, "Playback preparation rejected.");
            assert(await commitGameAudio(audio), "Playback attachment rejected.");
            mounted.container.getInput().resume();
            mounted.main.setBrowserSuspended(false);
            mounted.container.setLoopSuspended(false);
            gameHost.querySelector<HTMLCanvasElement>("canvas")?.focus();
            status.textContent = "Running. Reach the next case through normal controls.";
        })
);
document.querySelector<HTMLButtonElement>("#export")!.addEventListener("click", () => {
    const reached = new Set(records.map((record) => record.case));
    const missing = cases.filter((name) => !reached.has(name));
    const report = {
        game: label,
        sourceRevision: "Record git rev-parse HEAD alongside this evidence",
        missing,
        completeCaseCoverage: missing.length === 0,
        phaseClassificationRequiresReview: true,
        records
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${label}-transition-evidence.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
});
if (!navigator.locks?.request) throw new Error("This fixture requires the same single-writer browser capability as the games.");
void navigator.locks.request(`persistence-matrix:${location.pathname}`, { ifAvailable: true }, async (lock) => {
    if (!lock) {
        status.textContent = "The matrix is already open in another tab.";
        startButton.disabled = true;
        return;
    }
    lockHeld = true;
    await new Promise<void>((resolve) =>
        window.addEventListener(
            "pagehide",
            () => {
                lockHeld = false;
                freeze();
                retire();
                resolve();
            },
            { once: true }
        )
    );
});
