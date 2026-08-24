import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { rootDir, versionPath } from "./build-utils.mjs";
import { SYNTHETIC_RELEASE_HMAC_KEY_HEX } from "./hmac-config.mjs";

const originalVersionJson = readFileSync(versionPath, "utf8");
const originalVersion = JSON.parse(originalVersionJson);
const tempComponentsDir = mkdtempSync(join(tmpdir(), "mspacman-pwa-unsigned-components-"));
const unsignedPwaDir = join(tempComponentsDir, "pwa-unsigned", "pwa");

try {
    const first = runUnsignedPwaBuild();
    const second = runUnsignedPwaBuild();
    assert.notEqual(first.workerVersion, second.workerVersion, "Unsigned PWA builds must stamp distinct service-worker VERSION values.");
    assert.notEqual(first.buildStamp, second.buildStamp, "Unsigned PWA builds must stamp distinct buildStamp values.");
    assert.equal(first.workerVersion, `${originalVersion.version}-${first.buildStamp}-unsigned`);
    assert.equal(second.workerVersion, `${originalVersion.version}-${second.buildStamp}-unsigned`);
    assert.equal(readFileSync(versionPath, "utf8"), originalVersionJson, "Unsigned PWA builds must restore tracked version.json.");
    console.log("ok - unsigned PWA builds stamp distinct service-worker versions and restore version.json");
} finally {
    writeOriginalVersionJson();
    rmSync(tempComponentsDir, { recursive: true, force: true });
}

function runUnsignedPwaBuild() {
    const beforeVersionJson = readFileSync(versionPath, "utf8");
    const beforeGitStatus = readGitStatus();
    const result = spawnSync(process.execPath, ["scripts/build-pwa-unsigned.mjs"], {
        cwd: rootDir,
        encoding: "utf8",
        env: {
            ...process.env,
            MSPACMAN_ENABLE_TEST_PATH_OVERRIDES: "1",
            MSPACMAN_CACHE_VERSION: "polluted-cache-version",
            MSPACMAN_HMAC_KEY_HEX: SYNTHETIC_RELEASE_HMAC_KEY_HEX,
            MSPACMAN_TEST_RELEASE_COMPONENTS_DIR: tempComponentsDir
        },
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true
    });
    assert.equal(
        result.status,
        0,
        ["Unsigned PWA build failed.", "stdout:", result.stdout, "stderr:", result.stderr, "error:", result.error?.message ?? ""].join("\n")
    );
    assert.equal(readFileSync(versionPath, "utf8"), beforeVersionJson, "Unsigned PWA build must restore version.json after success.");
    assert.equal(readGitStatus(), beforeGitStatus, "Unsigned PWA build must leave source Git status unchanged.");

    const serviceWorkerPath = join(unsignedPwaDir, "sw.js");
    assert.equal(existsSync(serviceWorkerPath), true, "Unsigned PWA build must generate pwa/sw.js.");
    const workerVersion = readEmbeddedServiceWorkerVersion(readFileSync(serviceWorkerPath, "utf8"));
    return {
        buildStamp: readBuildStamp(workerVersion),
        workerVersion
    };
}

function readEmbeddedServiceWorkerVersion(serviceWorker) {
    const match = /^const VERSION = ("[^"]+");$/m.exec(serviceWorker);
    assert.ok(match !== null && match[1] !== undefined, "Built service worker does not contain an embedded VERSION string.");
    return JSON.parse(match[1]);
}

function readBuildStamp(workerVersion) {
    const prefix = `${originalVersion.version}-`;
    const suffix = "-unsigned";
    assert.equal(workerVersion.startsWith(prefix), true, "Worker version must begin with the app version.");
    assert.equal(workerVersion.endsWith(suffix), true, "Worker version must end with unsigned suffix.");
    return workerVersion.slice(prefix.length, workerVersion.length - suffix.length);
}

function readGitStatus() {
    const result = spawnSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
        cwd: rootDir,
        encoding: "utf8",
        windowsHide: true
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
}

function writeOriginalVersionJson() {
    writeFileSync(versionPath, originalVersionJson);
}
