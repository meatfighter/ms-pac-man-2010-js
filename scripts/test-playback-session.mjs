import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function loadPlaybackAdapter() {
    let instance = null;
    let nextId = 0;
    let onBegin = null;

    class FakePlaybackSession {
        constructor() {
            instance = this;
            this.current = null;
            this.cancelCount = 0;
            this.commitCount = 0;
            this.interruptionHandler = null;
        }

        begin() {
            const attempt = Object.freeze({ id: ++nextId, ready: Promise.resolve(true) });
            this.current = attempt;
            onBegin?.(attempt);
            return attempt;
        }

        isCurrent(attempt) {
            return this.current === attempt;
        }

        commit(attempt) {
            this.commitCount++;
            return Promise.resolve(this.current === attempt);
        }

        cancel() {
            this.cancelCount++;
            this.current = null;
        }

        setInterruptionHandler(handler) {
            this.interruptionHandler = handler;
        }
    }

    const context = {
        exports: {},
        console,
        require: (specifier) => {
            assert.equal(specifier, "slick2d-ts/slick/openal/PlaybackSession");
            return { PlaybackSession: FakePlaybackSession };
        }
    };
    const source = readFileSync("pwa/src/app/PlaybackSession.ts", "utf8");
    const compiled = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    });
    vm.runInNewContext(compiled.outputText, context);
    assert.ok(instance, "adapter must construct exactly one engine PlaybackSession");
    return {
        api: context.exports,
        playback: instance,
        setOnBegin(callback) {
            onBegin = callback;
        }
    };
}

test("begin publishes one current activation and commit stays scoped to it", async () => {
    const loaded = loadPlaybackAdapter();
    const attempt = loaded.api.beginGameAudio();
    assert.equal(loaded.api.isGameAudioLatest(attempt), true);
    assert.equal(loaded.api.isGameAudioCurrent(attempt), true);
    assert.equal(await loaded.api.commitGameAudio(attempt), true);
    assert.equal(loaded.playback.commitCount, 1);
});

test("synchronous departure during native begin cannot republish the cancelled attempt", async () => {
    const loaded = loadPlaybackAdapter();
    loaded.setOnBegin(() => loaded.api.releaseGameAudio());
    const attempt = loaded.api.beginGameAudio();
    assert.equal(loaded.api.isGameAudioLatest(attempt), false);
    assert.equal(loaded.api.isGameAudioCurrent(attempt), false);
    assert.equal(await loaded.api.commitGameAudio(attempt), false);
    assert.equal(loaded.playback.cancelCount, 1);
    assert.equal(loaded.playback.commitCount, 0);
});

test("stale release cannot cancel a newer activation", () => {
    const loaded = loadPlaybackAdapter();
    const first = loaded.api.beginGameAudio();
    const second = loaded.api.beginGameAudio();
    const before = loaded.playback.cancelCount;
    loaded.api.releaseGameAudio(first);
    assert.equal(loaded.playback.cancelCount, before);
    assert.equal(loaded.api.isGameAudioLatest(second), true);
    assert.equal(loaded.api.isGameAudioCurrent(second), true);
    loaded.api.releaseGameAudio(second);
    assert.equal(loaded.playback.cancelCount, before + 1);
});

test("interruption routing is delegated to the engine transaction", () => {
    const loaded = loadPlaybackAdapter();
    const reasons = [];
    loaded.api.setGameAudioInterruptionHandler((reason) => reasons.push(reason));
    loaded.playback.interruptionHandler("device-change");
    assert.deepEqual(reasons, ["device-change"]);
    loaded.api.setGameAudioInterruptionHandler(null);
    assert.equal(loaded.playback.interruptionHandler, null);
});
