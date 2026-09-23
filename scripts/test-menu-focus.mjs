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
