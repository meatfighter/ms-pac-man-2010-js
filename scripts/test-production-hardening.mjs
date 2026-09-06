import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(path, context) {
    const source = readFileSync(path, "utf8").replace(/(?<!typeof )import\(("[^"]+")\)/g, "loadModule($1)");
    context.exports = {};
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
    return context.exports;
}

test("failed runtime import aborts and settles preloading before retry is exposed", async () => {
    let settled = false;
    let signal;
    let finish;
    const context = {
        console,
        AbortController,
        loadModule: async (name) => {
            if (name.includes("Main.js")) throw new Error("chunk missing");
            return {};
        },
        require(name) {
            if (name === "slick2d-ts") return { ResourceLoader: {}, SoundStore: {} };
            if (name.includes("resourceManifest")) return { RESOURCE_REFS: ["image.png"] };
            return {};
        }
    };
    const { RuntimeLoader } = load("pwa/src/app/RuntimeLoader.ts", context);
    const loader = new RuntimeLoader(() => {});
    loader.preloadPreparedResources = (_refs, value) => {
        signal = value;
        return new Promise((_resolve, reject) => {
            finish = () => {
                settled = true;
                reject(signal.reason);
            };
        });
    };
    let exposed = false;
    const pending = loader.prepareRuntime(new AbortController()).catch((error) => {
        exposed = true;
        throw error;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(signal.aborted, true);
    assert.equal(exposed, false);
    finish();
    await assert.rejects(pending, /chunk missing/);
    assert.equal(settled, true);
    assert.equal(exposed, true);
});

test("oversized public save is preserved by inspection and automatic saving", () => {
    const text = JSON.stringify({ version: 5, payload: "x".repeat(1_000_001) });
    let stored = text;
    const context = {
        console,
        localStorage: {
            getItem: () => stored,
            removeItem: () => {
                stored = null;
            },
            setItem: (_key, value) => {
                stored = value;
            }
        },
        require(name) {
            if (name.includes("BrowserStorageKeys")) return { createBrowserStorageKeys: () => ({ gameState: "save" }) };
            if (name.includes("SnapshotLimits")) return { MAX_SNAPSHOT_TEXT_LENGTH: 1_000_000 };
            if (name.includes("Serializer"))
                return {
                    MsPacManGameStateSerializer: class {
                        createSnapshot() {
                            throw new Error("must not replace protected save");
                        }
                    }
                };
            return { FIRST_PUBLIC_GAME_STATE_VERSION: 4, GAME_STATE_VERSION: 4 };
        }
    };
    const { MsPacManGameStateStore } = load("pwa/src/mspacman/persistence/MsPacManGameStateStore.ts", context);
    const store = new MsPacManGameStateStore("test");
    assert.equal(store.hasValidSave(), false);
    assert.equal(stored, text);
    assert.equal(store.save({ isStateSaveReady: () => true }), false);
    assert.equal(stored, text);
    store.clear(); // Explicit New Game / Reset remains authorized to discard it.
    assert.equal(stored, null);
});
