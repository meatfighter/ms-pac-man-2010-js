import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

test("a stalled audio resume cannot block gameplay startup", async () => {
    let requested = false;
    let cleared = false;
    let installed = false;
    let dprMonitorStarted = false;
    const context = {
        exports: {},
        console,
        setTimeout: (callback) => setTimeout(callback, 10),
        clearTimeout: (timer) => {
            clearTimeout(timer);
            cleared = true;
        },
        require: () => ({
            BrowserAudioLifecycle: {
                get: () => ({
                    install: () => {
                        installed = true;
                    }
                })
            },
            DevicePixelRatioMonitor: class {
                constructor(_changed) {}
                start() {
                    dprMonitorStarted = true;
                }
            },
            SoundStore: {
                get: () => ({
                    unlock: () => {
                        requested = true;
                        return new Promise(() => {});
                    }
                })
            }
        })
    };
    const source = readFileSync("pwa/src/app/AudioUnlock.ts", "utf8");
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
    await context.exports.unlockGameAudio();
    assert.equal(installed, true);
    assert.equal(dprMonitorStarted, true);
    assert.equal(requested, true);
    assert.equal(cleared, true);
});
