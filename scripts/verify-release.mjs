import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
    assertSecretAbsentFromTrackedFiles,
    createCacheIdentity,
    getHmacFingerprint,
    readSelectedHmacKey,
    SYNTHETIC_RELEASE_HMAC_KEY_HEX
} from "./hmac-config.mjs";
import { distDir, readVersion, rootDir } from "./build-utils.mjs";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const target = process.env.MSPACMAN_RELEASE_VERIFY_TARGET ?? readOption("target", "full");
const keySource = readOption("key-source", "env");
const validTargets = new Set(["pwa", "web", "desktop", "full"]);
assert.ok(validTargets.has(target), `Unknown release verification target: ${target}`);
const hmacKeyHex = readSelectedHmacKey(keySource);
const version = readVersion();
const cacheIdentity = createCacheIdentity(version, hmacKeyHex);
const fingerprint = getHmacFingerprint(hmacKeyHex);
const verifierEnv = {
    ...process.env,
    MSPACMAN_CACHE_VERSION: cacheIdentity,
    MSPACMAN_HMAC_KEY_HEX: hmacKeyHex
};
const forbiddenDeploymentRootPatterns = [
    {
        label: "/pwa/",
        pattern: /(^|[^.])\/pwa\//
    },
    {
        label: "/mspacman2010/",
        pattern: /\/mspacman2010\//
    },
    {
        label: "/ms-pac-man-2010/",
        pattern: /\/ms-pac-man-2010\//
    },
    {
        label: "/ms-pac-man-2010-staging/",
        pattern: /\/ms-pac-man-2010-staging\//
    }
];
const runtimeTextExtensions = new Set([".css", ".html", ".js", ".json", ".svg", ".txt", ".webmanifest", ".xml"]);

verifyDistDoesNotContainReleaseSecrets();

if (target === "pwa" || target === "web" || target === "full") {
    verifyPwaRelease();
}

if (target === "web" || target === "full") {
    verifyAboutRelease();
}

if (target === "desktop" || target === "full") {
    verifyDesktopRelease();
}

if (target === "web" || target === "full") {
    verifyReleaseChecksumManifest();
    verifyGeneratedRuntimeDoesNotContainHardcodedDeploymentRoots(distDir);
}

await verifyTrackedSourceDoesNotContainSelectedKey();
console.log(`Release artifacts verified for target ${target} with key fingerprint ${fingerprint}.`);

function verifyPwaRelease() {
    runNpmScript("verify:pwa-build");

    const pwaDistDir = join(distDir, "pwa");
    const serviceWorker = readFileSync(join(pwaDistDir, "sw.js"), "utf8");
    assert.ok(
        serviceWorker.includes(`const VERSION = ${JSON.stringify(cacheIdentity)};`),
        "Service worker VERSION must include the version, build stamp, and HMAC fingerprint."
    );
    assert.equal(serviceWorker.includes(hmacKeyHex), false, "Service worker must not contain the full HMAC key.");

    const sourceMaps = listFiles(pwaDistDir).filter((path) => path.endsWith(".map"));
    assert.deepEqual(sourceMaps, [], "Release PWA output must not contain source maps.");

    const builtJsFiles = listFiles(join(pwaDistDir, "assets")).filter((path) => path.endsWith(".js"));
    assert.ok(builtJsFiles.length > 0, "Release PWA output must contain built JavaScript assets.");
    assert.ok(
        builtJsFiles.some((path) => readFileSync(path, "utf8").includes(hmacKeyHex)),
        "Release PWA JavaScript must embed the selected HMAC key."
    );
    verifyGeneratedRuntimeDoesNotContainHardcodedDeploymentRoots(pwaDistDir);
}

function verifyAboutRelease() {
    const aboutIndex = readFileSync(join(distDir, "index.html"), "utf8");
    assert.ok(aboutIndex.includes(`pwa/?v=${encodeURIComponent(cacheIdentity)}`), "About page Play link must use the selected release cache identity.");
}

function verifyDesktopRelease() {
    runNpmScript("test:desktop-high-score");

    const desktopTargetDir = join(rootDir, "desktop", "target");
    const distributionName = "ms-pac-man-2010-desktop";
    const stableJarPath = join(desktopTargetDir, `${distributionName}.jar`);
    const versionedJarPath = join(desktopTargetDir, `${distributionName}-${version.version}.jar`);
    const versionedZipPath = join(desktopTargetDir, `${distributionName}-${version.version}.zip`);

    verifyJarReleaseProperties(stableJarPath);
    verifyJarReleaseProperties(versionedJarPath);

    const zipEntries = listArchiveEntries(versionedZipPath);
    assert.ok(zipEntries.includes(`${distributionName}/${distributionName}.jar`), "Desktop release ZIP must contain the runnable desktop JAR.");
    assert.equal(
        zipEntries.some((entry) => entry.split("/").includes(".release-secrets")),
        false,
        "Desktop release ZIP must not contain .release-secrets."
    );
}

function verifyJarReleaseProperties(jarPath) {
    const tempDir = mkdtempSync(join(tmpdir(), "mspacman-release-"));
    try {
        run("jar", ["xf", jarPath, "mspacman/high-score-release.properties"], tempDir);
        const properties = readJavaProperties(join(tempDir, "mspacman", "high-score-release.properties"));
        assert.equal(properties.hmacKeyHex, hmacKeyHex, "Desktop JAR must embed the selected HMAC key.");
        assert.equal(properties.hmacKeyFingerprint, fingerprint, "Desktop JAR must embed the selected HMAC fingerprint.");
        assert.equal(properties.buildStamp, version.buildStamp, "Desktop JAR must embed the current build stamp.");
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

function verifyDistDoesNotContainReleaseSecrets() {
    if (!existsSync(distDir)) {
        return;
    }
    for (const path of listFiles(distDir)) {
        assert.equal(relative(distDir, path).split(/[\\/]/).includes(".release-secrets"), false, "Release secrets must not be copied into dist.");
    }
}

function verifyReleaseChecksumManifest() {
    const checksumManifestPath = join(distDir, "checksums.sha256");
    assert.ok(existsSync(checksumManifestPath), "Release output must include dist/checksums.sha256.");

    const expected = new Map();
    for (const path of listFiles(distDir)) {
        const relativePath = relative(distDir, path).replaceAll("\\", "/");
        if (relativePath !== "checksums.sha256") {
            expected.set(relativePath, sha256File(path));
        }
    }

    const actual = new Map();
    for (const line of readFileSync(checksumManifestPath, "utf8").split(/\r?\n/)) {
        if (line === "") {
            continue;
        }
        const match = /^([0-9a-f]{64})[ ]{2}(.+)$/.exec(line);
        assert.ok(match !== null && match[1] !== undefined && match[2] !== undefined, `Malformed checksum manifest line: ${line}`);
        assert.equal(actual.has(match[2]), false, `Duplicate checksum manifest entry: ${match[2]}`);
        actual.set(match[2], match[1]);
    }

    assert.deepEqual(
        [...actual.keys()].sort((a, b) => a.localeCompare(b)),
        [...expected.keys()].sort((a, b) => a.localeCompare(b))
    );
    for (const [path, hash] of expected) {
        assert.equal(actual.get(path), hash, `Checksum mismatch for ${path}.`);
    }
}

function sha256File(path) {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function verifyGeneratedRuntimeDoesNotContainHardcodedDeploymentRoots(root) {
    if (!existsSync(root)) {
        return;
    }
    for (const path of listFiles(root)) {
        if (!shouldScanRuntimeTextFile(path)) {
            continue;
        }
        const content = readFileSync(path, "utf8").replaceAll("/api/ms-pac-man-2010/", "");
        for (const { label, pattern } of forbiddenDeploymentRootPatterns) {
            const match = pattern.exec(content);
            assert.equal(match, null, `Generated runtime file contains hard-coded deployment root ${label}: ${relative(rootDir, path)}`);
        }
    }
}

function shouldScanRuntimeTextFile(path) {
    const dot = path.lastIndexOf(".");
    return dot >= 0 && runtimeTextExtensions.has(path.slice(dot).toLowerCase());
}

async function verifyTrackedSourceDoesNotContainSelectedKey() {
    if (hmacKeyHex === SYNTHETIC_RELEASE_HMAC_KEY_HEX) {
        return;
    }
    await assertSecretAbsentFromTrackedFiles(hmacKeyHex);
}

function listArchiveEntries(archivePath) {
    const result = spawnSync("jar", ["tf", archivePath], {
        cwd: rootDir,
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true
    });
    if (result.status !== 0 || result.error) {
        throw result.error ?? new Error(`Unable to list archive: ${archivePath}`);
    }
    return result.stdout.split(/\r?\n/).filter(Boolean);
}

function readJavaProperties(path) {
    const properties = {};
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith("#")) {
            continue;
        }
        const equals = trimmed.indexOf("=");
        assert.ok(equals > 0, `Malformed Java properties line: ${trimmed}`);
        properties[trimmed.slice(0, equals)] = trimmed.slice(equals + 1);
    }
    return properties;
}

function listFiles(dir) {
    if (!existsSync(dir)) {
        return [];
    }
    const files = [];
    collectFiles(dir, files);
    return files;
}

function collectFiles(dir, files) {
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
            collectFiles(path, files);
        } else {
            files.push(path);
        }
    }
}

function runNpmScript(scriptName) {
    const result =
        process.platform === "win32"
            ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `${npmCommand} run ${scriptName}`], {
                  cwd: rootDir,
                  env: verifierEnv,
                  stdio: "inherit",
                  windowsHide: true
              })
            : spawnSync(npmCommand, ["run", scriptName], {
                  cwd: rootDir,
                  env: verifierEnv,
                  stdio: "inherit",
                  windowsHide: true
              });
    if (result.status !== 0 || result.error) {
        throw result.error ?? new Error(`npm run ${scriptName} failed.`);
    }
}

function run(command, args, cwd) {
    const result = spawnSync(command, args, {
        cwd,
        stdio: "inherit",
        windowsHide: true
    });
    if (result.status !== 0 || result.error) {
        throw result.error ?? new Error(`${command} failed.`);
    }
}

function readOption(name, fallback) {
    const prefix = `--${name}=`;
    const match = process.argv.find((arg) => arg.startsWith(prefix));
    return match === undefined ? fallback : match.slice(prefix.length);
}
