import { shellSubject } from "./persistence-test-loader.mjs";
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
    const rejected = assert.rejects(
        f.helper.initializeWithDeadline(new Promise(() => {}), cleanup, { signal: new AbortController().signal, isCurrent: () => true }),
        f.helper.ReloadRequiredError
    );
    await f.expire(120000);
    await rejected;
    assert.equal(safe, false);
});

for (const late of ["resolve", "reject"]) {
    test("retired initializer cancels observation without poisoning replacement: " + late, async () => {
        const f = fixture();
        const lifetime = new AbortController();
        let current = true,
            cleanupCalls = 0,
            settle;
        const operation = new Promise((resolve, reject) => {
            settle = late === "resolve" ? resolve : reject;
        });
        const rejected = assert.rejects(
            f.helper.initializeWithDeadline(
                operation,
                {
                    run() {
                        cleanupCalls++;
                        return false;
                    }
                },
                {
                    signal: lifetime.signal,
                    isCurrent: () => current
                }
            ),
            { name: "AbortError" }
        );
        current = false;
        lifetime.abort();
        await rejected;
        await f.expire(120000);
        settle(new Error("late settlement"));
        await flush();
        assert.equal(cleanupCalls, 0);
    });
}
test("obsolete identity without an abort cannot latch the initializer watchdog", async () => {
    const f = fixture();
    let current = true;
    const pending = f.helper.initializeWithDeadline(
        new Promise(() => {}),
        {
            run() {
                assert.fail("obsolete cleanup");
            }
        },
        {
            signal: new AbortController().signal,
            isCurrent: () => current
        }
    );
    const rejected = assert.rejects(pending, { name: "AbortError" });
    current = false;
    await f.expire(120000);
    await rejected;
});

test("newest boot drains canceled preparation and concurrent Retry joins one replacement", async () => {
    const f = fixture();
    const old = f.prepare(false);
    const canceled = assert.rejects(old, { name: "AbortError" });
    f.cancel();
    const results = await Promise.all([f.prepare(false), f.prepare(true), f.prepare(true)]);
    await canceled;
    assert.equal(results[0], results[1]);
    assert.equal(results[1], results[2]);
    assert.equal(f.state.calls, 2);
});
test("healthy preparation callers share the same runtime without cancellation", async () => {
    const f = fixture();
    const results = await Promise.all([f.prepare(false), f.prepare(false)]);
    assert.equal(results[0], results[1]);
    assert.equal(f.state.calls, 2);
});
test("newest boot cannot bypass canceled nonquiescent preparation", async () => {
    const f = fixture();
    f.state.stalledImport = true;
    const old = f.prepare(false);
    const first = assert.rejects(old, f.helper.ReloadRequiredError);
    await flush();
    f.cancel();
    const newest = assert.rejects(f.prepare(false), f.helper.ReloadRequiredError);
    await flush();
    await f.expire(5000);
    await Promise.all([first, newest]);
    assert.equal(f.state.calls, 0);
});

for (const stale of [false, true]) {
    test("current menu publication failure recovers without overwriting replacement: " + stale, async () => {
        const f = fixture();
        let subject,
            recovery = 0,
            renders = 0;
        const owner = { epoch: 1, isCurrent: (epoch) => epoch === owner.epoch };
        const env = {
            runtimeLoader: f.loader,
            menuRequestSerial: 0,
            pwaSessionState: "menu",
            root: {},
            app: {},
            ownership: owner,
            getOwnership: () => owner,
            sessionCleanup: { safe: true },
            refreshOwnedSettings() {},
            applyApplicationAudioPreferences() {},
            renderLoading() {},
            showBoot() {},
            renderBoot() {},
            registerStickvaniaServiceWorker: async () => {},
            hasPotentialSavedGameState: () => false,
            isRuntimePreparationAbort: (e) => e.name === "AbortError",
            ReloadRequiredError: f.helper.ReloadRequiredError,
            console: { error() {}, warn() {} },
            destroyGame() {
                f.cancel();
                this.menuRequestSerial++;
                return true;
            },
            showLoadError(...args) {
                assert.equal(args.at(-1), "Reload");
                recovery++;
            },
            renderLoadError(error) {
                assert.ok(error instanceof f.helper.ReloadRequiredError);
                recovery++;
            },
            renderBootLoadError() {
                assert.fail("loader unexpectedly failed");
            }
        };
        const render = () => {
            renders++;
            if (stale) {
                owner.epoch++;
                (jackal ? subject : env).pwaSessionState = "running";
            }
            throw new Error("menu binding failed");
        };
        Object.assign(env, { renderMenu: render, renderRootMenu: render, renderMenuUi: render });
        const path = jackal ? "pwa/src/app/JackalWebApp.ts" : stickvania ? "pwa/src/main.ts" : "pwa/src/app/main.ts";
        const method = jackal ? "showMenu" : "startPwaMenu";
        subject = shellSubject(path, [method], env, jackal ? "JackalWebApp" : null);
        subject[method]();
        await flush();
        assert.equal(renders, 1);
        assert.equal(recovery, stale ? 0 : 1);
        if (stale) assert.equal((jackal ? subject : env).pwaSessionState, "running");
    });
}
if (jackal)
    test("actual showMenu reacquisition drains old boot and publishes newest menu", async () => {
        const f = fixture();
        let renders = 0;
        const owner = { epoch: 1, isCurrent: (epoch) => epoch === owner.epoch };
        const subject = shellSubject(
            "pwa/src/app/JackalWebApp.ts",
            ["showMenu"],
            {
                getOwnership: () => owner,
                refreshOwnedSettings() {},
                menuRequestSerial: 0,
                runtimeLoader: f.loader,
                destroyGame() {
                    f.cancel();
                    this.menuRequestSerial++;
                    return true;
                },
                renderLoading() {},
                renderMenu() {
                    renders++;
                },
                hasPotentialSavedGameState: () => false,
                root: {},
                isRuntimePreparationAbort: (error) => error.name === "AbortError",
                ReloadRequiredError: f.helper.ReloadRequiredError,
                showLoadError() {
                    assert.fail("healthy reacquisition must reach menu");
                }
            },
            "JackalWebApp"
        );
        subject.showMenu();
        owner.epoch++;
        subject.showMenu();
        await flush();
        assert.equal(subject.pwaSessionState, "menu");
        assert.equal(renders, 1);
        assert.ok(f.loader.preparedRuntime);
    });

for (let wait = 1; wait <= (stickvania ? 2 : 3); wait++) {
    for (const retire of [true, false]) {
        test("real candidate wait " + wait + (retire ? " cancels on retirement" : " times out only while current"), async () => {
            const f = fixture();
            const lifetime = new AbortController();
            let current = true,
                waits = 0,
                accepted = 0,
                terminal = 0;
            const cleanup = {
                safe: true,
                run(...steps) {
                    for (const step of steps) {
                        try {
                            step();
                        } catch {
                            this.safe = false;
                        }
                    }
                    return this.safe;
                }
            };
            const env = {
                game: null,
                container: null,
                activeBufferedGame: null,
                activeScalableGame: null,
                activeSessionGeneration: 0,
                sessionCleanup: cleanup,
                isStartingGameSession: () => current && cleanup.safe,
                isCurrentGameSession: () => current && cleanup.safe,
                viewport: { gameHost: {}, attach() {}, getResponsiveDisplayMode: () => ({ width: 800, height: 600 }) },
                sessionMapping: {},
                preferences: {},
                scalingPreference: "smooth",
                preferredHardMode: false,
                HIGH_DPI_ENABLED: true,
                MAX_DEVICE_PIXEL_RATIO: 2,
                GAME_DISPLAY_WIDTH: 800,
                GAME_DISPLAY_HEIGHT: 600,
                bufferedScalingModeForPreference() {},
                applyDisplayModePreference() {},
                getRumbleManager: () => ({}),
                handleGamePauseStateChanged() {},
                persistence: {
                    accept() {
                        accepted++;
                    }
                },
                showCleanupFailure() {
                    terminal++;
                },
                destroyGame() {
                    terminal++;
                    return false;
                },
                disposeStaleLaunch() {},
                initializeWithDeadline(operation, ownerCleanup, owner) {
                    assert.equal(owner.signal, lifetime.signal);
                    assert.equal(owner.isCurrent(), true);
                    return f.helper.initializeWithDeadline(operation, ownerCleanup, owner);
                }
            };
            const next = () => (++waits === wait ? new Promise(() => {}) : Promise.resolve());
            class Main {
                buttonMapping = { copyFrom() {} };
                reserveBrowserRuntime() {}
                setInputMappingChangedHandler() {}
                setDifficultyChangedHandler() {}
                disposeBrowserRuntime() {}
                invalidateBrowserLifetime() {}
            }
            class Buffered {
                setScalingPreference() {}
            }
            class Container {
                getBrowserLifetimeSignal() {
                    return lifetime.signal;
                }
                setPreserveAudioCacheOnDestroy() {}
                setLoopSuspended() {}
                getInput() {
                    return { pause() {} };
                }
                setHighDpiEnabled() {}
                setMaxDevicePixelRatio() {}
                setGraphicsLifecycleHandler() {}
                setAlwaysRender() {}
                setVSync() {}
                setSmoothDeltas() {}
                setShowFPS() {}
                setClearEachFrame() {}
                setDisplayMode() {
                    return next();
                }
                start() {
                    return next();
                }
            }
            const ResourceLoader = { waitForAll: next };
            env.ResourceLoader = ResourceLoader;
            const runtime = {
                Main,
                StickvaniaBufferedGame: Buffered,
                ScalableGame2: Buffered,
                slick: { AppGameContainer: Container, BufferedScalableGame: Buffered, ResourceLoader }
            };
            const file = jackal ? "pwa/src/app/JackalWebApp.ts" : stickvania ? "pwa/src/main.ts" : "pwa/src/app/main.ts";
            const method = jackal || stickvania ? "launchPreparedGame" : "mountGame";
            const subject = shellSubject(file, [method], env, jackal ? "JackalWebApp" : null);
            const pending = subject[method](runtime, false, 7, {}, {});
            const rejected = assert.rejects(pending, retire ? { name: "AbortError" } : f.helper.ReloadRequiredError);
            await flush();
            assert.equal(waits, wait);
            const state = jackal ? subject : env;
            const replacement = {};
            if (retire) {
                current = false;
                state.game = replacement;
                state.container = replacement;
                lifetime.abort();
            }
            await f.expire(120000);
            await rejected;
            assert.equal(cleanup.safe, retire);
            assert.equal(accepted, 0);
            assert.equal(terminal, retire ? 0 : 1);
            if (retire) {
                assert.equal(state.game, replacement);
                assert.equal(state.container, replacement);
            }
        });
    }
}
