import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScript, shellSubject } from "./persistence-test-loader.mjs";
const { focusOwnedPanel } = await loadTypeScript("pwa/src/app/FocusOwnership.ts");
test("retained menu focus owns host inertness and restores its prior value", () => {
    const original = globalThis.document;
    let focused = true;
    globalThis.document = { hasFocus: () => focused };
    try {
        for (const priorInert of [false, true]) {
            let menuFocus = 0;
            let canvasFocus = 0;
            const control = {
                focus() {
                    menuFocus++;
                }
            };
            const panel = { isConnected: true, matches: () => false, querySelector: () => control };
            const host = {
                inert: priorInert,
                querySelector: () => ({
                    focus() {
                        canvasFocus++;
                    }
                })
            };
            const subject = shellSubject(
                "pwa/src/app/GameViewportController.ts",
                ["focusMenuPanel", "restoreMenuHost", "focusCanvas"],
                {
                    focusOwnedPanel,
                    host,
                    menuHost: null,
                    root: { contains: (candidate) => candidate === panel && panel.isConnected }
                },
                "GameViewportController"
            );
            subject.focusMenuPanel(panel);
            assert.equal(host.inert, true);
            assert.equal(menuFocus, 1);
            focused = false;
            subject.focusMenuPanel(panel);
            assert.equal(menuFocus, 1);
            focused = true;
            panel.isConnected = false;
            subject.focusMenuPanel(panel);
            assert.equal(menuFocus, 1);
            subject.focusCanvas();
            assert.equal(host.inert, priorInert);
            assert.equal(canvasFocus, 1);
        }
    } finally {
        globalThis.document = original;
    }
});

const packageName = JSON.parse(readFileSync("package.json", "utf8")).name;
const jackal = packageName === "jackal-js",
    stick = packageName === "stickvania-js";
const shellPath = jackal ? "pwa/src/app/JackalWebApp.ts" : stick ? "pwa/src/main.ts" : "pwa/src/app/main.ts";
const publisher = stick ? "renderRootMenu" : "publishRootMenu";
const ordinary = jackal || stick ? "showMenu" : "renderMenu";
for (const route of ["prepared", "reset", "rejected-continue"]) {
    for (const failure of ["render", "preflight", "stale-render", "stale-preflight", "stale-request", "recovery", "none"]) {
        if (route === "reset" && failure.includes("preflight")) continue;
        test("owned root publication " + route + ": " + failure, () => {
            let subject,
                renders = 0,
                recovery = 0,
                resets = 0,
                destroys = 0;
            const owner = { epoch: 1, isCurrent: (epoch) => epoch === owner.epoch };
            const env = {
                ownership: owner,
                getOwnership: () => owner,
                menuRequestSerial: 0,
                pwaSessionState: "menu",
                activeMenu: {},
                sessionCleanup: { safe: true },
                root: {},
                app: {},
                gameStateStore: null,
                volume: 1,
                scalingPreference: "smooth",
                runtimeLoader: { preparedRuntime: {} },
                refreshOwnedSettings() {},
                canActivateFromMenu: () => true,
                persistence: { abandonStored() {}, canReadStored: () => route !== "rejected-continue" },
                sessionMapping: { resetToDefaults() {} },
                applyApplicationAudioPreferences() {},
                preferences: {
                    reset() {
                        resets++;
                        return true;
                    }
                },
                clearPwaStorage() {
                    resets++;
                    return true;
                },
                getRumbleManager: () => ({ setEnabled() {}, setSuspended() {} }),
                DEFAULT_VOLUME: 1,
                DEFAULT_SCALING_PREFERENCE: "smooth",
                DEFAULT_FULLSCREEN_PREFERENCE: false,
                DEFAULT_HARD_MODE: false,
                console: { error() {} },
                ReloadRequiredError: Error,
                destroyGame() {
                    destroys++;
                    return true;
                },
                hasPotentialSavedGameState() {
                    if (failure.includes("preflight")) {
                        if (failure.startsWith("stale")) {
                            owner.epoch++;
                            (jackal ? subject : env).pwaSessionState = "running";
                        }
                        throw new Error("preflight failure");
                    }
                    return route !== "rejected-continue";
                },
                showLoadError() {
                    recovery++;
                    if (failure === "recovery") throw new Error("recovery unavailable");
                },
                renderLoadError() {
                    recovery++;
                    if (failure === "recovery") throw new Error("recovery unavailable");
                }
            };
            const render = (_parent, canContinue) => {
                renders++;
                if (route !== "prepared") assert.equal(canContinue, false);
                if (failure === "none") return {};
                if (failure === "stale-request") {
                    (jackal ? subject : env).menuRequestSerial++;
                    (jackal ? subject : env).pwaSessionState = "running";
                }
                if (failure === "stale-render") {
                    owner.epoch++;
                    (jackal ? subject : env).pwaSessionState = "running";
                }
                throw new Error("binding failure");
            };
            if (jackal) env.renderMenu = render;
            else if (stick) env.renderMenuForParent = render;
            else env.renderMenuUi = render;
            subject = shellSubject(shellPath, [ordinary, publisher, "resetPwaState"], env, jackal ? "JackalWebApp" : null);
            assert.doesNotThrow(() => subject[route === "reset" ? "resetPwaState" : ordinary]());
            const state = jackal ? subject : env;
            assert.equal(recovery, failure === "none" || failure.startsWith("stale") ? 0 : 1);
            assert.equal(resets, route === "reset" ? 1 : 0);
            assert.equal(destroys, 1);
            assert.equal(renders, failure.includes("preflight") ? 0 : 1);
            assert.equal(state.sessionCleanup.safe, true);
            if (recovery) assert.equal(state.activeMenu, null);
            if (failure.startsWith("stale")) assert.equal(state.pwaSessionState, "running");
        });
    }
}
if (!stick)
    test("missing required controls fail inside the actual menu binding path", () => {
        const menu = { querySelector: () => null, style: {}, dataset: {} };
        const env = {
            document: { createElement: () => menu },
            guardMenuEvents() {},
            viewport: { getFullscreenCapability: () => "unavailable" },
            preferences: { fullscreen: false },
            volume: 1,
            scalingPickerHtml: () => "",
            volumeIcon: () => ""
        };
        const subject = shellSubject(shellPath, [jackal ? "bindMenuControls" : "renderMenuUi"], env, jackal ? "JackalWebApp" : null);
        assert.throws(
            () => (jackal ? subject.bindMenuControls(menu) : subject.renderMenuUi({ replaceChildren() {} }, false, "", false)),
            /missing required controls/
        );
    });

const { SessionCleanup } = await loadTypeScript("pwa/src/app/SessionCleanup.ts");
function livePresentationFixture(failure = "none", reused = false) {
    const calls = { save: 0, destroy: 0, render: 0, focus: 0, recovery: 0, severe: 0, removed: 0 };
    const node = () => ({
        isConnected: true,
        remove() {
            this.isConnected = false;
            calls.removed++;
        }
    });
    const existing = reused ? node() : null;
    let state, resolveExit, rejectExit;
    const exit = new Promise((resolve, reject) => {
        resolveExit = resolve;
        rejectExit = reject;
    });
    const owner = { epoch: 1, isCurrent: (epoch) => epoch === owner.epoch };
    const recovery = () => {
        calls.recovery++;
        if (failure === "recovery") throw new Error("recovery render");
        return null;
    };
    const env = {
        sessionCleanup: new SessionCleanup(),
        ownership: owner,
        getOwnership: () => owner,
        pwaSessionState: reused ? "stopping" : "running",
        menuOverlay: existing,
        activeMenu: existing,
        liveMenuOpen: reused,
        menuRequestSerial: 1,
        gameSessionGeneration: 1,
        activeGameSession: 1,
        activeSessionGeneration: 1,
        game: { setBrowserSuspended() {}, stopAllSounds() {}, disposeBrowserRuntime() {}, invalidateBrowserLifetime() {} },
        container: {
            setLoopSuspended() {},
            getInput: () => ({ pause() {} }),
            destroy() {
                calls.destroy++;
                if (failure === "teardown" || failure === "severe") throw new Error("native teardown");
            }
        },
        root: { contains: (el) => el.isConnected },
        app: { contains: (el) => el.isConnected },
        activeBufferedGame: null,
        activeScalableGame: null,
        gameLaunchInProgress: false,
        rumbleManager: null,
        persistence: { retire() {} },
        sessions: { invalidate() {} },
        sessionGeneration: { invalidate() {} },
        runtimeLoader: { cancelPreparation() {}, getPreparedRuntime: () => null, prepared: null, preparedRuntime: null },
        releaseGameAudio() {},
        SoundStore: { get: () => ({ stopAllPlayback() {} }) },
        isCurrentGameSession: (session) => session === 1 && state.gameSessionGeneration === 1 && owner.epoch === 1 && state.sessionCleanup.safe,
        suspendGameForMenu: () => true,
        saveCurrentGameState() {
            calls.save++;
            return false;
        },
        syncScreenWakeLock() {
            if (failure === "wake" && state.pwaSessionState === "menu") throw new Error("wake intent");
        },
        showCleanupFailure() {
            calls.severe++;
            if (failure === "severe") throw new Error("severe renderer");
        },
        showLoadError: recovery,
        renderLoadError: recovery,
        renderLoadErrorScreen: recovery,
        ReloadRequiredError: Error,
        focusOwnedPanel() {},
        console: { error() {}, warn() {} },
        viewport: {
            gameShell: {},
            stopHamburgerVisibilityMonitor() {},
            hideHamburger() {},
            stopCursorAutoHide() {},
            stopResponsiveSizing() {},
            clear() {},
            exitFullscreenForMenu: () => exit,
            focusMenuPanel() {
                calls.focus++;
                assert.equal(state.pwaSessionState, "menu");
                if (failure === "focus-reentry") {
                    state.menuRequestSerial++;
                    state.game = {};
                    throw new Error("obsolete focus");
                }
                if (failure === "focus" || failure === "reused-focus") throw new Error("focus");
            }
        }
    };
    const render = () => {
        calls.render++;
        const overlay = node();
        state.activeMenu = overlay;
        if (["render", "recovery", "teardown", "severe"].includes(failure)) throw new Error("partial render");
        if (failure === "render-reentry") {
            state.menuRequestSerial++;
            state.game = {};
            state.activeMenu = null;
        }
        return overlay;
    };
    env[jackal ? "renderMenu" : stick ? "renderMenuForParent" : "renderMenuUi"] = render;
    const names = ["showLiveMenuOverlay", "finishLiveMenuPresentation", "restoreExistingLiveMenuAfterInterruptedResume", "destroyGame", "removeMenuOverlay"];
    if (jackal) names.push("destroyGameSession");
    const subject = shellSubject(shellPath, names, env, jackal ? "JackalWebApp" : null);
    state = jackal ? subject : env;
    return { subject, state, calls, owner, resolveExit, rejectExit, existing, node };
}
for (const reused of [false, true]) {
    for (const failure of ["none", "render", "focus", "exit", "wake", "recovery", "teardown", "severe"]) {
        if (reused && ["render", "recovery", "teardown", "severe"].includes(failure)) continue;
        test("live presentation uses real cleanup/destructor: reused=" + reused + " failure=" + failure, async () => {
            const f = livePresentationFixture(failure, reused);
            const work = reused ? f.subject.restoreExistingLiveMenuAfterInterruptedResume(1) : f.subject.showLiveMenuOverlay();
            if (failure === "exit") f.rejectExit(new Error("fullscreen exit rejected"));
            else f.resolveExit(true);
            await assert.doesNotReject(work);
            assert.equal(f.calls.save, reused ? 0 : 1);
            assert.equal(f.calls.destroy, failure === "none" ? 0 : 1);
            const unsafe = failure === "teardown" || failure === "severe";
            assert.equal(f.state.sessionCleanup.safe, !unsafe);
            assert.equal(f.calls.recovery, failure === "none" || unsafe ? 0 : 1);
            if (unsafe) {
                assert.equal(f.calls.severe, 1, "severe recovery must not recurse");
                assert.throws(() => f.state.sessionCleanup.assertSafe());
                f.state.sessionCleanup.run(() => {});
                assert.equal(f.state.sessionCleanup.safe, false);
            } else assert.doesNotThrow(() => f.state.sessionCleanup.assertSafe(), "later relinquishment may safely release");
            if (failure === "none") {
                assert.equal(f.calls.focus, 1);
                assert.equal(f.calls.render, reused ? 0 : 1);
                if (reused) assert.equal(f.state.menuOverlay, f.existing);
            } else assert.equal(f.state.activeMenu, null);
        });
    }
}
for (const boundary of ["epoch", "request", "session", "runtime", "overlay"])
    for (const rejected of [false, true]) {
        test("obsolete fullscreen completion cannot affect replacement: " + boundary + "/" + rejected, async () => {
            const f = livePresentationFixture();
            const work = f.subject.showLiveMenuOverlay();
            if (boundary === "epoch") f.owner.epoch++;
            if (boundary === "request") f.state.menuRequestSerial++;
            if (boundary === "session") f.state.gameSessionGeneration++;
            if (boundary === "runtime") f.state.game = {};
            const replacement = f.node();
            if (boundary === "overlay") {
                f.state.menuOverlay = replacement;
                f.state.activeMenu = replacement;
            }
            const expectedOverlay = f.state.menuOverlay;
            if (rejected) f.rejectExit(new Error("obsolete rejection"));
            else f.resolveExit(true);
            await assert.doesNotReject(work);
            assert.equal(f.calls.destroy + f.calls.render + f.calls.focus + f.calls.recovery, 0);
            assert.equal(f.state.menuOverlay, expectedOverlay);
            assert.equal(replacement.isConnected, true);
        });
    }
for (const failure of ["render-reentry", "focus-reentry"])
    test("synchronous presentation reentry is fenced: " + failure, async () => {
        const f = livePresentationFixture(failure);
        const work = f.subject.showLiveMenuOverlay();
        f.resolveExit(true);
        await work;
        assert.equal(f.calls.destroy + f.calls.recovery, 0);
        assert.equal(f.state.sessionCleanup.safe, true);
        if (failure === "render-reentry") {
            assert.equal(f.state.menuOverlay, null);
            assert.equal(f.calls.removed, 1);
            assert.equal(f.calls.focus, 0);
        }
    });
test("missing retained overlay never requests a new presentation", async () => {
    const f = livePresentationFixture();
    await f.subject.restoreExistingLiveMenuAfterInterruptedResume(1);
    assert.equal(f.calls.render + f.calls.save + f.calls.destroy, 0);
});
