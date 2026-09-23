import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTypeScript, shellSubject, sourceMember } from "./persistence-test-loader.mjs";
const { PersistenceSession, RestoreAttempt } = await loadTypeScript("pwa/src/app/PersistenceSession.ts");
const path = "pwa/src/app/main.ts",
    owner = null;
function fixture() {
    const events = [];
    const game = { isStateSaveReady: () => true, isLoadingScreenActive: () => false };
    const container = { isLoopSuspended: () => true, isDestroyed: () => false };
    const ownership = { owned: true, epoch: 1, isCurrent: () => true };
    const persistence = new PersistenceSession();
    persistence.beginOwnership(1);
    persistence.accept(game);
    const store = {
        save(main, authorized) {
            events.push("save");
            return authorized() ? { saved: true } : { saved: false, reason: "not-authorized" };
        }
    };
    const prepared = {
        slick: {
            Display: {
                setParent() {
                    events.push("display");
                }
            }
        }
    };
    const env = {
        events,
        game,
        container,
        ownership,
        persistence,
        RestoreAttempt,
        ReloadRequiredError: class ReloadRequiredError extends Error {},
        ResourceLoadException: class ResourceLoadException extends Error {},
        root: {},
        app: {},
        menuOverlay: {},
        liveMenuOpen: true,
        pwaSessionState: "menu",
        gameSessionGeneration: 1,
        activeGameSession: 1,
        activeSessionGeneration: 1,
        gameOwnershipEpoch: 1,
        menuRequestSerial: 0,
        volume: 0.1,
        gameLaunchInProgress: false,
        getOwnership() {
            return ownership;
        },
        getLoadedGameStateStore() {
            return store;
        },
        getGameStateStore() {
            return store;
        },
        hasPotentialSavedGameState() {
            return true;
        },
        runtimeLoader: {
            preparedRuntime: prepared,
            prepared,
            getPreparedRuntime() {
                return prepared;
            }
        },
        sessions: {
            begin() {
                return 1;
            },
            invalidate() {}
        },
        sessionGeneration: {
            begin() {
                return 1;
            },
            invalidate() {}
        },
        canActivateFromMenu() {
            return true;
        },
        isCurrentGameSession() {
            return true;
        },
        isStartingGameSession() {
            return true;
        },
        sessionCleanup: {
            safe: true,
            run(...steps) {
                for (const step of steps) step();
                return this.safe;
            },
            trySave(fn) {
                return fn();
            },
            assertSafe() {
                assert.equal(this.safe, true);
            }
        },
        viewport: {
            focusMenuPanel() {},
            gameShell: {},
            gameHost: {},
            createShell() {
                return {};
            },
            stopHamburgerVisibilityMonitor() {},
            hideHamburger() {},
            stopCursorAutoHide() {},
            async exitFullscreenForMenu() {
                return true;
            }
        },
        suspendGameForMenu() {
            events.push("suspend");
            return this.sessionCleanup.safe;
        },
        saveCurrentGameState() {
            events.push("save");
            return false;
        },
        syncScreenWakeLock() {},
        destroyGame() {
            events.push("destroy");
            return true;
        },
        destroyGameSession() {
            events.push("destroy");
            return true;
        },
        applyApplicationAudioPreferences() {},
        setAudioVolume() {},
        requestPreferredFullscreen() {},
        beginGameAudio() {
            events.push("audio");
            return { ready: Promise.resolve(true) };
        },
        isGameAudioLatest() {
            return true;
        },
        renderMenu(...args) {
            events.push(["render", ...args]);
            return {};
        },
        renderMenuUi(...args) {
            events.push(["render", ...args]);
            return {};
        },
        renderMenuForParent(...args) {
            events.push(["render", ...args]);
            return {};
        },
        showMenu() {
            events.push("menu");
            this.pwaSessionState = "menu";
        },
        startPwaMenu() {
            events.push("menu");
            this.pwaSessionState = "menu";
        },
        showLoadError() {
            events.push("fatal");
            this.pwaSessionState = "menu";
        },
        renderLoadError() {
            events.push("fatal");
            this.pwaSessionState = "menu";
        },
        showResourceLoadError() {
            events.push("fatal");
            this.pwaSessionState = "menu";
        },
        requestPwaMenu() {
            events.push("cancel");
            this.pwaSessionState = "menu";
        },
        restoreExistingLiveMenuAfterInterruptedResume() {
            events.push("retained");
            this.pwaSessionState = "menu";
        },
        console: {
            error() {
                events.push("diagnostic");
            },
            warn() {
                events.push("diagnostic");
            }
        }
    };
    return env;
}
function subject(method, env) {
    const methods = shellSubject(path, [method], env, owner);
    return { methods, state: owner ? methods : env };
}

test("actual shell save gate accepts only a frozen, accepted runtime, independently of rejected storage", () => {
    const env = fixture();
    env.persistence.rejectStored();
    const { methods, state } = subject("saveCurrentGameState", env);
    assert.equal(methods.saveCurrentGameState(), true);
    assert.deepEqual(env.events, ["save"]);
    env.events.length = 0;
    env.persistence.retire(env.game);
    assert.equal(methods.saveCurrentGameState(), false);
    assert.deepEqual(env.events, []);
    env.persistence.accept(env.game);
    state.container = { isLoopSuspended: () => false };
    assert.equal(methods.saveCurrentGameState(), false);
    assert.deepEqual(env.events, []);
});

test("actual live-menu transition has no persistence UI and never destroys a healthy retained game after save failure", async () => {
    const env = fixture();
    env.pwaSessionState = "running";
    const { methods, state } = subject("showLiveMenuOverlay", env);
    await methods.showLiveMenuOverlay();
    assert.equal(state.game, env.game);
    assert.equal(state.container, env.container);
    assert.equal(state.pwaSessionState, "menu");
    const suspendIndex = env.events.indexOf("suspend");
    const saveIndex = env.events.indexOf("save");
    assert.ok(suspendIndex >= 0 && saveIndex > suspendIndex);
    assert.equal(env.events.includes("destroy"), false);
    const render = env.events.find((value) => Array.isArray(value));
    assert.ok(render);
    assert.ok(render[3] === null || render[3] === "", "save failure does not become menu text");
    assert.equal(render[2], true, "retained Continue remains enabled");
});

test("actual retained-resume cancellation does not perform a redundant save", () => {
    const env = fixture();
    env.pwaSessionState = "starting";
    const { methods } = subject("requestPwaMenu", env);
    methods.requestPwaMenu("blur");
    assert.equal(env.events.includes("save"), false);
    assert.equal(env.events.includes("retained"), true);
});

test("actual failed suspension never captures moving or partially retired state", async () => {
    const env = fixture();
    env.pwaSessionState = "running";
    env.suspendGameForMenu = function () {
        this.sessionCleanup.safe = false;
        return false;
    };
    const { methods } = subject("showLiveMenuOverlay", env);
    await methods.showLiveMenuOverlay();
    assert.equal(env.events.includes("save"), false);
    assert.equal(env.events.includes("destroy"), true);
    assert.equal(
        env.events.some((value) => Array.isArray(value)),
        false
    );
});

test("actual launch distinguishes rejected restoration from unrelated startup failure", async () => {
    for (const rejected of [true, false]) {
        const env = fixture();
        env.launchPreparedGame = async function (runtime, restore, session, audio, attempt) {
            if (rejected) attempt.reject();
            throw new Error("unrelated engine failure");
        };
        env.mountGame = env.launchPreparedGame;
        if (!owner)
            env.renderMenu = function () {
                env.events.push("menu");
                env.pwaSessionState = "menu";
            };
        const { methods } = subject("startGame", env);
        await methods.startGame(true);
        assert.equal(env.events.includes("fatal"), !rejected);
        assert.equal(env.persistence.canReadStored(), !rejected);
        assert.equal(env.events.includes("save"), false, "unaccepted candidate cannot be saved");
    }
});

test("actual shell has no warning/toast subsystem and teardown no longer saves mappings", () => {
    const source = sourceMember(path, "showLiveMenuOverlay", owner);
    assert.doesNotMatch(source, /Progress could not be saved|persistenceWarnings|saveCurrentInputMapping/);
    const save = sourceMember(path, "saveCurrentGameState", owner);
    assert.doesNotMatch(save, /getItem|hasValidSave|inspectStored|canReadStored|reportFailure/);
});

test("retained resume contains a policy failure before allocating audio", async () => {
    const env = fixture();
    env.hasLiveSuspendedGame = () => true;
    env.container.isGraphicsContextLost = () => false;
    env.applyApplicationAudioPreferences = () => {
        throw new Error("policy failed");
    };
    const { methods, state } = subject("resumeLiveGameFromMenu", env);
    await methods.resumeLiveGameFromMenu();
    assert.equal(state.pwaSessionState, "menu");
    assert.equal(env.events.includes("audio"), false);
    assert.equal(env.events.includes("save"), false);
    assert.equal(env.events.filter((event) => event === "cancel").length, 1);
});

test("rejected durable launch reaches owned root recovery without saving or replaying Reset", async () => {
    const env = fixture();
    const jackal = owner !== null;
    const stick = path === "pwa/src/main.ts";
    env.activeMenu = {};
    env.refreshOwnedSettings = () => {};
    env.hasPotentialSavedGameState = () => env.persistence.canReadStored();
    env.launchPreparedGame = async (_runtime, _restore, _session, _audio, attempt) => attempt.reject();
    env.mountGame = env.launchPreparedGame;
    const fail = () => {
        throw new Error("root binding failed after rejected restore");
    };
    if (jackal) env.renderMenu = fail;
    else if (stick) env.renderMenuForParent = fail;
    else env.renderMenuUi = fail;
    const names = ["startGame", jackal || stick ? "showMenu" : "renderMenu", stick ? "renderRootMenu" : "publishRootMenu"];
    const methods = shellSubject(path, names, env, owner);
    await methods.startGame(true);
    assert.equal(env.persistence.canReadStored(), false);
    assert.equal(env.events.filter((event) => event === "fatal").length, 1);
    assert.equal(env.events.includes("save"), false);
    assert.equal((jackal ? methods : env).activeMenu, null);
    assert.equal(env.sessionCleanup.safe, true);
});
