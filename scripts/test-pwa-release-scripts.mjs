import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { rootDir, versionPath } from "./build-utils.mjs";
import { createCacheIdentity, SYNTHETIC_RELEASE_HMAC_KEY_HEX } from "./hmac-config.mjs";

const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
const originalVersionJson = readFileSync(versionPath, "utf8");
const tempRoot = mkdtempSync(join(tmpdir(), "mspacman-pwa-release-test-"));
const tempDistDir = join(tempRoot, "dist");
const syntheticEnv = {
    ...process.env,
    MSPACMAN_DIST_DIR: tempDistDir,
    MSPACMAN_HMAC_KEY_HEX: SYNTHETIC_RELEASE_HMAC_KEY_HEX
};

try {
    assertReleaseScriptStructure();
    const first = runStandaloneReleasePwaBuild();
    writeFileSync(join(tempDistDir, "preserved-web-shell.txt"), "preserve me\n");
    const second = runStandaloneReleasePwaBuild();

    assert.notEqual(first.version.buildStamp, second.version.buildStamp, "Standalone release PWA builds must stamp a fresh buildStamp.");
    assert.notEqual(first.workerVersion, second.workerVersion, "Standalone release PWA builds must produce distinct service-worker VERSION values.");
    assert.equal(first.workerVersion, createCacheIdentity(first.version, SYNTHETIC_RELEASE_HMAC_KEY_HEX));
    assert.equal(second.workerVersion, createCacheIdentity(second.version, SYNTHETIC_RELEASE_HMAC_KEY_HEX));
    assert.equal(existsSync(join(tempDistDir, "preserved-web-shell.txt")), true, "Standalone PWA release builds must not clean unrelated dist files.");
    console.log("ok - standalone release PWA builds stamp distinct service-worker versions");
} finally {
    writeFileSync(versionPath, originalVersionJson);
    rmSync(tempRoot, { recursive: true, force: true });
}

function assertReleaseScriptStructure() {
    const { scripts } = packageJson;
    assert.equal(scripts["build:pwa"], "npm run build:pwa:release", "build:pwa must delegate to the release PWA build.");
    assert.equal(
        scripts["build:pwa:release"],
        "node scripts/build-release.mjs --target=pwa --key-source=active",
        "build:pwa:release must use the release orchestrator with the active key."
    );
    assert.ok(scripts["_build:pwa:release"].includes("vite build --mode release"), "_build:pwa:release must perform the release-mode Vite build.");
    assert.equal(scripts["_build:pwa:release"].includes("npm run stamp"), false, "_build:pwa:release must not stamp internally.");
    assert.equal(scripts["build:web"], "npm run build:web:release", "build:web must delegate to the release web build.");
    assert.equal(
        scripts["build:web:release"],
        "node scripts/build-release.mjs --target=web --key-source=active",
        "build:web:release must use the release orchestrator with the active key."
    );
    assert.equal(
        scripts["build"],
        "node scripts/build-release.mjs --target=full --key-source=active",
        "build must use the release orchestrator with the active key."
    );
    assert.equal(scripts["release:provision"], "node scripts/release-provision.mjs", "release:provision must run the full provision workflow.");
    assert.equal(scripts["release:rotate-hmac"], "node scripts/release-rotate-hmac.mjs", "release:rotate-hmac must run the candidate rotation workflow.");
}

function runStandaloneReleasePwaBuild() {
    const result = spawnNodeScript("scripts/build-release.mjs", ["--target=pwa", "--key-source=env"], {
        cwd: rootDir,
        encoding: "utf8",
        env: syntheticEnv,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true
    });
    assert.equal(
        result.status,
        0,
        ["Standalone env-key release PWA build failed.", "stdout:", result.stdout, "stderr:", result.stderr, "error:", result.error?.message ?? ""].join("\n")
    );

    const version = JSON.parse(readFileSync(versionPath, "utf8"));
    const serviceWorkerPath = join(tempDistDir, "pwa", "sw.js");
    assert.ok(existsSync(serviceWorkerPath), "Standalone release PWA build did not generate dist/pwa/sw.js.");
    const workerVersion = readEmbeddedServiceWorkerVersion(readFileSync(serviceWorkerPath, "utf8"));
    return {
        version,
        workerVersion
    };
}

function spawnNodeScript(scriptName, args, options) {
    return spawnSync(process.execPath, [scriptName, ...args], options);
}

function readEmbeddedServiceWorkerVersion(serviceWorker) {
    const match = /^const VERSION = ("[^"]+");$/m.exec(serviceWorker);
    assert.ok(match !== null && match[1] !== undefined, "Built service worker does not contain an embedded VERSION string.");
    return JSON.parse(match[1]);
}
