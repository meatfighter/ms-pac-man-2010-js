import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function loadAudioUnlock(beginPlaybackGeneration) {
    let installed = 0;
    let ended = 0;
    const manager = {
        install: () => installed++,
        beginPlaybackGeneration,
        endPlaybackGeneration: () => ended++
    };
    const context = {
        exports: {},
        console,
        setTimeout: (callback) => setTimeout(callback, 10),
        clearTimeout,
        require: () => ({ PwaAudioManager: { get: () => manager } })
    };
    const source = readFileSync("pwa/src/app/AudioUnlock.ts", "utf8");
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
    return { exports: context.exports, installed: () => installed, ended: () => ended };
}

test("audio startup creates a fresh PWA playback generation", async () => {
    let requested = 0;
    const loaded = loadAudioUnlock(() => {
        requested++;
        return Promise.resolve(true);
    });

    assert.equal(loaded.installed(), 1);
    const activation = loaded.exports.unlockGameAudio();
    assert.equal(requested, 1);
    await activation;
    assert.equal(loaded.ended(), 0);
});

test("a stalled fresh generation cannot block gameplay startup", async () => {
    let requested = 0;
    const loaded = loadAudioUnlock(() => {
        requested++;
        return new Promise(() => {});
    });

    await loaded.exports.unlockGameAudio();

    assert.equal(requested, 1);
    assert.equal(loaded.ended(), 1);
});
