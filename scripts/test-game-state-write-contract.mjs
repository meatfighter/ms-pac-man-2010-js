import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { loadTypeScript, memoryStorage } from "./persistence-test-loader.mjs";
const config = {
    schema: "pwa/src/mspacman/persistence/GameStateSnapshot.ts",
    store: "pwa/src/mspacman/persistence/MsPacManGameStateStore.ts",
    storeName: "MsPacManGameStateStore",
    serializer: "pwa/src/mspacman/persistence/MsPacManGameStateSerializer.ts",
    serializerName: "MsPacManGameStateSerializer",
    mocks: {}
};
const schemaText = readFileSync(config.schema, "utf8");
const version = Number(/GAME_STATE_VERSION\s*=\s*(\d+)/.exec(schemaText)[1]);
const controls = { captureThrows: false, restoreThrows: false, captureHook: null };
globalThis.__persistenceStoreTest = controls;
const makeSnapshot = () => ({ version, supported: true, marker: "fresh" });
controls.snapshot = makeSnapshot;
const serializer = `export function isValidSnapshotForLoadedResources(){return true;}
export class ${config.serializerName} {
    createSnapshot(){const c=globalThis.__persistenceStoreTest;c.captureHook?.();if(c.captureThrows)throw new Error("capture failure");return c.snapshot();}
    isSupportedSnapshot(s){return s?.version===${version} && s?.supported===true;}
    isSupportedSnapshotForLoadedResources(){return true;}
    restoreSnapshot(main,gc,s){if(globalThis.__persistenceStoreTest.restoreThrows)throw new Error("restore failure");main.restored=s.marker;}
}`;
const mocks = { [config.serializer]: serializer, ...config.mocks };
if (config.validator) mocks[config.validator] = `export function isSupportedGameStateSnapshot(s){return s?.version===${version} && s?.supported===true;}`;
const loaded = await loadTypeScript(config.store, mocks);
const Store = loaded[config.storeName];
const store = new Store("persistence-boundary-test");
const realStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const s = memoryStorage();
const main = () => ({ isStateSaveReady: () => true });
function install() {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: s });
}
function restore() {
    if (realStorage) Object.defineProperty(globalThis, "localStorage", realStorage);
    else delete globalThis.localStorage;
}
const warn = console.warn;

test("real store boundary: invalid old data cannot poison writes and no read is made on save", () => {
    install();
    console.warn = () => {};
    try {
        assert.equal(store.save(main(), () => true).saved, true);
        const key = s.calls.set.at(-1);
        assert.match(key, /game-state(?::|$)/);
        assert.doesNotMatch(key, /game-state-v\d+/);
        const inputs = [
            "{",
            "null",
            "42",
            "[]",
            "{}",
            "",
            JSON.stringify({ version: version - 1, supported: true }),
            JSON.stringify({ version: version + 1, supported: true }),
            JSON.stringify({ version, supported: false }),
            "x".repeat(2_000_001)
        ];
        for (const raw of inputs) {
            s.values.set(key, raw);
            s.faults.get = false;
            assert.equal(store.hasValidSave(), false);
            assert.equal(store.restore(main(), {}), false);
            assert.equal(s.values.get(key), raw);
            s.clearCalls();
            s.faults.get = true;
            assert.deepEqual(
                store.save(main(), () => true),
                { saved: true }
            );
            assert.deepEqual(s.calls.get, []);
            assert.deepEqual(s.calls.remove, []);
            assert.deepEqual(s.calls.set, [key]);
            assert.equal(JSON.parse(s.values.get(key)).version, version);
        }
        s.faults.get = false;
        assert.equal(store.hasValidSave(), true);
        const destination = main();
        assert.equal(store.restore(destination, {}), true);
        assert.equal(destination.restored, "fresh");
    } finally {
        console.warn = warn;
        restore();
    }
});

test("real store clear rechecks authority at the final storage boundary", () => {
    install();
    console.warn = () => {};
    try {
        assert.equal(store.save(main(), () => true).saved, true);
        const key = s.calls.set.at(-1);
        const previous = s.values.get(key);
        const storage = s;
        let authorized = true;
        Object.defineProperty(globalThis, "localStorage", {
            configurable: true,
            get() {
                authorized = false;
                return storage;
            }
        });
        s.clearCalls();
        assert.equal(
            store.clear(() => authorized),
            false
        );
        assert.equal(s.values.get(key), previous);
        assert.deepEqual(s.calls.get, []);
        assert.deepEqual(s.calls.set, []);
        assert.deepEqual(s.calls.remove, []);

        install();
        authorized = true;
        s.clearCalls();
        assert.equal(
            store.clear(() => authorized),
            true
        );
        assert.deepEqual(s.calls.get, []);
        assert.deepEqual(s.calls.set, []);
        assert.deepEqual(s.calls.remove, [key]);
        assert.equal(s.values.has(key), false);
    } finally {
        console.warn = warn;
        restore();
    }
});

test("real store boundary: capture, mutation failure, denial, and restore failure preserve bytes", () => {
    install();
    console.warn = () => {};
    try {
        s.faults.get = false;
        s.faults.set = false;
        controls.captureThrows = false;
        assert.equal(store.save(main(), () => true).saved, true);
        const key = s.calls.set.at(-1);
        const previous = s.values.get(key);
        controls.captureThrows = true;
        s.clearCalls();
        assert.equal(store.save(main(), () => true).reason, "capture-failed");
        assert.equal(s.values.get(key), previous);
        controls.captureThrows = false;
        s.faults.set = true;
        assert.equal(store.save(main(), () => true).reason, "write-failed");
        assert.equal(s.values.get(key), previous);
        s.faults.set = false;
        let authorized = true;
        controls.captureHook = () => {
            authorized = false;
        };
        s.clearCalls();
        assert.equal(store.save(main(), () => authorized).reason, "not-authorized");
        assert.deepEqual(s.calls.set, []);
        controls.captureHook = null;
        controls.restoreThrows = true;
        assert.equal(store.restore(main(), {}), false);
        assert.equal(s.values.get(key), previous);
        controls.restoreThrows = false;
        assert.equal(store.save(main(), () => true).saved, true);
    } finally {
        controls.captureThrows = false;
        controls.restoreThrows = false;
        controls.captureHook = null;
        console.warn = warn;
        restore();
    }
});
