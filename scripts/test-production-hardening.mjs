import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(path, context) {
    const source = readFileSync(path, "utf8").replace(/(?<!typeof )import\(("[^"]+")\)/g, "loadModule($1)");
    context.exports = {};
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
    return context.exports;
}

test("first-run service worker readiness is bounded before runtime resource preload", () => {
    const registrar = readFileSync("pwa/src/app/ServiceWorkerRegistrar.ts", "utf8");
    const loader = readFileSync("pwa/src/app/RuntimeLoader.ts", "utf8");
    assert.match(registrar, /SERVICE_WORKER_STARTUP_TIMEOUT_MS = 3000/);
    assert.match(registrar, /navigator\.serviceWorker\.ready/);
    assert.match(registrar, /controllerchange/);
    assert.match(loader, /await waitForServiceWorkerStartupGrace\(\);/);
});

test("Windows desktop launcher tolerates paths containing parentheses", () => {
    const launcherPath = join("desktop", "run-windows.cmd");
    const source = readFileSync(launcherPath, "utf8");

    assert.doesNotMatch(source, /^\s*if\b[^\r\n]*\(\s*$/im, "Path-sensitive IF checks must not use CMD parenthesized command blocks");
    assert.match(source, /if not exist "%JAR_PATH%" set "JAR_PATH=%BASE_DIR%ms-pac-man-2010-desktop\.jar"/);
    assert.match(source, /if not exist "%NATIVE_PATH%" set "NATIVE_PATH=%BASE_DIR%natives\\windows"/);

    if (process.platform !== "win32") {
        return;
    }

    const instrumentedSource = source
        .replace("java --enable-native-access=ALL-UNNAMED -version >nul 2>nul", "ver >nul")
        .replace("java --sun-misc-unsafe-memory-access=allow -version >nul 2>nul", "ver >nul")
        .replace(
            'java %JAVA_COMPAT_ARGS% "-Dorg.lwjgl.librarypath=%NATIVE_PATH%" "-Dnet.java.games.input.librarypath=%NATIVE_PATH%" "-Djava.library.path=%NATIVE_PATH%" "-Djinput.useDefaultPlugin=false" "-Dnet.java.games.input.plugins=net.java.games.input.DirectAndRawInputEnvironmentPlugin" -jar "%JAR_PATH%"',
            '> "%MSPACMAN_TEST_JAVA_LOG%" echo JAR=%JAR_PATH%\n>> "%MSPACMAN_TEST_JAVA_LOG%" echo NATIVE=%NATIVE_PATH%'
        );
    assert.notEqual(instrumentedSource, source);
    assert.doesNotMatch(instrumentedSource, /^java\b/im, "Test launcher should replace Java invocations with deterministic local commands");

    const tempRoot = mkdtempSync(join(tmpdir(), "ms-pac-man-desktop (1) "));
    const installDir = join(tempRoot, "ms-pac-man-2010-desktop");
    const javaLogPath = join(tempRoot, "java-args.txt");
    try {
        mkdirSync(join(installDir, "natives", "windows"), { recursive: true });
        writeFileSync(join(installDir, "run-windows.cmd"), instrumentedSource);
        writeFileSync(join(installDir, "ms-pac-man-2010-desktop.jar"), "");

        const env = { ...process.env, MSPACMAN_TEST_JAVA_LOG: javaLogPath };
        const result = spawnSync("cmd.exe", ["/d", "/c", "run-windows.cmd"], {
            cwd: installDir,
            encoding: "utf8",
            env
        });
        assert.equal(
            result.status,
            0,
            `Windows launcher failed from a path containing parentheses.\nstdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}${result.error ? `\n${result.error.message}` : ""}`
        );

        const javaLog = readFileSync(javaLogPath, "utf8");
        assert.ok(javaLog.includes(`JAR=${join(installDir, "ms-pac-man-2010-desktop.jar")}`));
        assert.ok(javaLog.includes(`NATIVE=${join(installDir, "natives", "windows")}`));
    } finally {
        rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
});

test("failed import siblings remain observed until settlement", async () => {
    const { settleRequired } = await import("./persistence-test-loader.mjs").then((module) => module.loadTypeScript("pwa/src/app/PreparationDeadline.ts"));
    const controller = new AbortController();
    let finish;
    let exposed = false;
    const original = new Error("chunk missing");
    const sibling = new Promise((resolve) => {
        finish = resolve;
    });
    const pending = settleRequired([Promise.reject(original), sibling], controller).catch((error) => {
        exposed = true;
        throw error;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(controller.signal.aborted, true);
    assert.equal(exposed, false);
    finish({});
    await assert.rejects(pending, (error) => error === original);
});

test("oversized stored data is rejected on read but cannot block an authorized current save", () => {
    const { GAME_STATE_VERSION } = load("pwa/src/mspacman/persistence/GameStateSnapshot.ts", {});
    // This VM fixture tests overwrite authority with a mock serializer. Its objects
    // are cross-realm; real JSON-domain acceptance is tested by validator-repairs.
    const valuePolicy = { hasReasonableSnapshotValues: () => true };
    const text = JSON.stringify({ version: 999, payload: "x".repeat(1_000_001) });
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
            if (name.includes("SnapshotValuePolicy")) return valuePolicy;
            if (name.includes("BrowserPersistence"))
                return {
                    captureAndWriteSnapshot(_label, key, capture, validate, maxTextLength, isAuthorized) {
                        let snapshot;
                        try {
                            snapshot = capture();
                        } catch {
                            return { saved: false, reason: "capture-failed" };
                        }
                        if (!validate(snapshot)) return { saved: false, reason: "invalid-snapshot" };
                        const encoded = JSON.stringify(snapshot);
                        if (encoded.length > maxTextLength) return { saved: false, reason: "too-large" };
                        if (!isAuthorized()) return { saved: false, reason: "not-authorized" };
                        context.localStorage.setItem(key, encoded);
                        return { saved: true };
                    },
                    removePreference(_label, key, isAuthorized) {
                        if (!isAuthorized()) return false;
                        context.localStorage.removeItem(key);
                        return true;
                    }
                };
            if (name.includes("BrowserStorageKeys")) return { createBrowserStorageKeys: () => ({ gameState: "save" }) };
            if (name.includes("SnapshotLimits")) return { MAX_SNAPSHOT_TEXT_LENGTH: 1_000_000 };
            if (name.includes("Serializer"))
                return {
                    isValidSnapshotForLoadedResources: () => true,
                    MsPacManGameStateSerializer: class {
                        createSnapshot() {
                            return { version: GAME_STATE_VERSION, supported: true, marker: "current" };
                        }

                        isSupportedSnapshot(snapshot) {
                            return snapshot?.version === GAME_STATE_VERSION && snapshot?.supported === true;
                        }
                    }
                };
            return {};
        }
    };
    const { MsPacManGameStateStore } = load("pwa/src/mspacman/persistence/MsPacManGameStateStore.ts", context);
    const store = new MsPacManGameStateStore("test");
    assert.equal(store.hasValidSave(), false);
    assert.equal(stored, text);
    assert.deepEqual(
        store.save({ isStateSaveReady: () => true }, () => true),
        { saved: true }
    );
    assert.equal(JSON.parse(stored).version, GAME_STATE_VERSION);
    assert.notEqual(stored, text);
});
