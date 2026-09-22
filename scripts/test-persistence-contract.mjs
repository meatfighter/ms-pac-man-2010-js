import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadTypeScript, memoryStorage } from "./persistence-test-loader.mjs";
const policy = await loadTypeScript("pwa/src/app/BrowserPersistence.ts");
const { PersistenceSession, RestoreAttempt } = await loadTypeScript("pwa/src/app/PersistenceSession.ts");

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const valid = (value) => value?.version === 1 && value?.ok === true;
function install(storage) {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
}
function restore() {
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else delete globalThis.localStorage;
}

test("outgoing writes are independent of all existing values and previous read outcomes", () => {
    const s = memoryStorage();
    install(s);
    try {
        const fixtures = [
            null,
            "",
            " ",
            "{",
            "null",
            "true",
            "42",
            '"text"',
            "[]",
            "{}",
            JSON.stringify({ version: 0, ok: true }),
            JSON.stringify({ version: 2, ok: true }),
            JSON.stringify({ version: 1, ok: false }),
            "x".repeat(8193)
        ];
        for (const raw of fixtures) {
            s.values.clear();
            if (raw !== null) s.values.set("game", raw);
            assert.equal(policy.readCurrentJson("game", 8192, valid), null);
            assert.equal(s.values.get("game") ?? null, raw);
            s.faults.get = true;
            s.clearCalls();
            assert.deepEqual(
                policy.writeCurrentSnapshot("test", "game", { version: 1, ok: true }, valid, 8192, () => true),
                { saved: true }
            );
            assert.deepEqual(s.calls.get, []);
            assert.deepEqual(s.calls.remove, []);
            assert.deepEqual(s.calls.set, ["game"]);
            assert.equal(JSON.parse(s.values.get("game")).ok, true);
            s.faults.get = false;
        }
    } finally {
        restore();
    }
});

test("only outgoing failures and final authority prevent writes; previous bytes survive", () => {
    const s = memoryStorage();
    install(s);
    const warn = console.warn;
    const messages = [];
    console.warn = (...args) => messages.push(args);
    try {
        s.values.set("game", "previous");
        const cases = [
            [
                () =>
                    policy.captureAndWriteSnapshot(
                        "test",
                        "game",
                        () => {
                            throw new Error("capture");
                        },
                        valid,
                        8192,
                        () => true
                    ),
                "capture-failed"
            ],
            [() => policy.writeCurrentSnapshot("test", "game", { version: 1, ok: false }, valid, 8192, () => true), "invalid-snapshot"],
            [
                () =>
                    policy.writeCurrentSnapshot(
                        "test",
                        "game",
                        {
                            version: 1,
                            ok: true,
                            toJSON() {
                                throw new Error("encode");
                            }
                        },
                        valid,
                        8192,
                        () => true
                    ),
                "encode-failed"
            ],
            [() => policy.writeCurrentSnapshot("test", "game", { version: 1, ok: true, large: "x".repeat(8193) }, valid, 8192, () => true), "too-large"],
            [() => policy.writeCurrentSnapshot("test", "game", { version: 1, ok: true }, valid, 8192, () => false), "not-authorized"]
        ];
        for (const [run, reason] of cases) {
            s.clearCalls();
            assert.deepEqual(run(), { saved: false, reason });
            assert.equal(s.values.get("game"), "previous");
            assert.deepEqual(s.calls.set, []);
            assert.deepEqual(s.calls.get, []);
        }
        let authorized = true;
        const outgoing = {
            version: 1,
            ok: true,
            toJSON() {
                authorized = false;
                return { version: 1, ok: true };
            }
        };
        assert.deepEqual(
            policy.writeCurrentSnapshot("test", "game", outgoing, valid, 8192, () => authorized),
            { saved: false, reason: "not-authorized" }
        );
        s.faults.set = true;
        assert.deepEqual(
            policy.writeCurrentSnapshot("test", "game", { version: 1, ok: true }, valid, 8192, () => true),
            { saved: false, reason: "write-failed" }
        );
        assert.equal(s.values.get("game"), "previous");
        Object.defineProperty(globalThis, "localStorage", {
            configurable: true,
            get() {
                throw new Error("storage getter");
            }
        });
        assert.equal(policy.writeCurrentSnapshot("test", "game", { version: 1, ok: true }, valid, 8192, () => true).reason, "write-failed");
        assert.equal(messages.length, 6, "one diagnostic per actual failure; authority denial is quiet");
    } finally {
        console.warn = warn;
        restore();
    }
});

test("rejected stored Continue does not revoke accepted-runtime saving or live continuation", () => {
    const state = new PersistenceSession();
    const candidate = {};
    const replacement = {};
    assert.equal(state.beginOwnership(10), true);
    assert.equal(state.canSave(candidate), false);
    state.accept(candidate);
    state.rejectStored();
    assert.equal(state.canSave(candidate), true);
    assert.equal(state.canReadStored(), false);
    state.didSave();
    assert.equal(state.canReadStored(), true);
    state.abandonStored();
    state.retire(candidate);
    assert.equal(state.canSave(candidate), false);
    assert.equal(state.canReadStored(), false);
    state.accept(replacement);
    state.retire(candidate);
    assert.equal(state.canSave(replacement), true, "stale retirement cannot clear a replacement");
    assert.equal(state.beginOwnership(10), false);
    assert.equal(state.canSave(replacement), true);
    assert.equal(state.beginOwnership(11), true);
    assert.equal(state.canSave(replacement), false);
    assert.equal(state.canReadStored(), true);
    const attempt = new RestoreAttempt();
    assert.throws(() => attempt.reject());
    assert.equal(attempt.rejected, true);
});

test("reads, preference writes, and removes remain separate key-scoped operations", () => {
    const s = memoryStorage();
    install(s);
    const warn = console.warn;
    console.warn = () => {};
    try {
        s.values.set("mapping", "untouched");
        s.values.set("game", JSON.stringify({ version: 1, ok: true }));
        s.clearCalls();
        assert.equal(policy.readCurrentJson("game", 8192, valid).ok, true);
        assert.deepEqual(s.calls.set, []);
        assert.deepEqual(s.calls.remove, []);
        s.clearCalls();
        assert.equal(
            policy.writePreference("volume", "volume", "20", () => true),
            true
        );
        assert.deepEqual(s.calls.get, []);
        assert.equal(s.values.get("mapping"), "untouched");
        assert.equal(
            policy.removePreference("game", "game", () => false),
            false
        );
        assert.equal(s.values.has("game"), true);
        assert.equal(
            policy.removePreference("game", "game", () => true),
            true
        );
        assert.equal(s.values.get("mapping"), "untouched");
    } finally {
        console.warn = warn;
        restore();
    }
});

test("Pac transition matrix uses the stable game-state slot without fictitious mapping authority", () => {
    const source = readFileSync("pwa/src/PersistenceMatrix.ts", "utf8");
    assert.match(source, /createBrowserStorageKeys\(\)\.gameState/);
    assert.doesNotMatch(source, /mappingBefore|input-mapping|Object\.entries\(localStorage\)/);
});
