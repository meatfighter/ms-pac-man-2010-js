import { type AppGameContainer, Display } from "slick2d-ts";
import { Act5Mode } from "./mspacman/Act5Mode.js";
import { Act7Mode } from "./mspacman/Act7Mode.js";
import { EndingMode } from "./mspacman/EndingMode.js";
import { Main } from "./mspacman/Main.js";
import { PlayingMode } from "./mspacman/PlayingMode.js";
import { type ScalableGame2 } from "./mspacman/ScalableGame2.js";
import { type ModeId } from "./mspacman/persistence/GameStateSnapshot.js";
import {
    MsPacManGameStateSerializer,
    isValidMsPacManGameStateSnapshot,
    isValidSnapshotForLoadedResources
} from "./mspacman/persistence/MsPacManGameStateSerializer.js";
import { MsPacManGameStateStore } from "./mspacman/persistence/MsPacManGameStateStore.js";
import { createBrowserStorageKeys } from "./app/BrowserStorageKeys.js";

type Mounted = { main: Main; container: AppGameContainer; buffered: ScalableGame2 };
type Mount = (restore: ((main: Main, container: AppGameContainer) => boolean) | null) => Promise<Mounted>;
function assert(value: unknown, label: string): asserts value {
    if (!value) throw new Error(label);
}

/** Actual initialized singleton modes; retire each Main before mounting its replacement. */
export async function verifyCounterParity(mount: Mount): Promise<void> {
    const serializer = new MsPacManGameStateSerializer();
    const store = new MsPacManGameStateStore("counter-parity");
    const key = createBrowserStorageKeys().gameState;
    let mounted: Mounted | null = await mount(null);
    const current = (): Mounted => {
        assert(mounted, "Counter runtime");
        return mounted;
    };
    current().container.setLoopSuspended(true);
    const cases: string[] = [];
    const departureCheckpoints: Array<{ label: string; bytes: string }> = [];
    const times: number[] = [];
    const mode = () => current().main.getModeForStateRestore(current().main.getCurrentModeIdForState());
    const tick = (count = 1): void => {
        for (let i = 0; i < count; i++) {
            if (current().main.paused) current().main.update(current().container, 11);
            else mode().update(current().container);
        }
    };
    const field = (name: string): number => Number(Reflect.get(mode(), name));
    const render = (): void => mode().render(current().container, current().container.getGraphics());
    const capture = () => serializer.createSnapshot(current().main, "counter-parity");
    const comparable = (): string => {
        const s = capture();
        delete s.mainFields.nextFrameTime;
        return JSON.stringify({ main: s.mainFields, mode: s.mode, random: s.random, robots: s.robotInputs });
    };
    const destroy = (): void => {
        if (!mounted) return;
        mounted.main.stopAllSounds();
        mounted.main.invalidateBrowserLifetime();
        mounted.container.destroy();
        Display.setParent(null);
        mounted = null;
    };
    const check = (label: string): void => {
        const s = capture();
        const started = performance.now();
        assert(
            isValidMsPacManGameStateSnapshot(s) && isValidSnapshotForLoadedResources(current().main, s),
            `${label}: integrated validation ${JSON.stringify(s.mode.fields)}`
        );
        times.push(performance.now() - started);
        assert(store.save(current().main, () => true).saved && store.hasValidSave(), `${label}: store save`);
        if (["active:ghostsBlue:1", "ghost:death-retains-points", "ghost:finished-retains-points", "initials:100000:-32"].includes(label)) {
            departureCheckpoints.push({ label, bytes: localStorage.getItem(key)! });
        }
        render();
        cases.push(label);
    };
    const roundtrip = async (label: string): Promise<void> => {
        check(label);
        const saved = localStorage.getItem(key)!;
        const before = comparable();
        tick(2);
        const after = comparable();
        destroy();
        mounted = await mount((main, gc) => store.restore(main, gc));
        current().container.setLoopSuspended(true);
        assert(comparable() === before, `${label}: fresh restore differs`);
        render();
        assert(comparable() === before, `${label}: first loaded render mutates state`);
        tick(2);
        assert(comparable() === after, `${label}: fresh continuation differs`);
        localStorage.setItem(key, saved);
        assert(store.restore(current().main, current().container), `${label}: checkpoint`);
    };
    const enter = (id: ModeId, stage = 0): void => {
        const m = current();
        m.main.stageIndex = stage;
        m.main.demoMode = false;
        m.main.setMode(m.main.getModeForStateRestore(id), m.container);
    };
    const reject = (name: string, mutate: (snapshot: ReturnType<typeof capture>) => void): void => {
        const s = capture();
        mutate(s);
        const text = JSON.stringify(s);
        localStorage.setItem(key, text);
        const before = comparable(),
            mapping = current().main.input;
        for (let i = 0; i < 2; i++) {
            assert(!store.hasValidSave() && !store.restore(current().main, current().container), `${name}: malformed accepted`);
            assert(
                localStorage.getItem(key) === text && comparable() === before && current().main.input === mapping,
                `${name}: rejection changed storage/live state`
            );
        }
        assert(store.save(current().main, () => true).saved, `${name}: authorized overwrite after rejection`);
        cases.push(`reject:${name}`);
    };
    const verifyActiveTimers = async (): Promise<void> => {
        const prepare = (): PlayingMode => {
            current().main.paused = false;
            enter("playing", 0);
            const w = current().main.getPlayingModeForState();
            w.fadeState = PlayingMode.FADE_NONE;
            w.readyTimer = 0;
            w.exitIndex = 4;
            // Boundary fixture: hold the player away from the central timed bonus.
            // Loaded sprites, real timers and actual ghosts/serializer remain active.
            w.mspacman.x = 80;
            w.mspacman.y = 80;
            w.mspacman.speed = 0;
            w.mspacman.speedRemainder = 0;
            return w;
        };
        const keyEvent = (code: string, down: boolean): void => {
            const canvas = document.querySelector("canvas");
            assert(canvas, "Timer input canvas");
            canvas.focus();
            const input = current().container.getInput();
            input.resume();
            canvas.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", { code, key: code === "KeyP" ? "p" : code, bubbles: true }));
            input.poll(800, 600);
        };
        {
            const w = prepare(),
                p = w.mspacman;
            let found = false;
            for (let y = 1; y < 30 && !found; y++)
                for (let x = 1; x < 27 && !found; x++)
                    if (w.typeMap[y][x] === PlayingMode.TYPE_PELLOT) {
                        p.x = x * 16;
                        p.y = y * 16;
                        p.speed = 1;
                        p.speedRemainder = 0;
                        found = true;
                    }
            assert(found, "Loaded pellet acquisition location");
            tick();
            assert(p.pellotDampensSpeed && p.pellotDampensSpeedCount === 10, "Actual tile collision enables pellet modifier");
            p.speed = 0;
            p.speedRemainder = 0;
            await roundtrip("acquire:pellet");
        }
        {
            const w = prepare(),
                p = w.mspacman;
            let found = false;
            for (let y = 2; y < 29 && !found; y++)
                for (let x = 1; x < 27 && !found; x++)
                    if (w.typeMap[y][x] !== PlayingMode.TYPE_WALL && w.typeMap[y - 1][x] !== PlayingMode.TYPE_WALL) {
                        p.x = x * 16;
                        p.y = y * 16;
                        p.direction = Main.RIGHT;
                        p.speed = 1;
                        p.speedRemainder = 0;
                        found = true;
                    }
            assert(found, "Loaded turning location");
            try {
                keyEvent("ArrowUp", true);
                tick();
            } finally {
                keyEvent("ArrowUp", false);
            }
            assert(p.direction === Main.UP && p.corneringEnhancesSpeed && p.corneringEnhancesSpeedCount === 10, "Actual input turn enables corner modifier");
            p.speed = 0;
            p.speedRemainder = 0;
            await roundtrip("acquire:corner");
        }
        for (const color of ["Red", "Green"]) {
            const w = prepare();
            if (color === "Red") w.ateEnergizer();
            const before = w.ghostsBlueTimer;
            (Reflect.get(w, `create${color}Energizer`) as () => void).call(w);
            w.mspacman.x = 16 * 13 + 8;
            w.mspacman.y = 16 * 23;
            tick();
            assert(!w.redEnergizerPresent && !w.greenEnergizerPresent, "Actual bonus collision removes pickup");
            if (color === "Red") assert(w.ghostsBlueTimer === before - 1 + 182, "Actual red pickup extends fright");
            else assert(w.mspacman.speedBoost && w.mspacman.speedBoostTimer === 0, "Actual green pickup starts boost at0");
            await roundtrip(`acquire:${color}`);
        }
        for (const branch of ["pause", "overlay", "ready", "fade", "death", "finished"]) {
            const w = prepare();
            w.mspacman.boostSpeed();
            w.ateEnergizer();
            if (branch === "pause") {
                keyEvent("KeyP", true);
                current().main.update(current().container, 11);
                keyEvent("KeyP", false);
                assert(current().main.paused, "Real input pauses Main");
            }
            if (branch === "overlay") w.ghostEaten(w.ghosts[0]);
            if (branch === "ready") w.readyTimer = 10;
            if (branch === "fade") {
                w.fadeState = PlayingMode.FADE_IN;
                w.fadeIndex = 10;
            }
            if (branch === "death") w.playerKilled();
            if (branch === "finished") {
                for (let y = 0; y < 31; y++)
                    for (let x = 0; x < 28; x++)
                        if (w.typeMap[y][x] === PlayingMode.TYPE_PELLOT || w.typeMap[y][x] === PlayingMode.TYPE_ENERGIZER) {
                            w.typeMap[y][x] = PlayingMode.TYPE_EMPTY;
                            w.tileMap[y][x] = 47;
                        }
                w.pelletsRemaining = 1;
                w.atePellot();
            }
            tick();
            assert(w.mspacman.speedBoostTimer === 0 && w.ghostsBlueTimer > 0, `Suspended consumers ${branch}`);
            await roundtrip(`active:suspended:${branch}`);
            if (branch === "pause") {
                keyEvent("KeyP", true);
                current().main.update(current().container, 11);
                keyEvent("KeyP", false);
                assert(!current().main.paused, "Real input resumes Main");
            }
        }
        for (const [flag, counter] of [
            ["pellotDampensSpeed", "pellotDampensSpeedCount"],
            ["corneringEnhancesSpeed", "corneringEnhancesSpeedCount"]
        ] as const) {
            const w = prepare();
            w.mspacman[flag] = true;
            w.mspacman[counter] = 1;
            await roundtrip(`active:${flag}:last-step`);
            reject(`active:${flag}:zero`, (s) => {
                assert(s.mode.id === "playing", "Playing snapshot");
                s.mode.mspacman.fields[counter] = 0;
            });
            tick();
            const p = current().main.getPlayingModeForState().mspacman;
            assert(!p[flag] && p[counter] === 0, `${flag}: actual expiry`);
            check(`active:${flag}:expired`);
        }
        {
            const w = prepare();
            w.mspacman.boostSpeed();
            w.mspacman.speedBoostTimer = 636;
            await roundtrip("active:speedBoost:636");
            reject("active:speedBoost:637", (s) => {
                assert(s.mode.id === "playing", "Playing snapshot");
                s.mode.mspacman.fields.speedBoostTimer = 637;
            });
            tick();
            const p = current().main.getPlayingModeForState().mspacman;
            assert(!p.speedBoost && p.speedBoostTimer === 0, "Actual boost expiry");
            check("active:speedBoost:expired");
        }
        {
            const w = prepare();
            w.ateEnergizer();
            w.ghostsBlueTimer = 1;
            await roundtrip("active:ghostsBlue:1");
            reject("active:ghostsBlue:0", (s) => {
                s.mode.fields.ghostsBlueTimer = 0;
            });
            tick();
            const next = current().main.getPlayingModeForState();
            assert(!next.ghostsBlue && next.ghostsBlueTimer === 0, "Actual fright expiry");
            check("active:ghostsBlue:expired");
        }
        for (const name of ["Red", "Green"] as const) {
            const w = prepare();
            const spawn = Reflect.get(w, `create${name}Energizer`) as () => void;
            spawn.call(w);
            w.energizerTimer = 636;
            await roundtrip(`active:${name}:636`);
            reject(`active:${name}:dormant-spawn910`, (s) => {
                s.mode.fields.fruitTargetTimer = 910;
            });
            reject(`active:${name}:637`, (s) => {
                s.mode.fields.energizerTimer = 637;
            });
            tick();
            const next = current().main.getPlayingModeForState();
            assert(!next.redEnergizerPresent && !next.greenEnergizerPresent && next.energizerTimer === 637, "Expired bonus keeps637");
            await roundtrip(`active:${name}:expired637`);
        }
        for (const exitIndex of [1, 2, 3]) {
            const w = prepare();
            w.exitIndex = exitIndex;
            const target = w.exitDelayTarget;
            w.exitDelay = target - 1;
            await roundtrip(`active:exit:${exitIndex}:before`);
            reject(`active:exit:${exitIndex}:at-target`, (s) => {
                s.mode.fields.exitDelay = target;
            });
            tick();
            const next = current().main.getPlayingModeForState();
            assert(next.exitIndex === exitIndex + 1 && next.exitDelay === 0, "Exit publishes/reset atomically");
            await roundtrip(`active:exit:${exitIndex}:after`);
        }
        {
            const w = prepare();
            w.fruitTargetTimer = 909;
            await roundtrip("active:spawn:909");
            reject("active:spawn:910", (s) => {
                s.mode.fields.fruitTargetTimer = 910;
            });
            tick();
            const next = current().main.getPlayingModeForState();
            assert(next.fruitTargetTimer === 0, "Actual spawn timer resets");
            assert([next.fruitTargetPresent, next.redEnergizerPresent, next.greenEnergizerPresent].filter(Boolean).length === 1, "Exactly one bonus spawns");
            await roundtrip("active:spawn:after");
        }
    };
    try {
        current().main.score = 1_234_567;
        enter("enterInitials");
        // Seed the far boundary, then let the actual byte-scroll writer cross it.
        Reflect.set(mode(), "redOffset", 100000);
        Reflect.set(mode(), "dotsOffset", -32);
        await roundtrip("initials:100000:-32");
        tick();
        assert(field("redOffset") === 100001 && field("dotsOffset") === -3, "Actual initials accumulator wrap");
        await roundtrip("initials:100001:-3");
        assert(Reflect.get(mode(), "newScoreOf") === "YOU ACHIEVED A SCORE OF 1234567.", "Initials full logical score");
        Reflect.set(mode(), "redOffset", 2147483647);
        Reflect.set(mode(), "dotsOffset", -32);
        tick();
        assert(field("redOffset") === 2147483648, "Actual initials counter crosses signed-int boundary");
        await roundtrip("initials:2147483648");
        for (const n of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1])
            reject(`red:${n}`, (s) => {
                s.mode.fields.redOffset = n;
            });
        for (const n of [-33, 1, 0.5])
            reject(`dots:${n}`, (s) => {
                s.mode.fields.dotsOffset = n;
            });
        // Fresh input after a restore still edits once and does not submit a score.
        const canvas = document.querySelector("canvas");
        assert(canvas, "Counter canvas");
        canvas.focus();
        current().container.getInput().resume();
        canvas.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowDown", key: "ArrowDown", bubbles: true }));
        current().container.getInput().poll(800, 600);
        tick();
        assert(Reflect.get(mode(), "initials") === "BAA", "Fresh restored initials input");
        canvas.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowDown", key: "ArrowDown", bubbles: true }));
        current().container.getInput().poll(800, 600);
        assert(!Reflect.get(mode(), "enterPressed") && current().main.submittedScore === null, "Restore/input must not submit");
        enter("selectWorld");
        Reflect.set(mode(), "angleOffset", 100000);
        tick();
        assert(field("angleOffset") > 100000, "Actual SelectWorld accumulator crosses budget");
        await roundtrip("selectWorld:large-angle");
        reject("negative-angle", (s) => {
            s.mode.fields.angleOffset = -0.01;
        });
        for (const id of ["act1", "act3", "act4"] as const) {
            enter(id, Number(id.slice(3)));
            const seen = new Set<number>();
            const fades = new Set<number>();
            const sprites = new Set<number>();
            let deferred = false,
                wrap = false,
                prior = -1;
            await roundtrip(`${id}:init`);
            for (let i = 0; i < 3500 && current().main.getCurrentModeIdForState() === id; i++) {
                tick();
                if (current().main.getCurrentModeIdForState() !== id) break;
                const state = field("state"),
                    fade = field("fadeState");
                if (!seen.has(state)) {
                    seen.add(state);
                    await roundtrip(`${id}:state:${state}`);
                }
                if (!fades.has(fade)) {
                    fades.add(fade);
                    check(`${id}:fade:${fade}`);
                }
                if (id === "act1" && field("nextState") !== state && !deferred) {
                    deferred = true;
                    await roundtrip("act1:deferred-state");
                }
                if (id !== "act1") {
                    const index = field("storkSpriteIndex"),
                        increment = field("storkSpriteIndexIncrementor");
                    sprites.add(index);
                    if (prior === 11 && increment === 0 && !wrap) {
                        wrap = true;
                        await roundtrip(`${id}:stork-wrap`);
                    }
                    prior = increment;
                }
            }
            assert(current().main.getCurrentModeIdForState() !== id, `${id}: actual handoff completed`);
            await roundtrip(`${id}:after-handoff`);
            assert(seen.has(0) && seen.has(1), `${id}: actual clapper transition`);
            if (id === "act1") assert(deferred && seen.has(2), "Act1 deferred head-on transition");
            else assert(wrap && sprites.has(0) && sprites.has(1), `${id}: both stork images and 11->0 wrap`);
            assert(fades.has(1) && fades.has(2), `${id}: both fades`);
            enter(id, Number(id.slice(3)));
            if (id === "act1")
                reject("act1-next3", (s) => {
                    s.mode.fields.nextState = 3;
                });
            else {
                reject(`${id}-stork2`, (s) => {
                    s.mode.fields.storkSpriteIndex = 2;
                });
                reject(`${id}-increment12`, (s) => {
                    s.mode.fields.storkSpriteIndexIncrementor = 12;
                });
            }
        }
        for (const [id, stage, dialog] of [
            ["act5", 5, Act5Mode.dialog],
            ["act7", 7, Act7Mode.dialog],
            ["ending", 8, EndingMode.dialog]
        ] as const) {
            enter(id, stage);
            const phases = new Set<number>();
            const completedLines = new Set<number>();
            await roundtrip(`${id}:init`);
            for (let i = 0; i < 60000 && current().main.getCurrentModeIdForState() === id; i++) {
                tick();
                if (current().main.getCurrentModeIdForState() !== id) break;
                const phase = field("state"),
                    line = field("dialogIndex");
                const snapshot = capture();
                assert(isValidMsPacManGameStateSnapshot(snapshot) && isValidSnapshotForLoadedResources(current().main, snapshot), `${id}: producer tick ${i}`);
                if (!phases.has(phase)) {
                    phases.add(phase);
                    await roundtrip(`${id}:phase:${phase}`);
                }
                if (field("stringIndex") === dialog[line].length && !completedLines.has(line)) {
                    completedLines.add(line);
                    await roundtrip(`${id}:completed-line:${line}`);
                }
            }
            assert(completedLines.size === dialog.length, `${id}: all actual dialog terminal cursors`);
            if (id === "ending") assert(phases.has(2) && phases.has(3), "Ending: credits terminal overshoot and retained presented value");
            assert(current().main.getCurrentModeIdForState() !== id, `${id}: actual handoff completed`);
            await roundtrip(`${id}:after-handoff`);
        }
        enter("playing");
        let world = current().main.getPlayingModeForState();
        world.fadeState = PlayingMode.FADE_NONE;
        world.readyTimer = 0;
        world.exitIndex = 4;
        world.ateEnergizer();
        for (let chain = 0; chain < 4; chain++) {
            world = current().main.getPlayingModeForState();
            const ghost = world.ghosts[chain];
            // Captures only occur outside the house. Drive the production exit
            // before testing award timers instead of manufacturing eyes in-home.
            if (ghost.inHome) {
                ghost.exitingHome = true;
                for (let step = 0; ghost.inHome && step < 400; step++) ghost.update(current().container);
                assert(!ghost.inHome, "captured ghost completed its real house exit");
            }
            world.ghostEaten(ghost);
            assert(world.ghostPointsIndex === chain && world.showGhostPointsTimer === 91, "Actual ghost award");
            await roundtrip(`ghost:${chain}:91`);
            if (chain === 0) {
                const checkpoint = localStorage.getItem(key)!;
                current().main.paused = true;
                current().main.update(current().container, 11);
                assert(current().main.getPlayingModeForState().showGhostPointsTimer === 91, "Paused Main freezes ghost display timer");
                current().main.paused = false;
                current().main.getPlayingModeForState().playerKilled();
                tick();
                assert(current().main.getPlayingModeForState().showGhostPointsTimer === 91, "Death branch freezes ghost display timer");
                await roundtrip("ghost:death-retains-points");
                localStorage.setItem(key, checkpoint);
                assert(store.restore(current().main, current().container), "Restore ghost checkpoint");
                const terminal = current().main.getPlayingModeForState();
                // Boundary seed a last-pellet award; this checks retained overlay ordering,
                // while verifyTerminalGameplay independently drives the real tile collision.
                for (let y = 0; y < 31; y++)
                    for (let x = 0; x < 28; x++)
                        if (terminal.typeMap[y][x] === PlayingMode.TYPE_PELLOT || terminal.typeMap[y][x] === PlayingMode.TYPE_ENERGIZER) {
                            terminal.typeMap[y][x] = PlayingMode.TYPE_EMPTY;
                            terminal.tileMap[y][x] = 47;
                        }
                terminal.pelletsRemaining = 1;
                terminal.atePellot();
                tick();
                assert(terminal.finished && terminal.showGhostPointsTimer === 91, "Finished branch freezes ghost display timer");
                await roundtrip("ghost:finished-retains-points");
                localStorage.setItem(key, checkpoint);
                assert(store.restore(current().main, current().container), "Restore ghost chain checkpoint");
            }
            reject(`ghost:${chain}:active-index-1`, (s) => {
                s.mode.fields.ghostPointsIndex = -1;
            });
            reject(`ghost:${chain}:active-timer0`, (s) => {
                s.mode.fields.showGhostPointsTimer = 0;
            });
            tick(89);
            assert(current().main.getPlayingModeForState().showGhostPointsTimer === 2, "Ghost timer 2");
            await roundtrip(`ghost:${chain}:2`);
            tick();
            await roundtrip(`ghost:${chain}:1`);
            tick();
            assert(
                !current().main.getPlayingModeForState().showGhostPoints && current().main.getPlayingModeForState().eatenGhost === null,
                "Ghost timer 0 retires reference"
            );
            check(`ghost:${chain}:0`);
        }
        world = current().main.getPlayingModeForState();
        current().main.score = 9990;
        current().main.lives = 5;
        world.addPoints(10);
        assert(current().main.score === 10000 && current().main.lives === 6, "Sixth life threshold");
        world.addPoints(10000);
        assert(current().main.lives === 6, "Lives cap six");
        check("score:life-cap-six");
        await verifyActiveTimers();
        const required = [
            "acquire:pellet",
            "acquire:corner",
            "acquire:Red",
            "acquire:Green",
            "active:speedBoost:636",
            "active:speedBoost:expired",
            "active:ghostsBlue:1",
            "active:ghostsBlue:expired",
            "active:spawn:909",
            "active:spawn:after",
            "reject:active:spawn:910"
        ];
        for (const branch of ["pause", "overlay", "ready", "fade", "death", "finished"]) required.push(`active:suspended:${branch}`);
        for (const flag of ["pellotDampensSpeed", "corneringEnhancesSpeed"])
            required.push(`active:${flag}:last-step`, `active:${flag}:expired`, `reject:active:${flag}:zero`);
        for (const color of ["Red", "Green"])
            required.push(`active:${color}:636`, `active:${color}:expired637`, `reject:active:${color}:dormant-spawn910`, `reject:active:${color}:637`);
        for (const index of [1, 2, 3]) required.push(`active:exit:${index}:before`, `active:exit:${index}:after`, `reject:active:exit:${index}:at-target`);
        for (const label of required) assert(cases.includes(label), `Missing timer case ${label}`);
        Reflect.set(window, "counterParityEvidence", { cases, required, validationMilliseconds: times, schema: capture().version, departureCheckpoints });
    } finally {
        destroy();
        store.clear(() => true);
    }
}
