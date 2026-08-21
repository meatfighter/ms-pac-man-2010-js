import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { abortRotation, createHmacKeyHex, getHmacFingerprint, promoteNextKey, readKeyFile, writeKeyFile } from "./hmac-config.mjs";
import { hmacNextCandidateDir, rootDir, versionPath } from "./build-utils.mjs";

const originalVersionJson = readFileSync(versionPath, "utf8");
const originalGitStatus = readGitStatus();

try {
    await runTest("release provisioning preserves generated active key when build fails", () => {
        withMismatchedVersionJson(() => {
            const tempSecretsDir = mkdtempSync(join(tmpdir(), "mspacman-provision-secrets-"));
            const tempDistDir = mkdtempSync(join(tmpdir(), "mspacman-provision-dist-"));
            try {
                const result = spawnNodeScript("scripts/release-provision.mjs", {
                    ...process.env,
                    MSPACMAN_RELEASE_ALLOW_DIRTY: "1",
                    MSPACMAN_DIST_DIR: tempDistDir,
                    MSPACMAN_RELEASE_SECRETS_DIR: tempSecretsDir
                });
                assert.notEqual(result.status, 0, "Provisioning should fail with mismatched release versions.");
                const activePath = join(tempSecretsDir, "ms-pac-man-2010-hmac.hex");
                assert.equal(existsSync(activePath), true, "Failed provisioning must preserve the generated active key.");
                const activeKey = readKeyFile(activePath, "Active HMAC key");
                assertOutputDoesNotExposeKey(result, activeKey);
                assertOutputIncludes(result, getHmacFingerprint(activeKey));
                assertOutputIncludes(result, "The active HMAC key was preserved.");
            } finally {
                rmSync(tempSecretsDir, { recursive: true, force: true });
                rmSync(tempDistDir, { recursive: true, force: true });
            }
        });
    });

    await runTest("release rotation preserves and reuses staged next key when build fails", () => {
        withMismatchedVersionJson(() => {
            const tempSecretsDir = mkdtempSync(join(tmpdir(), "mspacman-rotation-secrets-"));
            const tempDistDir = mkdtempSync(join(tmpdir(), "mspacman-rotation-dist-"));
            try {
                const activeKey = createHmacKeyHex();
                const activePath = join(tempSecretsDir, "ms-pac-man-2010-hmac.hex");
                const nextPath = join(tempSecretsDir, "ms-pac-man-2010-hmac.next.hex");
                writeKeyFile(activePath, activeKey);

                const first = spawnNodeScript("scripts/release-rotate-hmac.mjs", {
                    ...process.env,
                    MSPACMAN_RELEASE_ALLOW_DIRTY: "1",
                    MSPACMAN_DIST_DIR: tempDistDir,
                    MSPACMAN_RELEASE_SECRETS_DIR: tempSecretsDir
                });
                assert.notEqual(first.status, 0, "Rotation candidate should fail with mismatched release versions.");
                assert.equal(existsSync(nextPath), true, "Failed rotation must preserve the staged next key.");
                const firstNextKey = readKeyFile(nextPath, "Next HMAC key");
                assertOutputDoesNotExposeKey(first, activeKey);
                assertOutputDoesNotExposeKey(first, firstNextKey);
                assertOutputIncludes(first, getHmacFingerprint(firstNextKey));
                assertOutputIncludes(first, "The staged next HMAC key was preserved.");

                const second = spawnNodeScript("scripts/release-rotate-hmac.mjs", {
                    ...process.env,
                    MSPACMAN_RELEASE_ALLOW_DIRTY: "1",
                    MSPACMAN_DIST_DIR: tempDistDir,
                    MSPACMAN_RELEASE_SECRETS_DIR: tempSecretsDir
                });
                assert.notEqual(second.status, 0, "Second rotation candidate should also fail with mismatched release versions.");
                assert.equal(readKeyFile(nextPath, "Next HMAC key"), firstNextKey, "Rotation reruns must reuse an existing staged next key.");
                assertOutputIncludes(second, "Reusing next HMAC key.");
            } finally {
                rmSync(tempSecretsDir, { recursive: true, force: true });
                rmSync(tempDistDir, { recursive: true, force: true });
            }
        });
    });

    await runTest("production active-key release rejects non-ignored dirty source before stamping", () => {
        const tempSecretsDir = mkdtempSync(join(tmpdir(), "mspacman-dirty-release-secrets-"));
        const tempDistDir = mkdtempSync(join(tmpdir(), "mspacman-dirty-release-dist-"));
        const untrackedPath = join(rootDir, "MSPACMAN_RELEASE_SAFETY_UNTRACKED_TEST.txt");
        try {
            const activeKey = createHmacKeyHex();
            writeKeyFile(join(tempSecretsDir, "ms-pac-man-2010-hmac.hex"), activeKey);
            writeFileSync(untrackedPath, "must not release from a dirty tree\n");

            const result = spawnNodeScript(
                "scripts/build-release.mjs",
                {
                    ...process.env,
                    MSPACMAN_DIST_DIR: tempDistDir,
                    MSPACMAN_RELEASE_SECRETS_DIR: tempSecretsDir
                },
                ["--target=pwa", "--key-source=active"]
            );
            assert.notEqual(result.status, 0, "Active-key release must reject a non-ignored untracked file.");
            assertOutputIncludes(result, "Git working tree is not clean.");
            assertOutputDoesNotExposeKey(result, activeKey);
            assert.equal(readFileSync(versionPath, "utf8"), originalVersionJson, "Dirty-source rejection must not modify version.json.");
        } finally {
            rmSync(untrackedPath, { force: true });
            rmSync(tempSecretsDir, { recursive: true, force: true });
            rmSync(tempDistDir, { recursive: true, force: true });
        }
    });

    await runTest("release provisioning rejects dirty source before creating an active key", () => {
        const tempSecretsDir = mkdtempSync(join(tmpdir(), "mspacman-dirty-provision-secrets-"));
        const tempDistDir = mkdtempSync(join(tmpdir(), "mspacman-dirty-provision-dist-"));
        const untrackedPath = join(rootDir, "MSPACMAN_RELEASE_PROVISION_UNTRACKED_TEST.txt");
        try {
            writeFileSync(untrackedPath, "must not provision from a dirty tree\n");
            const result = spawnNodeScript("scripts/release-provision.mjs", {
                ...process.env,
                MSPACMAN_DIST_DIR: tempDistDir,
                MSPACMAN_RELEASE_SECRETS_DIR: tempSecretsDir
            });
            assert.notEqual(result.status, 0, "Provisioning must reject a dirty source tree.");
            assertOutputIncludes(result, "Git working tree is not clean.");
            assert.equal(existsSync(join(tempSecretsDir, "ms-pac-man-2010-hmac.hex")), false, "Dirty provisioning must not create an active key.");
        } finally {
            rmSync(untrackedPath, { force: true });
            rmSync(tempSecretsDir, { recursive: true, force: true });
            rmSync(tempDistDir, { recursive: true, force: true });
        }
    });

    await runTest("hmac check reports fingerprints and staged rotation state only", () => {
        const tempSecretsDir = mkdtempSync(join(tmpdir(), "mspacman-hmac-check-output-"));
        try {
            const activeKey = createHmacKeyHex();
            let nextKey = createHmacKeyHex();
            while (nextKey === activeKey) {
                nextKey = createHmacKeyHex();
            }
            writeKeyFile(join(tempSecretsDir, "ms-pac-man-2010-hmac.hex"), activeKey);
            writeKeyFile(join(tempSecretsDir, "ms-pac-man-2010-hmac.next.hex"), nextKey);

            const result = spawnNodeScript(
                "scripts/hmac-cli.mjs",
                {
                    ...process.env,
                    MSPACMAN_RELEASE_SECRETS_DIR: tempSecretsDir
                },
                ["check"]
            );
            assert.equal(result.status, 0, result.stderr);
            assertOutputIncludes(result, "HMAC configuration: OK");
            assertOutputIncludes(result, "Rotation staged: yes");
            assertOutputIncludes(result, getHmacFingerprint(activeKey));
            assertOutputIncludes(result, getHmacFingerprint(nextKey));
            assertOutputDoesNotExposeKey(result, activeKey);
            assertOutputDoesNotExposeKey(result, nextKey);
        } finally {
            rmSync(tempSecretsDir, { recursive: true, force: true });
        }
    });

    await runTest("hmac check rejects staged next key leaked into tracked source", () => {
        const tempSecretsDir = mkdtempSync(join(tmpdir(), "mspacman-hmac-next-leak-"));
        try {
            const activeKey = createHmacKeyHex();
            let nextKey = createHmacKeyHex();
            while (nextKey === activeKey) {
                nextKey = createHmacKeyHex();
            }
            writeKeyFile(join(tempSecretsDir, "ms-pac-man-2010-hmac.hex"), activeKey);
            writeKeyFile(join(tempSecretsDir, "ms-pac-man-2010-hmac.next.hex"), nextKey);
            writeFileSync(
                versionPath,
                `${JSON.stringify(
                    {
                        buildStamp: nextKey,
                        version: JSON.parse(originalVersionJson).version
                    },
                    null,
                    4
                )}\n`
            );

            const result = spawnNodeScript(
                "scripts/hmac-cli.mjs",
                {
                    ...process.env,
                    MSPACMAN_RELEASE_SECRETS_DIR: tempSecretsDir
                },
                ["check"]
            );
            assert.notEqual(result.status, 0, "hmac:check must fail when the staged next key appears in tracked source.");
            assertOutputIncludes(result, "Tracked file contains the selected HMAC key: version.json");
            assertOutputDoesNotExposeKey(result, activeKey);
            assertOutputDoesNotExposeKey(result, nextKey);
        } finally {
            writeFileSync(versionPath, originalVersionJson);
            rmSync(tempSecretsDir, { recursive: true, force: true });
        }
    });

    await runTest("rollback-safe HMAC promotion keeps active key after injected failure", () => {
        const tempSecretsDir = mkdtempSync(join(tmpdir(), "mspacman-hmac-promote-failure-"));
        const previousSecretsDir = process.env.MSPACMAN_RELEASE_SECRETS_DIR;
        try {
            process.env.MSPACMAN_RELEASE_SECRETS_DIR = tempSecretsDir;
            const activeKey = createHmacKeyHex();
            let nextKey = createHmacKeyHex();
            while (nextKey === activeKey) {
                nextKey = createHmacKeyHex();
            }
            writeKeyFile(join(tempSecretsDir, "ms-pac-man-2010-hmac.hex"), activeKey);
            writeKeyFile(join(tempSecretsDir, "ms-pac-man-2010-hmac.next.hex"), nextKey);

            assert.throws(() => promoteNextKey({ failStage: "after-active-replace" }), /Injected HMAC promotion failure/);
            assert.equal(readKeyFile(join(tempSecretsDir, "ms-pac-man-2010-hmac.hex"), "Active HMAC key"), activeKey);
            assert.equal(readKeyFile(join(tempSecretsDir, "ms-pac-man-2010-hmac.next.hex"), "Next HMAC key"), nextKey);
        } finally {
            if (previousSecretsDir === undefined) {
                delete process.env.MSPACMAN_RELEASE_SECRETS_DIR;
            } else {
                process.env.MSPACMAN_RELEASE_SECRETS_DIR = previousSecretsDir;
            }
            rmSync(tempSecretsDir, { recursive: true, force: true });
        }
    });

    await runTest("rotation abort removes staged next key and local candidate release", () => {
        const tempSecretsDir = mkdtempSync(join(tmpdir(), "mspacman-hmac-abort-"));
        const previousSecretsDir = process.env.MSPACMAN_RELEASE_SECRETS_DIR;
        try {
            process.env.MSPACMAN_RELEASE_SECRETS_DIR = tempSecretsDir;
            const activeKey = createHmacKeyHex();
            let nextKey = createHmacKeyHex();
            while (nextKey === activeKey) {
                nextKey = createHmacKeyHex();
            }
            writeKeyFile(join(tempSecretsDir, "ms-pac-man-2010-hmac.hex"), activeKey);
            writeKeyFile(join(tempSecretsDir, "ms-pac-man-2010-hmac.next.hex"), nextKey);
            mkdirSync(hmacNextCandidateDir, { recursive: true });
            writeFileSync(join(hmacNextCandidateDir, "candidate-sentinel.txt"), "candidate\n");

            const result = abortRotation();
            assert.equal(result.nextRemoved, true);
            assert.equal(existsSync(join(tempSecretsDir, "ms-pac-man-2010-hmac.next.hex")), false);
            assert.equal(existsSync(hmacNextCandidateDir), false, "Abort must remove the next-key candidate release directory.");
        } finally {
            if (previousSecretsDir === undefined) {
                delete process.env.MSPACMAN_RELEASE_SECRETS_DIR;
            } else {
                process.env.MSPACMAN_RELEASE_SECRETS_DIR = previousSecretsDir;
            }
            rmSync(tempSecretsDir, { recursive: true, force: true });
            rmSync(hmacNextCandidateDir, { recursive: true, force: true });
        }
    });

    await runTest("source archive contains committed source only", () => {
        const tempDistDir = mkdtempSync(join(tmpdir(), "mspacman-source-archive-dist-"));
        const untrackedFileName = "MSPACMAN_UNTRACKED_SOURCE_ARCHIVE_TEST.txt";
        const untrackedPath = join(rootDir, untrackedFileName);
        try {
            writeFileSync(untrackedPath, "must not ship in source archive\n");
            const result = spawnNodeScript("scripts/write-source-archive.mjs", {
                ...process.env,
                MSPACMAN_DIST_DIR: tempDistDir,
                MSPACMAN_RELEASE_GIT_COMMIT: readGitHead()
            });
            assert.equal(result.status, 0, result.stderr);
            const archivePath = join(tempDistDir, "downloads", "ms-pac-man-2010-js-source.zip");
            const entries = readZipEntries(archivePath);
            assert.equal(
                entries.some((entry) => entry.endsWith(`/${untrackedFileName}`)),
                false,
                "Untracked non-ignored files must not appear in the production source ZIP."
            );
            assert.equal(
                entries.some((entry) => entry.split("/").includes(".release-secrets")),
                false,
                ".release-secrets must not appear in the production source ZIP."
            );
        } finally {
            rmSync(untrackedPath, { force: true });
            rmSync(tempDistDir, { recursive: true, force: true });
        }
    });

    await runTest("release build restores version.json and source state after injected stamp failure", () => {
        const tempDistDir = mkdtempSync(join(tmpdir(), "mspacman-stamp-failure-dist-"));
        try {
            const beforeStatus = readGitStatus();
            const result = spawnNodeScript(
                "scripts/build-release.mjs",
                {
                    ...process.env,
                    MSPACMAN_DIST_DIR: tempDistDir,
                    MSPACMAN_HMAC_KEY_HEX: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
                    MSPACMAN_TEST_FAIL_RELEASE_STAGE: "after-stamp"
                },
                ["--target=pwa", "--key-source=env"]
            );
            assert.notEqual(result.status, 0, "Injected post-stamp failure should fail the release build.");
            assertOutputIncludes(result, "Injected release failure stage: after-stamp");
            assert.equal(readFileSync(versionPath, "utf8"), originalVersionJson, "Failed release build must restore version.json.");
            assert.equal(readGitStatus(), beforeStatus, "Failed release build must leave the Git source state unchanged.");
        } finally {
            rmSync(tempDistDir, { recursive: true, force: true });
        }
    });

    await runTest("failed late full release build preserves existing dist atomically", () => {
        writeFileSync(versionPath, originalVersionJson);
        const tempRoot = mkdtempSync(join(tmpdir(), "mspacman-atomic-release-"));
        const tempDistDir = join(tempRoot, "dist");
        try {
            mkdirSync(tempDistDir, { recursive: true });
            writeFileSync(join(tempDistDir, "sentinel.txt"), "known good\n");
            const beforeTree = snapshotDirectory(tempDistDir);
            const beforeStatus = readGitStatus();

            const result = spawnNodeScript(
                "scripts/build-release.mjs",
                {
                    ...process.env,
                    MSPACMAN_DIST_DIR: tempDistDir,
                    MSPACMAN_HMAC_KEY_HEX: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
                    MSPACMAN_TEST_FAIL_RELEASE_STAGE: "after-artifacts-before-verify"
                },
                ["--target=full", "--key-source=env"]
            );
            assert.notEqual(
                result.status,
                0,
                ["Full release should fail at the injected late release stage.", "stdout:", result.stdout, "stderr:", result.stderr].join("\n")
            );
            assertOutputIncludes(result, "Injected release failure stage: after-artifacts-before-verify");
            assert.deepEqual(snapshotDirectory(tempDistDir), beforeTree, "Existing dist must survive a failed full build byte-for-byte.");
            assert.equal(existsSync(join(tempDistDir, "pwa")), false, "Failed pending output must not be promoted into existing dist.");
            assert.equal(readFileSync(versionPath, "utf8"), originalVersionJson, "Late failed release build must restore version.json.");
            assert.equal(readGitStatus(), beforeStatus, "Late failed release build must leave the Git source state unchanged.");
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });
} finally {
    writeFileSync(versionPath, originalVersionJson);
    assert.equal(readGitStatus(), originalGitStatus, "Release safety tests must restore the original Git status.");
}

function withMismatchedVersionJson(fn) {
    writeFileSync(
        versionPath,
        `${JSON.stringify(
            {
                buildStamp: "2026-08-21T00:00:00.000Z",
                version: "0.0.0"
            },
            null,
            4
        )}\n`
    );
    try {
        fn();
    } finally {
        writeFileSync(versionPath, originalVersionJson);
    }
}

function spawnNodeScript(scriptName, env, args = []) {
    return spawnSync(process.execPath, [scriptName, ...args], {
        cwd: rootDir,
        encoding: "utf8",
        env,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true
    });
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

function readGitHead() {
    const result = spawnSync("git", ["rev-parse", "HEAD"], {
        cwd: rootDir,
        encoding: "utf8",
        windowsHide: true
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
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

function readZipEntries(archivePath) {
    const archive = readFileSync(archivePath);
    const endOffset = findEndOfCentralDirectory(archive);
    const entryCount = archive.readUInt16LE(endOffset + 10);
    let offset = archive.readUInt32LE(endOffset + 16);
    const entries = [];
    for (let i = 0; i < entryCount; i++) {
        assert.equal(archive.readUInt32LE(offset), 0x02014b50, "Malformed ZIP central directory.");
        const nameLength = archive.readUInt16LE(offset + 28);
        const extraLength = archive.readUInt16LE(offset + 30);
        const commentLength = archive.readUInt16LE(offset + 32);
        entries.push(archive.toString("utf8", offset + 46, offset + 46 + nameLength));
        offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
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

function assertOutputIncludes(result, text) {
    assert.ok(`${result.stdout}\n${result.stderr}`.includes(text), `Expected output to include ${JSON.stringify(text)}.`);
}

function assertOutputDoesNotExposeKey(result, keyHex) {
    assert.equal(result.stdout.includes(keyHex), false, "stdout must not expose full HMAC keys.");
    assert.equal(result.stderr.includes(keyHex), false, "stderr must not expose full HMAC keys.");
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
