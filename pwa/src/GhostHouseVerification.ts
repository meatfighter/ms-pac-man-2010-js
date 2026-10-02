import { Display, type AppGameContainer } from "slick2d-ts";
import { Main } from "./mspacman/Main.js";
import { PlayingMode } from "./mspacman/PlayingMode.js";
import type { ScalableGame2 } from "./mspacman/ScalableGame2.js";
import {
    MsPacManGameStateSerializer,
    isValidMsPacManGameStateSnapshot,
    isValidSnapshotForLoadedResources
} from "./mspacman/persistence/MsPacManGameStateSerializer.js";
import { MsPacManGameStateStore } from "./mspacman/persistence/MsPacManGameStateStore.js";
import { createBrowserStorageKeys } from "./app/BrowserStorageKeys.js";

type Mounted = { main: Main; container: AppGameContainer; buffered: ScalableGame2 };
type Mount = (restore: ((main: Main, container: AppGameContainer) => boolean) | null) => Promise<Mounted>;
function check(value: unknown, label: string): asserts value {
    if (!value) throw Error(label);
}

/** Loaded production modes, actors, resources and store. No release entry imports this fixture. */
export async function verifyGhostHouse(mount: Mount, recordingsOnly = false): Promise<void> {
    let mounted: Mounted | null = await mount(null);
    const current = (): Mounted => {
        check(mounted, "mounted ghost runtime");
        return mounted;
    };
    const world = () => current().main.getPlayingModeForState();
    const store = new MsPacManGameStateStore("ghost-house-fixture");
    const serializer = new MsPacManGameStateSerializer();
    const key = createBrowserStorageKeys().gameState;
    const checkpoints: Array<{ label: string; bytes: string }> = [];
    const capture = () => serializer.createSnapshot(current().main, "ghost-house-fixture");
    const validate = () => {
        const s = capture();
        const shape = isValidMsPacManGameStateSnapshot(s),
            resources = isValidSnapshotForLoadedResources(current().main, s);
        if (!shape || !resources) Reflect.set(window, "ghostHouseFailure", { shape, resources, snapshot: s });
        check(shape && resources, "real house snapshot valid");
        return s;
    };
    const destroy = () => {
        if (!mounted) return;
        mounted.main.stopAllSounds();
        mounted.main.invalidateBrowserLifetime();
        mounted.container.destroy();
        Display.setParent(null);
        mounted = null;
    };
    const state = () => {
        const s = capture();
        return JSON.stringify({ mode: s.mode, random: s.random, robots: s.robotInputs });
    };
    const save = async (label: string) => {
        validate();
        const before = state();
        check(store.save(current().main, () => true).saved, "house outgoing save " + label);
        check(state() === before, "save does not move or consume RNG");
        const bytes = localStorage.getItem(key)!;
        check(bytes, "saved bytes");
        checkpoints.push({ label, bytes });
        world().render(current().container, current().container.getGraphics());
        destroy();
        mounted = await mount((main, gc) => store.restore(main, gc));
        current().container.setLoopSuspended(true);
        check(state() === before, "cold recapture " + label);
        validate();
    };
    try {
        current().container.setLoopSuspended(true);
        if (!recordingsOnly) {
            for (let index = 0; index < 4; index++) {
                const m = current();
                m.main.demoMode = false;
                m.main.paused = false;
                m.main.worldIndex = 0;
                m.main.stageIndex = 0;
                m.main.score = 0;
                m.main.lives = 3;
                m.main.setMode(m.main.getModeForStateRestore("playing"), m.container);
                const w = world();
                w.fadeState = PlayingMode.FADE_NONE;
                w.fadeIndex = 0;
                w.readyTimer = 0;
                // Begin at the legitimate exit lane; capture is produced by real collision dispatch.
                const g = w.ghosts[index];
                w.decrementRegionCount(g);
                Object.assign(g, { x: 216, y: 224, direction: Main.UP, inHome: true, exitingHome: true, blue: true });
                w.incrementRegionCount(g);
                w.mspacman.x = 216;
                w.mspacman.y = 176;
                w.mspacman.speed = 0;
                w.mspacman.speedRemainder = 0;
                for (let i = 0; g.inHome && i < 200; i++) g.update(m.container);
                check(!g.inHome && g.x === 216 && g.y === 176, "real doorway exit");
                await save(`${index}-doorway-exit`);
                for (let i = 0; !world().ghosts[index].eyeBalls && i < 4; i++) world().ghosts[index].update(current().container);
                check(world().showGhostPoints && world().eatenGhost === world().ghosts[index] && current().main.score === 200, "actual frightened collision");
                await save(`${index}-points`);
                const paused = state();
                world().ghosts[index].update(current().container);
                check(state() === paused, "eaten ghost points pause");
                // Real score-pause countdown; ordinary ghosts and player remain paused.
                for (let i = 0; world().showGhostPoints && i < 100; i++) world().update(current().container);
                check(!world().showGhostPoints, "points presentation completes");
                const entered = world().ghosts[index];
                if (!entered.enteringHome) entered.moveEyeBalls();
                check(entered.enteringHome && entered.x === 216 && entered.y >= 176 && entered.y <= 177, "entry without upward lap");
                await save(`${index}-entry`);
                let middle = false,
                    side = false;
                for (let i = 0; world().ghosts[index].eyeBalls && i < 400; i++) {
                    const actor = world().ghosts[index];
                    actor.update(current().container);
                    validate();
                    check(actor.y >= 176 && actor.y <= 224, "eyes remain in house lane");
                    if (actor.y === 200 && !middle) {
                        middle = true;
                        await save(`${index}-descent`);
                    }
                    if (actor.y === 224 && actor.x !== 216 && actor.eyeBalls && !side) {
                        side = true;
                        await save(`${index}-side-entry`);
                    }
                }
                check(!world().ghosts[index].eyeBalls && world().ghosts[index].inHome, "regenerated");
                await save(`${index}-regenerated`);
                world().mspacman.x = 400;
                world().mspacman.y = 400;
                for (let i = 0; world().ghosts[index].inHome && i < 300; i++) world().ghosts[index].update(current().container);
                await save(`${index}-reexit`);
                world().ghosts[index].update(current().container);
                await save(`${index}-ordinary`);
                check(world().ghosts.length === 4 && !world().playerKilledFlag && current().main.score === 200, "population and award remain stable");
            }
            // Full incoming/outgoing validation, never a standalone policy shortcut.
            const valid = capture();
            check(valid.mode.id === "playing", "playing fixture");
            const base = JSON.parse(checkpoints.find((c) => c.label === "0-entry")!.bytes) as typeof valid;
            check(base.mode.id === "playing", "entry fixture");
            const mutations: Array<[string, Record<string, number | boolean>]> = [
                ["off-grid-vertical", { x: 216, y: 175, direction: 0, enteringHome: false }],
                ["off-grid-horizontal", { x: 208, y: 177, direction: 3, enteringHome: false }],
                ["eyes-in-home", { inHome: true }],
                ["entry-without-eyes", { eyeBalls: false }],
                ["above-entry", { y: 175 }],
                ["below-entry", { y: 225 }],
                ["wrong-side-lane", { x: 200, y: 224 }]
            ];
            for (const [label, fields] of mutations) {
                const s = structuredClone(base);
                check(s.mode.id === "playing", "mutant mode");
                Object.assign(s.mode.ghosts[0].fields, fields);
                check(!isValidMsPacManGameStateSnapshot(s), "reject " + label);
                const text = JSON.stringify(s);
                localStorage.setItem(key, text);
                const before = state();
                check(!store.hasValidSave() && !store.restore(current().main, current().container), "store rejects " + label);
                check(localStorage.getItem(key) === text && state() === before, "non-destructive rejection " + label);
            }
            const live = world().ghosts[0],
                prior = { x: live.x, y: live.y, direction: live.direction, eyeBalls: live.eyeBalls, inHome: live.inHome, enteringHome: live.enteringHome };
            const bytes = localStorage.getItem(key);
            Object.assign(live, { x: 216, y: 175, direction: Main.UP, eyeBalls: true, inHome: false, enteringHome: false });
            check(!store.save(current().main, () => true).saved && localStorage.getItem(key) === bytes, "invalid outgoing preserves old bytes");
            Object.assign(live, prior);
            for (const direction of [0, 1, 2, 3]) {
                const s = structuredClone(base);
                check(s.mode.id === "playing", "positive mode");
                Object.assign(s.mode.ghosts[0].fields, { x: 216, y: 176, direction, enteringHome: false, blue: true, exitingHome: true });
                check(isValidMsPacManGameStateSnapshot(s), "all doorway headings and historical flags valid");
            }
            for (const version of [11, 13]) {
                const text = JSON.stringify({ ...valid, version });
                localStorage.setItem(key, text);
                check(!store.hasValidSave() && localStorage.getItem(key) === text, "old/future schema nonwriting miss");
            }
            check(store.save(current().main, () => true).saved, "current authorized overwrite");
        }
        const demos: Array<{ index: number; frames: unknown[]; destination: string }> = [];
        for (let index = 0; index < 4; index++) {
            const m = current();
            m.main.demoMode = true;
            m.main.demoIndex = index;
            m.main.setMode(m.main.getModeForStateRestore("playing"), m.container);
            const frames: unknown[] = [];
            for (let tick = 0; m.main.getCurrentModeIdForState() === "playing" && tick < 20000; tick++) {
                world().update(m.container);
                if (m.main.getCurrentModeIdForState() !== "playing") break;
                const s = recordingsOnly ? capture() : validate();
                check(s.mode.id === "playing", "demo playing");
                frames.push([
                    m.main.score,
                    m.main.lives,
                    world().mspacman.x,
                    world().mspacman.y,
                    world().ghosts.map((g) => [g.x, g.y, g.direction, g.eyeBalls, g.inHome, g.enteringHome]),
                    s.random,
                    s.robotInputs
                ]);
            }
            check(m.main.getCurrentModeIdForState() !== "playing", "demo completes");
            demos.push({ index, frames, destination: m.main.getCurrentModeIdForState() });
        }
        Reflect.set(window, "ghostHouseEvidence", { checkpoints, demos });
    } finally {
        destroy();
    }
}
