import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function transpileModule(path, globals = {}) {
    const context = { exports: {}, console, ...globals };
    const source = readFileSync(path, "utf8");
    const compiled = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    });
    vm.runInNewContext(compiled.outputText, context);
    return context.exports;
}

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

    const api = transpileModule("pwa/src/app/PlaybackSession.ts", {
        require: (specifier) => {
            assert.equal(specifier, "slick2d-ts/slick/openal/PlaybackSession");
            return { PlaybackSession: FakePlaybackSession };
        }
    });
    assert.ok(instance, "adapter must construct exactly one engine PlaybackSession");
    return {
        api,
        playback: instance,
        setOnBegin(callback) {
            onBegin = callback;
        }
    };
}

function loadSessionCleanup() {
    const { SessionCleanup } = transpileModule("pwa/src/app/SessionCleanup.ts");
    return new SessionCleanup();
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

test("synchronous replacement begin cannot be overwritten by the outer activation", async () => {
    const loaded = loadPlaybackAdapter();
    let replacement = null;
    loaded.setOnBegin(() => {
        loaded.setOnBegin(null);
        replacement = loaded.api.beginGameAudio();
    });

    const outer = loaded.api.beginGameAudio();

    assert.notEqual(replacement, null);
    assert.equal(loaded.api.isGameAudioLatest(outer), false);
    assert.equal(loaded.api.isGameAudioCurrent(outer), false);
    assert.equal(await loaded.api.commitGameAudio(outer), false);
    assert.equal(loaded.api.isGameAudioLatest(replacement), true);
    assert.equal(loaded.api.isGameAudioCurrent(replacement), true);
    assert.equal(await loaded.api.commitGameAudio(replacement), true);
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

test("session cleanup attempts every essential step and keeps unsafe failure latched", () => {
    const cleanup = loadSessionCleanup();
    const calls = [];

    assert.equal(
        cleanup.run(
            () => {
                calls.push("first");
                throw new Error("first cleanup failed");
            },
            () => calls.push("second"),
            () => {
                calls.push("third");
                throw new Error("third cleanup failed");
            }
        ),
        false
    );
    assert.deepEqual(calls, ["first", "second", "third"]);
    const failure = cleanup.failure;
    assert.notEqual(failure, null);

    assert.equal(cleanup.run(() => calls.push("retry")), false);
    assert.equal(cleanup.failure, failure);
    assert.deepEqual(calls, ["first", "second", "third", "retry"]);
    assert.throws(() => cleanup.assertSafe());
});

test("save failure is recoverable and does not poison resource safety", () => {
    const cleanup = loadSessionCleanup();
    const originalWarn = console.warn;
    let warnings = 0;
    console.warn = () => warnings++;
    try {
        assert.equal(cleanup.trySave(() => false), false);
        assert.equal(
            cleanup.trySave(() => {
                throw new Error("quota");
            }),
            false
        );
    } finally {
        console.warn = originalWarn;
    }

    assert.equal(warnings, 1);
    assert.equal(cleanup.safe, true);
    assert.equal(cleanup.failure, null);
    assert.doesNotThrow(() => cleanup.assertSafe());
});
