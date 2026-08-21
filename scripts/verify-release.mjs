import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { inflateRawSync } from "node:zlib";
import {
    assertSecretAbsentFromTrackedFiles,
    createCacheIdentity,
    getHmacFingerprint,
    readSelectedHmacKey,
    SYNTHETIC_RELEASE_HMAC_KEY_HEX
} from "./hmac-config.mjs";
import { distDir, readVersion, rootDir, spawnGit } from "./build-utils.mjs";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const target = process.env.MSPACMAN_RELEASE_VERIFY_TARGET ?? readOption("target", "full");
const keySource = readOption("key-source", "env");
const validTargets = new Set(["pwa", "web", "desktop", "full"]);
assert.ok(validTargets.has(target), `Unknown release verification target: ${target}`);
const hmacKeyHex = readSelectedHmacKey(keySource);
const sourceVersion = readVersion();
const releaseMetadata = target === "web" || target === "full" ? readReleaseMetadataIfAvailable() : null;
const version = readVerificationVersion(sourceVersion, releaseMetadata);
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
    verifyReleaseMetadata();
}

if (target === "desktop" || target === "full") {
    verifyDesktopRelease();
}

if (target === "web" || target === "full") {
    verifySourceRelease();
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
    const thirdPartyNoticesPath = join(pwaDistDir, "THIRD_PARTY_NOTICES.txt");
    const serviceWorker = readFileSync(join(pwaDistDir, "sw.js"), "utf8");
    assert.ok(
        serviceWorker.includes(`const VERSION = ${JSON.stringify(cacheIdentity)};`),
        "Service worker VERSION must include the version, build stamp, and HMAC fingerprint."
    );
    assert.equal(serviceWorker.includes(hmacKeyHex), false, "Service worker must not contain the full HMAC key.");
    assert.ok(existsSync(thirdPartyNoticesPath), "PWA release output must include THIRD_PARTY_NOTICES.txt.");
    assert.equal(
        readFileSync(thirdPartyNoticesPath, "utf8"),
        readFileSync(join(rootDir, "THIRD_PARTY_NOTICES.md"), "utf8"),
        "PWA third-party notices must be copied from the canonical root notice file."
    );

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
    assert.ok(
        aboutIndex.includes(`downloads/ms-pac-man-2010-js-source.zip?v=${encodeURIComponent(version.buildStamp)}`),
        "About page must link to the generated source archive."
    );
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
    assert.ok(zipEntries.includes(`${distributionName}/LICENSE`), "Desktop release ZIP must contain the project LICENSE.");
    assert.ok(zipEntries.includes(`${distributionName}/THIRD_PARTY_NOTICES.md`), "Desktop release ZIP must contain third-party notices.");
    assert.ok(zipEntries.includes(`${distributionName}/RUNTIME_DEPENDENCIES.md`), "Desktop release ZIP must contain runtime dependency notes.");
    for (const licenseEntry of [
        "licenses/README.md",
        "licenses/APACHE-2.0.txt",
        "licenses/GNU-LIBRARY-GPL-2.0.txt",
        "licenses/JINPUT-BSD.txt",
        "licenses/JORBIS-JOGG-LGPL-NOTICE.txt",
        "licenses/LWJGL-2-BSD.txt",
        "licenses/OPENAL-SOFT-LGPL-NOTICE.txt",
        "licenses/SLICK2D-BSD-3-CLAUSE.txt"
    ]) {
        assert.ok(zipEntries.includes(`${distributionName}/${licenseEntry}`), `Desktop release ZIP must contain ${licenseEntry}.`);
    }
    assert.equal(
        zipEntries.some((entry) => entry.split("/").includes(".release-secrets")),
        false,
        "Desktop release ZIP must not contain .release-secrets."
    );
}

function verifyReleaseMetadata() {
    const releaseMetadataPath = join(distDir, "release.json");
    assert.ok(existsSync(releaseMetadataPath), "Release output must include dist/release.json.");
    const metadataText = readFileSync(releaseMetadataPath, "utf8");
    const metadata = JSON.parse(metadataText);
    assert.equal(metadata.version, sourceVersion.version, "release.json version must match version.json.");
    assert.equal(metadata.buildStamp, version.buildStamp, "release.json buildStamp must match the verified release build stamp.");
    assert.equal(metadata.gitCommit, readExpectedGitCommit(), "release.json must record the exact pre-build Git commit.");
    assert.ok(["clean", "unchecked"].includes(metadata.gitTreeState), "release.json must record the pre-build Git tree state.");
    assert.equal(metadata.source?.gitCommit, metadata.gitCommit, "release.json source commit must match the top-level Git commit.");
    assert.equal(metadata.source?.gitTreeState, metadata.gitTreeState, "release.json source tree state must match the top-level Git tree state.");
    assert.equal(metadata.source?.archiveIncludesCommittedSourceOnly, true, "release.json must record committed-source-only source archives.");
    assert.equal(metadata.hmacKeyFingerprint, fingerprint, "release.json must include the selected HMAC fingerprint.");
    assert.equal(metadataText.includes(hmacKeyHex), false, "release.json must not contain the full HMAC key.");
    assert.equal(metadata.deployment?.pwaBase, "./", "release.json must record the relocatable PWA base.");
    assert.equal(metadata.deployment?.scoreApiUrl, "/api/ms-pac-man-2010/scores", "release.json must record the fixed score API path.");
    if (metadata.pwa !== null) {
        assert.equal(metadata.pwa.serviceWorkerVersion, cacheIdentity, "release.json must record the embedded PWA service-worker version.");
    }
}

function verifySourceRelease() {
    const downloadsDir = join(distDir, "downloads");
    const stableSourcePath = join(downloadsDir, "ms-pac-man-2010-js-source.zip");
    const versionedSourcePath = join(downloadsDir, `ms-pac-man-2010-js-source-${version.version}.zip`);
    assert.ok(existsSync(stableSourcePath), "Release output must include the stable source archive.");
    assert.ok(existsSync(versionedSourcePath), "Release output must include the versioned source archive.");

    const archiveRoot = `ms-pac-man-2010-js-source-${version.version}/`;
    const entries = listArchiveEntries(stableSourcePath);
    for (const requiredEntry of [
        `${archiveRoot}LICENSE`,
        `${archiveRoot}THIRD_PARTY_NOTICES.md`,
        `${archiveRoot}package.json`,
        `${archiveRoot}version.json`,
        `${archiveRoot}desktop/src/mspacman/Main.java`,
        `${archiveRoot}pwa/src/app/BrowserStorageKeys.ts`,
        `${archiveRoot}pwa/src/app/main.ts`
    ]) {
        assert.ok(entries.includes(requiredEntry), `Source archive is missing ${requiredEntry}.`);
    }
    assert.equal(
        entries.some((entry) => entry.split("/").includes(".release-secrets")),
        false,
        "Source archive must not contain .release-secrets."
    );
    assert.equal(
        entries.some((entry) => entry.startsWith(`${archiveRoot}dist/`)),
        false,
        "Source archive must not contain dist/."
    );
    assertArchiveDoesNotContainSecret(stableSourcePath, hmacKeyHex);
    assertSourceArchiveMatchesGitCommit(stableSourcePath, archiveRoot, readExpectedGitCommit());
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
    return readZipEntries(archivePath).map((entry) => entry.name);
}

function assertArchiveDoesNotContainSecret(archivePath, secret) {
    if (secret === SYNTHETIC_RELEASE_HMAC_KEY_HEX) {
        return;
    }

    const archive = readFileSync(archivePath);
    const needle = Buffer.from(secret, "utf8");
    for (const entry of readZipEntriesFromBuffer(archive)) {
        if (entry.name.endsWith("/")) {
            continue;
        }
        assert.equal(readZipEntryData(archive, entry).includes(needle), false, `Source archive contains the selected HMAC key: ${entry.name}`);
    }
}

function assertSourceArchiveMatchesGitCommit(archivePath, archiveRoot, gitCommit) {
    const tempDir = mkdtempSync(join(tmpdir(), "mspacman-source-archive-"));
    const expectedArchivePath = join(tempDir, "expected-source.zip");
    try {
        spawnGit(["archive", "--format=zip", `--prefix=${archiveRoot}`, `--output=${expectedArchivePath}`, gitCommit]);
        assert.equal(sha256File(archivePath), sha256File(expectedArchivePath), "Source archive must match git archive output for release.json gitCommit.");
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

function readVerificationVersion(sourceVersion, metadata) {
    if (metadata === null) {
        return sourceVersion;
    }
    assert.equal(metadata.version, sourceVersion.version, "release.json version must match source version.");
    assert.equal(typeof metadata.buildStamp, "string", "release.json buildStamp must be a string.");
    return {
        ...sourceVersion,
        buildStamp: metadata.buildStamp
    };
}

function readReleaseMetadataIfAvailable() {
    const releaseMetadataPath = join(distDir, "release.json");
    if (!existsSync(releaseMetadataPath)) {
        return null;
    }
    return JSON.parse(readFileSync(releaseMetadataPath, "utf8"));
}

function readExpectedGitCommit() {
    const expected = process.env.MSPACMAN_RELEASE_GIT_COMMIT;
    if (expected !== undefined && expected !== "") {
        return expected;
    }
    assert.ok(releaseMetadata !== null, "Release metadata is required to infer the expected Git commit.");
    return releaseMetadata.gitCommit;
}

function readZipEntries(archivePath) {
    return readZipEntriesFromBuffer(readFileSync(archivePath));
}

function readZipEntriesFromBuffer(archive) {
    const endOffset = findEndOfCentralDirectory(archive);
    const entryCount = archive.readUInt16LE(endOffset + 10);
    let offset = archive.readUInt32LE(endOffset + 16);
    const entries = [];
    for (let i = 0; i < entryCount; i++) {
        assert.equal(archive.readUInt32LE(offset), 0x02014b50, "Malformed ZIP central directory.");
        const compressionMethod = archive.readUInt16LE(offset + 10);
        const compressedSize = archive.readUInt32LE(offset + 20);
        const uncompressedSize = archive.readUInt32LE(offset + 24);
        const nameLength = archive.readUInt16LE(offset + 28);
        const extraLength = archive.readUInt16LE(offset + 30);
        const commentLength = archive.readUInt16LE(offset + 32);
        const localHeaderOffset = archive.readUInt32LE(offset + 42);
        const name = archive.toString("utf8", offset + 46, offset + 46 + nameLength);
        entries.push({
            compressedSize,
            compressionMethod,
            localHeaderOffset,
            name,
            uncompressedSize
        });
        offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}

function readZipEntryData(archive, entry) {
    const offset = entry.localHeaderOffset;
    assert.equal(archive.readUInt32LE(offset), 0x04034b50, "Malformed ZIP local file header.");
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + nameLength + extraLength;
    const data = archive.subarray(dataStart, dataStart + entry.compressedSize);
    switch (entry.compressionMethod) {
        case 0:
            assert.equal(data.length, entry.uncompressedSize, `Stored ZIP entry has an unexpected size: ${entry.name}`);
            return data;
        case 8:
            return inflateRawSync(data);
        default:
            throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod} for ${entry.name}.`);
    }
}

function findEndOfCentralDirectory(archive) {
    const minimumOffset = Math.max(0, archive.length - 65557);
    for (let offset = archive.length - 22; offset >= minimumOffset; offset--) {
        if (archive.readUInt32LE(offset) === 0x06054b50) {
            return offset;
        }
    }
    throw new Error("Could not find ZIP end-of-central-directory record.");
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
