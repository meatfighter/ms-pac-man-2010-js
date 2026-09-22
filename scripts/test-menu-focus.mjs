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
