import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { createHmacKeyHex, getHmacFingerprint, readKeyFile, SYNTHETIC_RELEASE_HMAC_KEY_HEX, writeKeyFile } from "./hmac-config.mjs";
import { rootDir } from "./build-utils.mjs";

const distributionName = "ms-pac-man-2010-desktop";
const EXECUTABLE_ZIP_ENTRIES = new Set([`${distributionName}/run-linux.sh`, `${distributionName}/run-macos.sh`]);
const CRC32_TABLE = createCrc32Table();
const originalGitStatus = readGitStatus(rootDir);
const candidateRoot = mkdtempSync(join(tmpdir(), "mspacman-release-finalizer-candidate-"));
const candidateTemplateDir = join(candidateRoot, "candidate");
const syntheticEnv = {
    ...process.env,
    MSPACMAN_DIST_DIR: candidateTemplateDir,
    MSPACMAN_HMAC_KEY_HEX: SYNTHETIC_RELEASE_HMAC_KEY_HEX
};

try {
    buildSyntheticFullCandidate();

    await runTest("valid complete candidate verifies after desktop target is deleted", () => {
        rmSync(join(rootDir, "desktop", "target"), { recursive: true, force: true });
        const result = verifyCandidate(candidateTemplateDir);
        assert.equal(result.status, 0, formatFailure("Expected candidate verification to succeed without desktop/target.", result));
    });

    await runTest("candidate Java ZIP with wrong embedded HMAC fails verification", () => {
        const candidateDir = copyCandidate("wrong-desktop-hmac");
        mutateDesktopZip(candidateDir, (distributionDir) => {
            const jarPath = join(distributionDir, `${distributionName}.jar`);
            const tempDir = mkdtempSync(join(tmpdir(), "mspacman-nested-jar-"));
            try {
                run("jar", ["xf", jarPath, "mspacman/high-score-release.properties"], tempDir);
                writeFileSync(
                    join(tempDir, "mspacman", "high-score-release.properties"),
                    [
                        `hmacKeyHex=${"f".repeat(64)}`,
                        `hmacKeyFingerprint=${getHmacFingerprint("f".repeat(64))}`,
                        `buildStamp=${readReleaseMetadata(candidateDir).buildStamp}`,
                        ""
                    ].join("\n")
                );
                run("jar", ["uf", jarPath, "mspacman/high-score-release.properties"], tempDir);
            } finally {
                rmSync(tempDir, { recursive: true, force: true });
            }
        });
        const result = verifyCandidate(candidateDir);
        assert.notEqual(result.status, 0, "Candidate with wrong embedded desktop HMAC should fail verification.");
        assertOutputIncludes(result, "must embed the selected HMAC key");
    });

    await runTest("candidate Java ZIP missing required license/source entry fails verification", () => {
        const candidateDir = copyCandidate("missing-desktop-license");
        mutateDesktopZip(candidateDir, (distributionDir) => {
            rmSync(join(distributionDir, "licenses", "README.md"), { force: true });
        });
        const result = verifyCandidate(candidateDir);
        assert.notEqual(result.status, 0, "Candidate missing a required desktop license entry should fail verification.");
        assertOutputIncludes(result, "licenses/README.md");
    });

    await runTest("candidate Java ZIP changed without checksum update fails verification", () => {
        const candidateDir = copyCandidate("checksum-mismatch");
        for (const zipPath of getDesktopZipPaths(candidateDir)) {
            appendFileSync(zipPath, Buffer.from([0x0a]));
        }
        const result = verifyCandidate(candidateDir);
        assert.notEqual(result.status, 0, "Candidate changed without checksum manifest update should fail verification.");
        assertOutputIncludes(result, "Checksum mismatch");
    });

    await runTest("finalize rejects candidate HMAC fingerprint mismatch without changing state", () => {
        withFinalizeFixture((fixture) => {
            const metadata = readReleaseMetadata(fixture.candidateDir);
            metadata.hmacKeyFingerprint = "badbadbadbad";
            writeReleaseMetadata(fixture.candidateDir, metadata);
            assertFinalizeFailsWithoutStateChange(fixture, "Candidate release fingerprint must match");
        });
    });

    await runTest("finalize rejects candidate Git commit mismatch without changing state", () => {
        withFinalizeFixture((fixture) => {
            const metadata = readReleaseMetadata(fixture.candidateDir);
            metadata.gitCommit = "0".repeat(40);
            metadata.source.gitCommit = metadata.gitCommit;
            writeReleaseMetadata(fixture.candidateDir, metadata);
            assertFinalizeFailsWithoutStateChange(fixture, "Candidate release commit must match");
        });
    });

    await runTest("finalize rejects candidate artifact verification failure without changing state", () => {
        withFinalizeFixture((fixture) => {
            rmSync(join(fixture.candidateDir, "downloads", `ms-pac-man-2010-desktop-${fixture.version}.zip`), { force: true });
            assertFinalizeFailsWithoutStateChange(fixture, "Desktop versioned release ZIP must exist");
        });
    });

    await runTest("finalize restores old dist and keys after injected key-promotion failure", () => {
        withFinalizeFixture((fixture) => {
            const beforeDist = snapshotDirectory(fixture.distDir);
            const beforeCandidate = snapshotDirectory(fixture.candidateDir);
            const beforeActive = readKeyFile(fixture.activePath, "Active HMAC key");
            const beforeNext = readKeyFile(fixture.nextPath, "Next HMAC key");
            const result = runFinalize(fixture, {
                MSPACMAN_TEST_FAIL_HMAC_PROMOTE_STAGE: "after-active-replace"
            });
            assert.notEqual(result.status, 0, "Injected HMAC promotion failure should fail finalization.");
            assertOutputIncludes(result, "Injected HMAC promotion failure");
            assert.deepEqual(snapshotDirectory(fixture.distDir), beforeDist, "Old canonical dist must be restored.");
            assert.deepEqual(snapshotDirectory(fixture.candidateDir), beforeCandidate, "Candidate directory must be restored.");
            assert.equal(readKeyFile(fixture.activePath, "Active HMAC key"), beforeActive, "Active key must be restored.");
            assert.equal(readKeyFile(fixture.nextPath, "Next HMAC key"), beforeNext, "Next key must be preserved.");
        });
    });

    await runTest("successful finalize promotes exact candidate bytes and staged next key", () => {
        withFinalizeFixture((fixture) => {
            rmSync(join(fixture.fixtureRoot, "desktop", "target"), { recursive: true, force: true });
            const beforeCandidate = snapshotDirectory(fixture.candidateDir);
            const beforeActive = readKeyFile(fixture.activePath, "Active HMAC key");
            const beforeNext = readKeyFile(fixture.nextPath, "Next HMAC key");
            const result = runFinalize(fixture);
            assert.equal(result.status, 0, formatFailure("Expected HMAC finalization to succeed.", result));
            assert.deepEqual(snapshotDirectory(fixture.distDir), beforeCandidate, "Canonical dist must become the exact candidate bytes.");
            assert.equal(readKeyFile(fixture.activePath, "Active HMAC key"), beforeNext, "Next key must become active.");
            assert.equal(readKeyFile(join(fixture.secretsDir, "ms-pac-man-2010-hmac.previous.hex"), "Previous HMAC key"), beforeActive);
            assert.equal(existsSync(fixture.nextPath), false, "Next key file must be removed after successful finalization.");
            assert.equal(existsSync(fixture.candidateDir), false, "Candidate directory must be removed after successful finalization.");
        });
    });
} finally {
    rmSync(candidateRoot, { recursive: true, force: true });
    assert.equal(readGitStatus(rootDir), originalGitStatus, "Release finalizer tests must restore the original Git status.");
}

function buildSyntheticFullCandidate() {
    const result = spawnNodeScript(rootDir, "scripts/build-release.mjs", syntheticEnv, ["--target=full", "--key-source=env"]);
    assert.equal(result.status, 0, formatFailure("Synthetic full release candidate build failed.", result));
}

function verifyCandidate(candidateDir) {
    return spawnNodeScript(
        rootDir,
        "scripts/verify-release.mjs",
        {
            ...process.env,
            MSPACMAN_DIST_DIR: candidateDir,
            MSPACMAN_HMAC_KEY_HEX: SYNTHETIC_RELEASE_HMAC_KEY_HEX,
            MSPACMAN_RELEASE_VERIFY_TARGET: "full"
        },
        ["--key-source=env"]
    );
}

function withFinalizeFixture(fn) {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "mspacman-finalize-fixture-"));
    const stateRoot = mkdtempSync(join(tmpdir(), "mspacman-finalize-state-"));
    try {
        copyWorkingSourceToFixture(fixtureRoot);
        runGit(fixtureRoot, ["init"]);
        runGit(fixtureRoot, ["add", "."]);
        runGit(fixtureRoot, ["-c", "user.name=Ms Pac-Man Release Test", "-c", "user.email=release-test@example.invalid", "commit", "-m", "fixture"]);

        const head = readGitHead(fixtureRoot);
        const secretsDir = join(stateRoot, "secrets");
        const candidateDir = join(stateRoot, "candidate");
        const distDir = join(stateRoot, "dist");
        const activePath = join(secretsDir, "ms-pac-man-2010-hmac.hex");
        const nextPath = join(secretsDir, "ms-pac-man-2010-hmac.next.hex");
        const activeKey = createDistinctActiveKey();
        writeKeyFile(activePath, activeKey);
        writeKeyFile(nextPath, SYNTHETIC_RELEASE_HMAC_KEY_HEX);
        cpSync(candidateTemplateDir, candidateDir, { recursive: true });
        mkdirSync(distDir, { recursive: true });
        writeFileSync(join(distDir, "old-dist-sentinel.txt"), "old canonical dist\n");
        prepareCandidateForFixture(fixtureRoot, candidateDir, head);
        fn({
            activePath,
            candidateDir,
            distDir,
            fixtureRoot,
            nextPath,
            secretsDir,
            version: readReleaseMetadata(candidateDir).version
        });
    } finally {
        rmSync(stateRoot, { recursive: true, force: true });
        rmSync(fixtureRoot, { recursive: true, force: true });
    }
}

function prepareCandidateForFixture(fixtureRoot, candidateDir, gitCommit) {
    const metadata = readReleaseMetadata(candidateDir);
    metadata.gitCommit = gitCommit;
    metadata.gitTreeState = "clean";
    metadata.source.gitCommit = gitCommit;
    metadata.source.gitTreeState = "clean";
    writeReleaseMetadata(candidateDir, metadata);
    const env = {
        ...process.env,
        MSPACMAN_DIST_DIR: candidateDir,
        MSPACMAN_RELEASE_GIT_COMMIT: gitCommit,
        MSPACMAN_RELEASE_GIT_TREE_STATE: "clean"
    };
    let result = spawnNodeScript(fixtureRoot, "scripts/write-source-archive.mjs", env);
    assert.equal(result.status, 0, formatFailure("Fixture source archive rewrite failed.", result));
    result = spawnNodeScript(fixtureRoot, "scripts/write-release-checksums.mjs", env);
    assert.equal(result.status, 0, formatFailure("Fixture checksum rewrite failed.", result));
}

function assertFinalizeFailsWithoutStateChange(fixture, expectedText) {
    const beforeDist = snapshotDirectory(fixture.distDir);
    const beforeCandidate = snapshotDirectory(fixture.candidateDir);
    const beforeActive = readKeyFile(fixture.activePath, "Active HMAC key");
    const beforeNext = readKeyFile(fixture.nextPath, "Next HMAC key");
    const result = runFinalize(fixture);
    assert.notEqual(result.status, 0, "Finalizer should reject the broken candidate.");
    assertOutputIncludes(result, expectedText);
    assert.deepEqual(snapshotDirectory(fixture.distDir), beforeDist, "Canonical dist must remain unchanged.");
    assert.deepEqual(snapshotDirectory(fixture.candidateDir), beforeCandidate, "Candidate directory must remain unchanged.");
    assert.equal(readKeyFile(fixture.activePath, "Active HMAC key"), beforeActive, "Active key must remain unchanged.");
    assert.equal(readKeyFile(fixture.nextPath, "Next HMAC key"), beforeNext, "Next key must remain unchanged.");
}

function runFinalize(fixture, extraEnv = {}) {
    return spawnNodeScript(
        fixture.fixtureRoot,
        "scripts/release-finalize-hmac.mjs",
        {
            ...process.env,
            ...extraEnv,
            MSPACMAN_DIST_DIR: fixture.distDir,
            MSPACMAN_HMAC_NEXT_CANDIDATE_DIR: fixture.candidateDir,
            MSPACMAN_RELEASE_SECRETS_DIR: fixture.secretsDir
        },
        []
    );
}

function copyCandidate(label) {
    const candidateDir = join(candidateRoot, label);
    rmSync(candidateDir, { recursive: true, force: true });
    cpSync(candidateTemplateDir, candidateDir, { recursive: true });
    return candidateDir;
}

function mutateDesktopZip(candidateDir, mutateFn) {
    const tempDir = mkdtempSync(join(tmpdir(), "mspacman-desktop-zip-"));
    try {
        const versionedZipPath = getDesktopZipPaths(candidateDir)[1];
        run("jar", ["xf", versionedZipPath], tempDir);
        mutateFn(join(tempDir, distributionName));
        writeTestZip(tempDir, versionedZipPath);
        copyFileSync(versionedZipPath, getDesktopZipPaths(candidateDir)[0]);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

function writeTestZip(sourceRoot, targetZipPath) {
    const entries = collectZipEntries(sourceRoot);
    const chunks = [];
    const centralDirectory = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBuffer = Buffer.from(entry.name, "utf8");
        const data = entry.directory ? Buffer.alloc(0) : readFileSync(entry.path);
        const crc = crc32(data);
        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(10, 4);
        localHeader.writeUInt16LE(0x0800, 6);
        localHeader.writeUInt16LE(0, 8);
        localHeader.writeUInt16LE(0, 10);
        localHeader.writeUInt16LE(0x0021, 12);
        localHeader.writeUInt32LE(crc, 14);
        localHeader.writeUInt32LE(data.length, 18);
        localHeader.writeUInt32LE(data.length, 22);
        localHeader.writeUInt16LE(nameBuffer.length, 26);
        localHeader.writeUInt16LE(0, 28);
        chunks.push(localHeader, nameBuffer, data);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(0x031e, 4);
        centralHeader.writeUInt16LE(10, 6);
        centralHeader.writeUInt16LE(0x0800, 8);
        centralHeader.writeUInt16LE(0, 10);
        centralHeader.writeUInt16LE(0, 12);
        centralHeader.writeUInt16LE(0x0021, 14);
        centralHeader.writeUInt32LE(crc, 16);
        centralHeader.writeUInt32LE(data.length, 20);
        centralHeader.writeUInt32LE(data.length, 24);
        centralHeader.writeUInt16LE(nameBuffer.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE((entry.mode << 16) | (entry.directory ? 0x10 : 0), 38);
        centralHeader.writeUInt32LE(offset, 42);
        centralDirectory.push(centralHeader, nameBuffer);
        offset += localHeader.length + nameBuffer.length + data.length;
    }

    const centralDirectorySize = centralDirectory.reduce((size, chunk) => size + chunk.length, 0);
    const endOfCentralDirectory = Buffer.alloc(22);
    endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
    endOfCentralDirectory.writeUInt16LE(0, 4);
    endOfCentralDirectory.writeUInt16LE(0, 6);
    endOfCentralDirectory.writeUInt16LE(entries.length, 8);
    endOfCentralDirectory.writeUInt16LE(entries.length, 10);
    endOfCentralDirectory.writeUInt32LE(centralDirectorySize, 12);
    endOfCentralDirectory.writeUInt32LE(offset, 16);
    endOfCentralDirectory.writeUInt16LE(0, 20);
    writeFileSync(targetZipPath, Buffer.concat([...chunks, ...centralDirectory, endOfCentralDirectory]));
}

function collectZipEntries(sourceRoot) {
    const entries = [];
    collectZipEntriesFromDirectory(sourceRoot, sourceRoot, entries);
    return entries.sort((a, b) => a.name.localeCompare(b.name));
}

function collectZipEntriesFromDirectory(dir, sourceRoot, entries) {
    const directoryName = relative(sourceRoot, dir).replaceAll("\\", "/");
    if (directoryName !== "") {
        entries.push({
            directory: true,
            mode: 0o755,
            name: `${directoryName}/`,
            path: dir
        });
    }
    for (const entry of readdirSync(dir).sort((a, b) => a.localeCompare(b))) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
            collectZipEntriesFromDirectory(path, sourceRoot, entries);
        } else if (stat.isFile()) {
            const name = relative(sourceRoot, path).replaceAll("\\", "/");
            entries.push({
                directory: false,
                mode: EXECUTABLE_ZIP_ENTRIES.has(name) ? 0o755 : 0o644,
                name,
                path
            });
        }
    }
}

function createCrc32Table() {
    const table = new Uint32Array(256);
    for (let i = 0; i < table.length; i++) {
        let value = i;
        for (let bit = 0; bit < 8; bit++) {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[i] = value >>> 0;
    }
    return table;
}

function crc32(buffer) {
    let value = 0xffffffff;
    for (const byte of buffer) {
        value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
    }
    return (value ^ 0xffffffff) >>> 0;
}

function getDesktopZipPaths(candidateDir) {
    const version = readReleaseMetadata(candidateDir).version;
    return [join(candidateDir, "downloads", `${distributionName}.zip`), join(candidateDir, "downloads", `${distributionName}-${version}.zip`)];
}

function readReleaseMetadata(candidateDir) {
    return JSON.parse(readFileSync(join(candidateDir, "release.json"), "utf8"));
}

function writeReleaseMetadata(candidateDir, metadata) {
    writeFileSync(join(candidateDir, "release.json"), `${JSON.stringify(metadata, null, 4)}\n`);
}

function createDistinctActiveKey() {
    let activeKey = createHmacKeyHex();
    while (activeKey === SYNTHETIC_RELEASE_HMAC_KEY_HEX) {
        activeKey = createHmacKeyHex();
    }
    return activeKey;
}

function copyWorkingSourceToFixture(fixtureRoot) {
    for (const file of listGitFixtureFiles()) {
        const sourcePath = join(rootDir, file);
        if (!existsSync(sourcePath) || statSync(sourcePath).isDirectory()) {
            continue;
        }
        const targetPath = join(fixtureRoot, file);
        mkdirSync(dirname(targetPath), { recursive: true });
        copyFileSync(sourcePath, targetPath);
    }
}

function listGitFixtureFiles() {
    const result = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
        cwd: rootDir,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.split("\0").filter(Boolean);
}

function snapshotDirectory(dir) {
    const snapshot = {};
    for (const path of listFiles(dir)) {
        snapshot[relative(dir, path).replaceAll("\\", "/")] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
    return snapshot;
}

function listFiles(dir) {
    if (!existsSync(dir)) {
        return [];
    }
    const files = [];
    collectFiles(dir, files);
    return files.sort((a, b) => a.localeCompare(b));
}

function collectFiles(dir, files) {
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
            collectFiles(path, files);
        } else if (stat.isFile()) {
            files.push(path);
        }
    }
}

function spawnNodeScript(cwd, scriptName, env, args = []) {
    return spawnSync(process.execPath, [scriptName, ...args], {
        cwd,
        encoding: "utf8",
        env,
        maxBuffer: 96 * 1024 * 1024,
        windowsHide: true
    });
}

function run(command, args, cwd) {
    const result = spawnSync(command, args, {
        cwd,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true
    });
    assert.equal(result.status, 0, formatFailure(`${command} ${args.join(" ")} failed.`, result));
    return result;
}

function runGit(cwd, args) {
    return run("git", args, cwd);
}

function readGitHead(cwd) {
    return runGit(cwd, ["rev-parse", "HEAD"]).stdout.trim();
}

function readGitStatus(cwd) {
    return runGit(cwd, ["status", "--porcelain", "--untracked-files=normal"]).stdout;
}

function assertOutputIncludes(result, text) {
    assert.ok(`${result.stdout}\n${result.stderr}`.includes(text), `Expected output to include ${JSON.stringify(text)}.`);
}

function formatFailure(message, result) {
    return [message, "stdout:", result.stdout, "stderr:", result.stderr, "error:", result.error?.message ?? ""].join("\n");
}

async function runTest(name, fn) {
    try {
        await fn();
        console.log(`ok - ${name}`);
    } catch (error) {
        console.error(`not ok - ${name}`);
        console.error(error);
        process.exitCode = 1;
    }
}
