import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function loadAudioUnlock(beginPlaybackGeneration) {
    let installed = 0;
    let ended = 0;
    let timerId = 0;
    const timers = new Map();
    const warnings = [];
    const manager = {
        install: () => installed++,
        beginPlaybackGeneration,
        endPlaybackGeneration: () => ended++
    };
    const context = {
        exports: {},
        console: { warn: (...args) => warnings.push(args) },
        setTimeout: (callback) => {
            const id = ++timerId;
            timers.set(id, callback);
            return id;
        },
        clearTimeout: (id) => timers.delete(id),
        require: () => ({ PwaAudioManager: { get: () => manager } })
    };
    const source = readFileSync("pwa/src/app/AudioUnlock.ts", "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
    vm.runInNewContext(compiled.outputText, context);
    return {
        exports: context.exports,
        installed: () => installed,
        ended: () => ended,
        warnings,
        timers,
        expire: () => {
            const callbacks = Array.from(timers.values());
            timers.clear();
            for (const callback of callbacks) {
                callback();
            }
        }
    };
}

test("install prepares decoding without requesting playback", () => {
    let requested = 0;
    const loaded = loadAudioUnlock(() => {
        requested++;
        return Promise.resolve(true);
    });
    assert.equal(loaded.installed(), 1);
    assert.equal(requested, 0);
});

test("audio startup begins synchronously and clears its deadline", async () => {
    let requested = 0;
    const loaded = loadAudioUnlock(() => {
        requested++;
        return Promise.resolve(true);
    });
    const activation = loaded.exports.unlockGameAudio();
    assert.equal(requested, 1);
    assert.equal(await activation, "ready");
    assert.equal(loaded.ended(), 0);
    assert.equal(loaded.timers.size, 0);
});

test("a stalled generation degrades to silent gameplay", async () => {
    const loaded = loadAudioUnlock(() => new Promise(() => {}));
    const activation = loaded.exports.unlockGameAudio();
    loaded.expire();
    assert.equal(await activation, "unavailable");
    assert.equal(loaded.ended(), 1);
    assert.equal(loaded.timers.size, 0);
});

test("a failed generation degrades to silent gameplay", async () => {
    const loaded = loadAudioUnlock(() => Promise.resolve(false));
    assert.equal(await loaded.exports.unlockGameAudio(), "unavailable");
    assert.equal(loaded.ended(), 1);
    assert.equal(loaded.warnings.length, 1);
});

test("rejected audio activation cannot prevent gameplay startup", async () => {
    const loaded = loadAudioUnlock(() => Promise.reject(new Error("audio unavailable")));
    assert.equal(await loaded.exports.unlockGameAudio(), "unavailable");
    assert.equal(loaded.ended(), 1);
    assert.equal(loaded.timers.size, 0);
});

test("synchronous audio activation failure cannot prevent gameplay startup", async () => {
    const loaded = loadAudioUnlock(() => {
        throw new Error("audio unavailable");
    });
    assert.equal(await loaded.exports.unlockGameAudio(), "unavailable");
    assert.equal(loaded.ended(), 1);
    assert.equal(loaded.timers.size, 0);
});

test("late failure cannot retire a newer successful generation", async () => {
    const old = deferred();
    let requested = 0;
    const loaded = loadAudioUnlock(() => (++requested === 1 ? old.promise : Promise.resolve(true)));
    const first = loaded.exports.unlockGameAudio();
    loaded.exports.releaseGameAudio();
    const second = loaded.exports.unlockGameAudio();
    await second;
    old.resolve(false);
    await first;
    assert.equal(loaded.ended(), 1);
    assert.equal(loaded.warnings.length, 0);
});

test("late timeout cannot retire a newer successful generation", async () => {
    let requested = 0;
    const loaded = loadAudioUnlock(() => (++requested === 1 ? new Promise(() => {}) : Promise.resolve(true)));
    const first = loaded.exports.unlockGameAudio();
    loaded.exports.releaseGameAudio();
    await loaded.exports.unlockGameAudio();
    loaded.expire();
    await first;
    assert.equal(loaded.ended(), 1);
    assert.equal(loaded.warnings.length, 0);
});

test("late success is marked superseded after returning to the menu", async () => {
    const old = deferred();
    const loaded = loadAudioUnlock(() => old.promise);
    const activation = loaded.exports.unlockGameAudio();
    loaded.exports.releaseGameAudio();
    old.resolve(true);
    assert.equal(await activation, "superseded");
    assert.equal(loaded.ended(), 1);
});

test("out-of-order Continue completions cannot resume the same retained game twice", async () => {
    const old = deferred();
    const current = deferred();
    let requested = 0;
    const loaded = loadAudioUnlock(() => (++requested === 1 ? old.promise : current.promise));
    const first = loaded.exports.unlockGameAudio();
    loaded.exports.releaseGameAudio();
    const second = loaded.exports.unlockGameAudio();
    old.resolve(true);
    assert.equal(await first, "superseded");
    current.resolve(true);
    assert.equal(await second, "ready");
    assert.equal(loaded.ended(), 1);
});

test("superseded rejection cannot affect the current pending generation", async () => {
    const old = deferred();
    const current = deferred();
    let requested = 0;
    const loaded = loadAudioUnlock(() => (++requested === 1 ? old.promise : current.promise));
    const first = loaded.exports.unlockGameAudio();
    const second = loaded.exports.unlockGameAudio();
    old.reject(new Error("old activation failed"));
    assert.equal(await first, "superseded");
    assert.equal(loaded.ended(), 0);
    assert.equal(loaded.warnings.length, 0);
    current.resolve(true);
    assert.equal(await second, "ready");
});

// Execute the application methods themselves, with browser/UI boundaries stubbed.
// This catches integration races that isolated AudioUnlock tests cannot catch.
function loadShell(beginPlaybackGeneration) {
    const name = JSON.parse(readFileSync("package.json", "utf8")).name;
    const isJackal = name === "jackal-js";
    const path = isJackal ? "pwa/src/app/JackalWebApp.ts" : name === "stickvania-js" ? "pwa/src/main.ts" : "pwa/src/app/main.ts";
    const text = readFileSync(path, "utf8");
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const destroyName = isJackal ? "destroyGameSession" : "destroyGame";
    const names = ["resumeLiveGameFromMenu", "requestPwaMenu", "syncScreenWakeLock", destroyName];
    if (!isJackal) {
        names.push("unlockAudio");
    }
    const owner = isJackal ? source.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === "JackalWebApp") : source;
    assert.ok(owner, "Application class must exist");
    const nodes = isJackal ? owner.members : owner.statements;
    const methods = names
        .map((method) => {
            const node = nodes.find((candidate) => candidate.name?.getText(source) === method && candidate.body);
            assert.ok(node, `Missing application method: ${method}`);
            return node.getText(source);
        })
        .join("\n");
    const program = isJackal ? `class ShellHarness { ${methods} } globalThis.shell = new ShellHarness();` : methods;
    const audio = loadAudioUnlock(beginPlaybackGeneration);
    const events = { inputResumes: 0, loopResumes: 0, removed: 0, wake: [], trace: [], hamburgerStates: [] };
    const noop = () => {};
    let state;
    const input = { resume: () => events.inputResumes++, clearKeyPressedRecord: noop };
    const game = {
        input,
        clearInputPressedRecords: noop,
        setBrowserSuspended: noop,
        resumeBrowserOnlyRumbles: noop,
        invalidateBrowserLifetime: noop,
        disposeBrowserRuntime: noop,
        stopAllSounds: noop
    };
    const container = {
        getInput: () => input,
        setLoopSuspended: (suspended) => {
            if (!suspended) {
                events.loopResumes++;
            }
        },
        destroy: () => events.trace.push("destroy")
    };
    const viewport = {
        gameHost: {},
        startCursorAutoHide: noop,
        startHamburgerVisibilityMonitor: noop,
        stopHamburgerVisibilityMonitor: noop,
        stopCursorAutoHide: noop,
        stopResponsiveSizing: noop,
        resumeCursor: noop,
        scheduleResize: noop,
        focusCanvas: noop,
        exitFullscreen: noop,
        stop: noop,
        clear: noop
    };
    const bindings = {
        game,
        container,
        viewport,
        pwaSessionState: "menu",
        liveMenuOpen: true,
        menuOverlay: {},
        activeGameHost: {},
        gameLaunchInProgress: false,
        gameStateStore: null,
        gameSessionGeneration: 1,
        activeSessionGeneration: 1,
        activeScalableGame: null,
        activeBufferedGame: null,
        activeGameShell: null,
        rumbleManager: null,
        preferences: { volume: 0.5 },
        pageLifecycle: { suspended: false },
        document: { visibilityState: "visible", hasFocus: () => true },
        sessionGeneration: { invalidate: noop },
        sessions: { invalidate: noop },
        runtimeLoader: { prepared: null, preparedRuntime: null, getPreparedRuntime: () => null },
        screenWakeLock: {
            setDesired: (value) => {
                events.wake.push(value);
                events.trace.push(`wake:${value}`);
            }
        },
        persistenceWarnings: { showPending: noop, clearToast: noop },
        SoundStore: { get: () => ({ stopAllPlayback: noop }) },
        unlockGameAudio: audio.exports.unlockGameAudio,
        releaseGameAudio: audio.exports.releaseGameAudio,
        hasLiveSuspendedGame: () => state.pwaSessionState === "menu" && state.liveMenuOpen,
        removeMenuOverlay: () => {
            events.removed++;
            state.menuOverlay = null;
            state.liveMenuOpen = false;
        },
        startGameCursorAutoHide: noop,
        stopGameCursorAutoHide: noop,
        stopResponsiveGameSizing: noop,
        stopHamburgerVisibilityMonitor: noop,
        startHamburgerVisibilityMonitor: () => events.hamburgerStates.push(state.pwaSessionState),
        applyVolume: noop,
        applyAudioVolume: noop,
        setAudioVolume: noop,
        applyDisplayModePreference: noop,
        scheduleResponsiveGameResize: noop,
        focusGameCanvas: noop,
        saveCurrentInputMapping: noop,
        getRumbleManager: () => ({ setSuspended: noop })
    };
    const context = vm.createContext({ ...bindings });
    const compiled = ts.transpileModule(program, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } });
    vm.runInContext(compiled.outputText, context);
    state = isJackal ? Object.assign(context.shell, bindings) : context;
    return {
        state,
        audio,
        events,
        isJackal,
        resume: () => state.resumeLiveGameFromMenu(),
        cancel: () => state.requestPwaMenu("blur"),
        destroy: () => state[destroyName]()
    };
}

for (const firstFinishesFirst of [true, false]) {
    test(`actual Continue ignores cancelled activation when old completion arrives ${firstFinishesFirst ? "first" : "last"}`, async () => {
        const old = deferred();
        const current = deferred();
        let requested = 0;
        const shell = loadShell(() => (++requested === 1 ? old.promise : current.promise));
        const first = shell.resume();
        assert.equal(requested, 1);
        shell.cancel();
        assert.equal(shell.state.pwaSessionState, "menu");
        const second = shell.resume();
        assert.equal(requested, 2);
        if (firstFinishesFirst) {
            old.resolve(true);
            await first;
            assert.equal(shell.state.pwaSessionState, "starting");
            assert.equal(shell.events.loopResumes, 0);
        }
        current.resolve(true);
        await second;
        if (!firstFinishesFirst) {
            old.resolve(false);
            await first;
        }
        assert.equal(shell.state.pwaSessionState, "running");
        assert.equal(shell.events.loopResumes, 1);
        assert.equal(shell.events.inputResumes, 1);
        assert.equal(shell.events.removed, 1);
        assert.equal(shell.audio.ended(), 1);
        if (!shell.isJackal) {
            assert.deepEqual(shell.events.hamburgerStates, ["running"]);
        }
    });
}

test("actual Continue still starts gameplay when audio is unavailable", async () => {
    const shell = loadShell(() => Promise.resolve(false));
    await shell.resume();
    assert.equal(shell.state.pwaSessionState, "running");
    assert.equal(shell.events.loopResumes, 1);
    assert.equal(shell.audio.ended(), 1);
});

test("actual Continue does not resume after cancellation without a replacement", async () => {
    const pending = deferred();
    const shell = loadShell(() => pending.promise);
    const activation = shell.resume();
    shell.cancel();
    pending.resolve(true);
    await activation;
    assert.equal(shell.state.pwaSessionState, "menu");
    assert.equal(shell.events.loopResumes, 0);
    assert.equal(shell.events.inputResumes, 0);
    assert.equal(shell.events.removed, 0);
});

test("actual Continue ignores a second activation while starting", async () => {
    const pending = deferred();
    let requested = 0;
    const shell = loadShell(() => {
        requested++;
        return pending.promise;
    });
    const first = shell.resume();
    await shell.resume();
    assert.equal(requested, 1);
    pending.resolve(true);
    await first;
    assert.equal(shell.events.loopResumes, 1);
});

test("actual teardown withdraws wake ownership before destroying the game", () => {
    const shell = loadShell(() => Promise.resolve(true));
    shell.state.pwaSessionState = "running";
    shell.destroy();
    assert.equal(shell.state.pwaSessionState, "stopping");
    assert.ok(shell.events.wake.length > 0);
    assert.ok(shell.events.wake.every((desired) => desired === false));
    assert.equal(shell.events.trace[0], "wake:false");
    assert.ok(shell.events.trace.includes("destroy"));
});
