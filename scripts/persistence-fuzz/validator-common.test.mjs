import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { isSnapshotJsonWithinBudget } from "../../pwa/src/app/SnapshotJsonBudget.ts";
import { writeCurrentSnapshot } from "../../pwa/src/app/BrowserPersistence.ts";
const game = JSON.parse(readFileSync("package.json", "utf8")).name;
const prefix = game === "jackal-js" ? "jackal" : game === "stickvania-js" ? "stickvania" : "mspacman";
const { retainRejectedSave, REJECTED_SAVE_DEBUG_KEY } = await import(`../../pwa/src/${prefix}/persistence/RejectedSaveDebug.ts`);

test("JSON budget accepts repeated aliases and finite large values, rejecting cycles/non-JSON without invoking getters", () => {
    const alias = { value: 1e20 };
    assert.equal(isSnapshotJsonWithinBudget({ a: alias, b: alias, score: 2147483650, timer: 1000001 }), true);
    const cycle = {};
    cycle.next = cycle;
    assert.equal(isSnapshotJsonWithinBudget(cycle), false);
    let getters = 0;
    const accessor = {};
    Object.defineProperty(accessor, "x", {
        enumerable: true,
        get() {
            getters++;
            return 1;
        }
    });
    for (const value of [accessor, { n: NaN }, { n: Infinity }, { n: undefined }, { n: 2n }, { n() {} }, new Array(2), { n: new Date() }])
        assert.equal(isSnapshotJsonWithinBudget(value), false);
    assert.equal(getters, 0);
    assert.equal(isSnapshotJsonWithinBudget({ text: "x".repeat(4097) }), false);
    assert.equal(isSnapshotJsonWithinBudget(JSON.parse('{"__proto__":{}}')), false);
});

test("failure recorder preserves original snapshot; successful writes and storage failures do no debug work", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
        warn = console.warn;
    const values = new Map([["canonical", "previous"]]);
    const writes = [];
    let failStorage = false,
        authorized = true;
    const storage = {
        getItem: (key) => values.get(key) ?? null,
        setItem(key, text) {
            writes.push(key);
            if (failStorage) throw Error("quota");
            values.set(key, text);
        }
    };
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    console.warn = () => {};
    const snapshot = { version: 1, mainFields: { score: 12 }, things: [], mode: 4 };
    try {
        const invalid = (value) => {
            retainRejectedSave(
                value,
                "test",
                { stage: "loaded-resources", kind: "returned-false", ruleCode: "test-resource", fieldPath: "stage" },
                () => authorized
            );
            return false;
        };
        assert.equal(writeCurrentSnapshot("test", "canonical", snapshot, invalid, 2_000_000, () => authorized).reason, "invalid-snapshot");
        assert.deepEqual(writes, [REJECTED_SAVE_DEBUG_KEY]);
        assert.equal(values.get("canonical"), "previous");
        const debug = JSON.parse(values.get(REJECTED_SAVE_DEBUG_KEY));
        assert.deepEqual(debug.snapshot, snapshot);
        assert.equal(debug.ruleCode, "test-resource");
        writes.length = 0;
        const preserved = values.get(REJECTED_SAVE_DEBUG_KEY);
        assert.equal(
            writeCurrentSnapshot(
                "test",
                "canonical",
                snapshot,
                () => true,
                2_000_000,
                () => authorized
            ).saved,
            true
        );
        assert.deepEqual(writes, ["canonical"]);
        assert.equal(values.get(REJECTED_SAVE_DEBUG_KEY), preserved);
        writes.length = 0;
        failStorage = true;
        assert.equal(
            writeCurrentSnapshot(
                "test",
                "canonical",
                snapshot,
                () => true,
                2_000_000,
                () => authorized
            ).reason,
            "write-failed"
        );
        assert.deepEqual(writes, ["canonical"]);
        failStorage = false;
        writes.length = 0;
        authorized = false;
        retainRejectedSave(snapshot, "test", { stage: "loaded-resources", kind: "returned-false" }, () => authorized);
        assert.deepEqual(writes, []);
        authorized = true;
        Object.defineProperty(globalThis, "localStorage", {
            configurable: true,
            get() {
                authorized = false;
                return storage;
            }
        });
        retainRejectedSave(snapshot, "test", { stage: "loaded-resources", kind: "returned-false" }, () => authorized);
        assert.deepEqual(writes, []);
    } finally {
        console.warn = warn;
        if (original) Object.defineProperty(globalThis, "localStorage", original);
        else delete globalThis.localStorage;
    }
});

test("debug serialization is best effort and cannot invoke malicious JSON methods", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    let calls = 0,
        text = null;
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
            setItem(_key, value) {
                text = value;
            }
        }
    });
    try {
        const snapshot = {
            toJSON() {
                calls++;
                throw Error("should not execute");
            }
        };
        assert.doesNotThrow(() => retainRejectedSave(snapshot, "test", { stage: "structure-and-graph", kind: "returned-false" }, () => true));
        assert.equal(calls, 0);
        assert.equal(JSON.parse(text).snapshotIncluded, false);
    } finally {
        if (original) Object.defineProperty(globalThis, "localStorage", original);
        else delete globalThis.localStorage;
    }
});

test("rejected evidence never invokes snapshot getters or recursively records storage reentry", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    let calls = 0,
        getters = 0;
    const rows = [];
    const snapshot = { version: 27 };
    Object.defineProperty(snapshot, "mainFields", {
        enumerable: true,
        get() {
            getters++;
            return {};
        }
    });
    const failure = { stage: "structure-and-graph", kind: "returned-false" };
    try {
        Object.defineProperty(globalThis, "localStorage", {
            configurable: true,
            value: {
                setItem(key, value) {
                    calls++;
                    assert.ok(calls <= 2, "recursive recorder must be blocked");
                    retainRejectedSave(snapshot, "nested", failure, () => true);
                    rows.push([key, JSON.parse(value)]);
                }
            }
        });
        retainRejectedSave(snapshot, "outer", failure, () => true);
        assert.equal(getters, 0);
        assert.equal(calls, 1);
        assert.equal(rows[0][1].snapshotIncluded, false);
        assert.equal(rows[0][1].appVersion, "outer");
        retainRejectedSave({ version: 27 }, "later", failure, () => true);
        assert.equal(calls, 2, "guard must be released after recording");
    } finally {
        if (original) Object.defineProperty(globalThis, "localStorage", original);
        else delete globalThis.localStorage;
    }
});

test("debug full-to-compact fallback rechecks authority and records non-Error throws", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const rows = [];
    let authorized = true,
        revoke = false;
    const snapshot = { version: 1, mainFields: { score: 17 } };
    const failure = { stage: "loaded-resources", kind: "threw", error: "plain throw" };
    try {
        Object.defineProperty(globalThis, "localStorage", {
            configurable: true,
            value: {
                setItem(_key, text) {
                    const row = JSON.parse(text);
                    rows.push(row);
                    if (row.snapshotIncluded) {
                        if (revoke) authorized = false;
                        throw Error("quota");
                    }
                }
            }
        });
        retainRejectedSave(snapshot, "test", failure, () => authorized);
        assert.equal(rows.length, 2);
        assert.equal(rows[0].snapshotIncluded, true);
        assert.equal(rows[1].snapshotIncluded, false);
        assert.equal(rows[1].error.name, "ThrownValue");
        assert.equal(rows[1].snapshotOmittedReason, "full-record-storage-write-failed");
        rows.length = 0;
        revoke = true;
        retainRejectedSave(snapshot, "test", failure, () => authorized);
        assert.equal(rows.length, 1);
    } finally {
        if (original) Object.defineProperty(globalThis, "localStorage", original);
        else delete globalThis.localStorage;
    }
});

test("consumed engine allocation and replacement both expose exactly 62 SFX slots", async () => {
    const { SoundStore } = await import("slick2d-ts");
    const store = new SoundStore();
    const ids = [];
    for (let i = 0; i < store.getSourceCount(); i++) {
        const id = store.findFreeSoundSource();
        if (id === -1) break;
        ids.push(id);
        store.soundSources[id] = { playing: () => true };
    }
    assert.equal(ids.length, 62);
    assert.deepEqual(
        ids,
        Array.from({ length: store.getSourceCount() - 2 }, (_, i) => i + 1)
    );
    assert.equal(store.findReplacementSoundSourceIds(new Set(), 1), null);
    const owned = new Set(ids.map((id) => store.soundSources[id]));
    assert.deepEqual(store.findReplacementSoundSourceIds(owned, ids.length), ids);
    assert.equal(store.findReplacementSoundSourceIds(owned, ids.length + 1), null);
    const source = readFileSync(
        game === "jackal-js"
            ? "pwa/src/jackal/persistence/GameStateSnapshotValidator.ts"
            : game === "stickvania-js"
              ? "pwa/src/stickvania/AudioRegistry.ts"
              : "pwa/src/mspacman/persistence/MsPacManGameStateSerializer.ts",
        "utf8"
    );
    assert.match(source, new RegExp(`MAX_(?:TOTAL_SOUND_VOICES|SOUND_VOICES|PERSISTED_SOUND_EFFECT_VOICES) = ${ids.length}\\b`));
});
