import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { runSettledBatch } from "slick2d-ts/slick/util/BatchLoader";

const packageName = JSON.parse(readFileSync("package.json", "utf8")).name;
const jackal = packageName === "jackal-js";
const stickvania = packageName === "stickvania-js";
const filename = jackal ? "JackalRuntimeLoader" : "RuntimeLoader";
const className = jackal ? "JackalRuntimeLoader" : stickvania ? "StickvaniaRuntimeLoader" : "RuntimeLoader";
async function flush() {
    for (let i = 0; i < 80; i++) await Promise.resolve();
}
function fixture() {
    const timers = new Map();
    let serial = 0;
    const state = { fail: null, native: Promise.resolve(), stalledImport: false, calls: 0, progress: 0 };
    const sound = { waitForNativeAudioDecodes: () => state.native, get: () => ({ preloadAudioBuffer: async () => {} }) };
    const ResourceLoader = {
        clearFailures() {},
        removeAllResourceLocations() {},
        addResourceLocation() {},
        setCacheVersionResolver() {},
        setRetryOptions() {},
        setCacheBust() {},
        async loadResource() {
            state.calls++;
            if (state.fail) throw state.fail;
            return new ArrayBuffer(0);
        }
    };
    let helper;
    const globals = {
        AbortController,
        DOMException,
        URL,
        console,
        window: { location: { href: "https://example.test/game/" } },
        setTimeout(callback, delay) {
            const id = ++serial;
            timers.set(id, { callback, delay });
            return id;
        },
        clearTimeout(id) {
            timers.delete(id);
        },
        require(name) {
            if (name.includes("PreparationDeadline")) return helper;
            if (name.includes("BatchLoader")) return { runSettledBatch };
            if (name.includes("ServiceWorkerRegistrar")) return { waitForServiceWorkerStartupGrace: async () => {} };
            if (name.includes("ResourceVersions")) return { RESOURCE_VERSIONS: {}, getResourceVersion() {}, getStickvaniaResourceVersion() {} };
            if (name.includes("BuildInfo")) return { BUILD_STAMP: "test" };
            if (name.includes("Manifest") || name.includes("resourceManifest") || name.includes("resources.js"))
                return { RESOURCE_MANIFEST: ["a.bin", "b.bin"], RESOURCE_REFS: ["a.bin", "b.bin"], STICKVANIA_RESOURCE_REFS: ["a.bin", "b.bin"] };
            if (name.includes("Main.js") && state.stalledImport) return new Promise(() => {});
            return {
                ResourceLoader,
                SoundStore: sound,
                Main: class {},
                ScalableGame2: class {},
                StickvaniaBufferedGame: class {},
                MsPacManGameStateStore: class {},
                JackalGameStateStore: class {},
                StickvaniaGameStateStore: class {}
            };
        }
    };
    function compile(file) {
        const context = { ...globals, __import: (name) => Promise.resolve(globals.require(name)), exports: {} };
        const source = readFileSync("pwa/src/app/" + file + ".ts", "utf8")
            .replace(/\bimport\(/g, "__import(")
            .replaceAll("import.meta.env.BASE_URL", '"/"');
        vm.runInNewContext(
            ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
            context
        );
        return context.exports;
    }
    helper = compile("PreparationDeadline");
    const module = compile(filename);
    const loader = new module[className](() => state.progress++);
    return {
        state,
        loader,
        helper,
        module,
        prepare: (retry) => (jackal || stickvania ? loader.ensurePrepared(retry) : loader.prepare(retry)),
        cancel: () => (jackal ? loader.cancelPreparation() : stickvania ? loader.cancelPendingPreparation() : loader.abort()),
        async expire(delay) {
            for (const [id, timer] of [...timers])
                if (timer.delay === delay) {
                    timers.delete(id);
                    timer.callback();
                }
            await flush();
        }
    };
}

test("settled resource failure retains its cause and permits a safe Retry", async () => {
    const f = fixture();
    f.state.fail = Object.assign(new Error("resource timed out"), { kind: "abort" });
    await assert.rejects(f.prepare(false), (error) => error === f.state.fail);
    if (jackal) assert.equal(f.module.isRuntimePreparationAbort(f.state.fail), false);
    f.state.fail = null;
    assert.ok(await f.prepare(true));
});

test("unsettled import reaches Reload and never starts replacement preparation", async () => {
    const f = fixture();
    f.state.stalledImport = true;
    const pending = f.prepare(false);
    const rejected = assert.rejects(pending, f.helper.ReloadRequiredError);
    await flush();
    await f.expire(120000);
    await f.expire(5000);
    await rejected;
    await assert.rejects(f.prepare(true), f.helper.ReloadRequiredError);
    assert.equal(f.state.calls, 0);
});

test("canceled native decoding must settle before Retry can start", async () => {
    const f = fixture();
    let settle;
    f.state.native = new Promise((resolve) => {
        settle = resolve;
    });
    f.state.fail = new Error("required resource failed");
    const pending = f.prepare(false);
    const rejected = assert.rejects(pending, (error) => error === f.state.fail);
    await flush();
    let done = false;
    void pending.then(
        () => {
            done = true;
        },
        () => {
            done = true;
        }
    );
    await flush();
    assert.equal(done, false);
    settle();
    await rejected;
    f.state.fail = null;
    assert.ok(await f.prepare(true));
});

test("unsettled native decoding latches Reload instead of accumulating retries", async () => {
    const f = fixture();
    f.state.native = new Promise(() => {});
    f.state.fail = new Error("failed");
    const rejected = assert.rejects(f.prepare(false), f.helper.ReloadRequiredError);
    await flush();
    await f.expire(5000);
    await rejected;
    const count = f.state.calls;
    await assert.rejects(f.prepare(true), f.helper.ReloadRequiredError);
    assert.equal(f.state.calls, count);
});

test("explicit cancellation cannot publish a prepared runtime or late progress", async () => {
    const f = fixture();
    const pending = f.prepare(false);
    f.cancel();
    await assert.rejects(pending, (error) => error.name === "AbortError");
    assert.equal(f.loader.prepared, null);
    assert.equal(f.state.progress, 0);
});

test("initializer timeout latches unsafe cleanup before exposing Reload", async () => {
    const f = fixture();
    let safe = true;
    const cleanup = {
        run(step) {
            try {
                step();
            } catch {
                safe = false;
            }
            return safe;
        }
    };
    const rejected = assert.rejects(f.helper.initializeWithDeadline(new Promise(() => {}), cleanup), f.helper.ReloadRequiredError);
    await f.expire(120000);
    await rejected;
    assert.equal(safe, false);
});
