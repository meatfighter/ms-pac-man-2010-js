import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
const html = readFileSync("pwa/index.html", "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function fixture() {
    const listeners = new Map();
    let timer;
    let failed = 0;
    let focused = 0;
    const window = {
        location: { href: "https://example.test/game/", origin: "https://example.test" },
        setTimeout(callback) {
            timer = callback;
            return 1;
        },
        addEventListener(name, callback) {
            listeners.set(name, callback);
        },
        removeEventListener(name) {
            listeners.delete(name);
        }
    };
    const document = {
        readyState: "complete",
        getElementById: () => ({
            isConnected: true,
            classList: {
                add() {
                    failed++;
                }
            },
            querySelector: () => ({
                focus() {
                    focused++;
                }
            })
        })
    };
    vm.runInNewContext(script, {
        window,
        document,
        URL,
        clearTimeout() {
            timer = null;
        },
        HTMLScriptElement: class {},
        HTMLLinkElement: class {}
    });
    const authority = Object.entries(window).find(([key]) => key.endsWith("Bootstrap"))[1];
    return {
        authority,
        listeners,
        document,
        expire() {
            timer?.();
        },
        failed: () => failed,
        focused: () => focused
    };
}
test("bootstrap watchdog latches failure and refuses a late app claim", () => {
    const f = fixture();
    f.expire();
    assert.equal(f.authority.claim(), false);
    assert.equal(f.failed(), 1);
    assert.equal(f.focused(), 1);
    f.authority.fail();
    assert.equal(f.failed(), 1);
});
test("app claim removes bootstrap authority and listeners", () => {
    const f = fixture();
    assert.equal(f.authority.claim(), true);
    assert.equal(f.authority.claim(), false);
    f.authority.fail();
    f.expire();
    assert.equal(f.failed(), 0);
    assert.equal(f.listeners.size, 0);
});
test("failure before DOM ready installs only one deferred renderer", () => {
    const f = fixture();
    f.document.readyState = "loading";
    f.authority.fail();
    f.authority.fail();
    assert.equal(f.failed(), 0);
    assert.equal(f.authority.claim(), false);
    assert.equal(f.listeners.size, 1);
    f.listeners.get("DOMContentLoaded")();
    assert.equal(f.failed(), 1);
});
