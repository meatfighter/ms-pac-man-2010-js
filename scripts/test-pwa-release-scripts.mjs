import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { distDir, ensureDirectory, rootDir, versionPath } from "./build-utils.mjs";

const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
const originalVersionJson = readFileSync(versionPath, "utf8");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const syntheticEnv = {
    ...process.env,
    MSPACMAN_HMAC_KEY_HEX: "0".repeat(64)
};

try {
    assertReleaseScriptStructure();
    const first = runStandaloneReleasePwaBuild();
    const second = runStandaloneReleasePwaBuild();

    assert.notEqual(first.version.buildStamp, second.version.buildStamp, "Standalone release PWA builds must stamp a fresh buildStamp.");
    assert.notEqual(first.workerVersion, second.workerVersion, "Standalone release PWA builds must produce distinct service-worker VERSION values.");
    assert.equal(first.workerVersion, `${first.version.version}-${first.version.buildStamp}`);
    assert.equal(second.workerVersion, `${second.version.version}-${second.version.buildStamp}`);
    console.log("ok - standalone release PWA builds stamp distinct service-worker versions");
} finally {
    writeFileSync(versionPath, originalVersionJson);
    rmSync(distDir, { recursive: true, force: true });
    ensureDirectory(distDir);
}

function assertReleaseScriptStructure() {
    const { scripts } = packageJson;
    assert.equal(scripts["build:pwa"], "npm run build:pwa:release", "build:pwa must delegate to the release PWA build.");
    assert.equal(
        scripts["build:pwa:release"],
        "npm run stamp && npm run _build:pwa:release",
        "build:pwa:release must stamp exactly once before the internal release implementation."
    );
    assert.ok(scripts["_build:pwa:release"].includes("vite build --mode release"), "_build:pwa:release must perform the release-mode Vite build.");
    assert.equal(scripts["_build:pwa:release"].includes("npm run stamp"), false, "_build:pwa:release must not stamp internally.");
    assert.equal(scripts["build:web"].includes("npm run stamp"), false, "build:web must not stamp separately from build:pwa:release.");
    assert.equal(scripts["build"].includes("npm run stamp"), false, "build must not stamp separately from build:pwa:release.");
    assert.equal(scripts["build:web"].includes("npm run build:pwa:release"), true, "build:web must use the release PWA build.");
    assert.equal(scripts["build"].includes("npm run build:pwa:release"), true, "build must use the release PWA build.");
}

function runStandaloneReleasePwaBuild() {
    const result = spawnNpmRun("build:pwa:release", {
        cwd: rootDir,
        encoding: "utf8",
        env: syntheticEnv,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true
    });
    assert.equal(
        result.status,
        0,
        ["Standalone npm run build:pwa:release failed.", "stdout:", result.stdout, "stderr:", result.stderr, "error:", result.error?.message ?? ""].join("\n")
    );

    const version = JSON.parse(readFileSync(versionPath, "utf8"));
    const serviceWorkerPath = join(distDir, "pwa", "sw.js");
    assert.ok(existsSync(serviceWorkerPath), "Standalone release PWA build did not generate dist/pwa/sw.js.");
    const workerVersion = readEmbeddedServiceWorkerVersion(readFileSync(serviceWorkerPath, "utf8"));
    return {
        version,
        workerVersion
    };
}

function spawnNpmRun(scriptName, options) {
    if (process.platform === "win32") {
        return spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `${npmCommand} run ${scriptName}`], options);
    }
    return spawnSync(npmCommand, ["run", scriptName], options);
}

function readEmbeddedServiceWorkerVersion(serviceWorker) {
    const match = /^const VERSION = ("[^"]+");$/m.exec(serviceWorker);
    assert.ok(match !== null && match[1] !== undefined, "Built service worker does not contain an embedded VERSION string.");
    return JSON.parse(match[1]);
}
