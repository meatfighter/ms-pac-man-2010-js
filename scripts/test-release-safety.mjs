import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import {
    abortRotation,
    createHmacKeyHex,
    getHmacFingerprint,
    promoteNextKey,
    readKeyFile,
    SYNTHETIC_RELEASE_HMAC_KEY_HEX,
    writeKeyFile
} from "./hmac-config.mjs";
import { getHmacNextCandidateDir, rootDir, versionPath } from "./build-utils.mjs";

const originalVersionJson = readFileSync(versionPath, "utf8");
const originalVersion = JSON.parse(originalVersionJson);
const originalGitStatus = readGitStatus();
const originalAllowPathOverrides = process.env.MSPACMAN_ENABLE_TEST_PATH_OVERRIDES;

try {
    process.env.MSPACMAN_ENABLE_TEST_PATH_OVERRIDES = "1";
    await runTest("release provisioning preserves generated active key when build fails", () => {
        withCleanGitFixture((fixtureRoot) => {
            const tempSecretsDir = mkdtempSync(join(tmpdir(), "mspacman-provision-secrets-"));
            try {
                const result = spawnNodeScript(
                    "scripts/release-provision.mjs",
                    {
                        ...process.env,
                        MSPACMAN_TEST_RELEASE_SECRETS_DIR: tempSecretsDir,
                        MSPACMAN_TEST_FAIL_RELEASE_STAGE: "after-stamp"
                    },
                    [],
                    fixtureRoot
                );
                assert.notEqual(result.status, 0, "Provisioning should fail at the injected release stage.");
                const activePath = join(tempSecretsDir, "ms-pac-man-2010-hmac.hex");
                assert.equal(existsSync(activePath), true, "Failed provisioning must preserve the generated active key.");
                const activeKey = readKeyFile(activePath, "Active HMAC key");
                assertOutputDoesNotExposeKey(result, activeKey);
                assertOutputIncludes(result, getHmacFingerprint(activeKey));
                assertOutputIncludes(result, "Injected release failure stage: after-stamp");
                assertOutputIncludes(result, "The active HMAC key was preserved.");
            } finally {
                rmSync(tempSecretsDir, { recursive: true, force: true });
            }
        });
    });

    await runTest("release rotation preserves and reuses staged next key when build fails", () => {
        withCleanGitFixture((fixtureRoot) => {
            const tempSecretsDir = mkdtempSync(join(tmpdir(), "mspacman-rotation-secrets-"));
            try {
                const activeKey = createHmacKeyHex();
                const activePath = join(tempSecretsDir, "ms-pac-man-2010-hmac.hex");
                const nextPath = join(tempSecretsDir, "ms-pac-man-2010-hmac.next.hex");
                writeKeyFile(activePath, activeKey);

                const first = spawnNodeScript(
                    "scripts/release-rotate-hmac.mjs",
                    {
                        ...process.env,
                        MSPACMAN_TEST_RELEASE_SECRETS_DIR: tempSecretsDir,
                        MSPACMAN_TEST_FAIL_RELEASE_STAGE: "after-stamp"
                    },
                    [],
                    fixtureRoot
                );
                assert.notEqual(first.status, 0, "Rotation candidate should fail at the injected release stage.");
                assert.equal(existsSync(nextPath), true, "Failed rotation must preserve the staged next key.");
                const firstNextKey = readKeyFile(nextPath, "Next HMAC key");
                assertOutputDoesNotExposeKey(first, activeKey);
                assertOutputDoesNotExposeKey(first, firstNextKey);
                assertOutputIncludes(first, getHmacFingerprint(firstNextKey));
                assertOutputIncludes(first, "Injected release failure stage: after-stamp");
                assertOutputIncludes(first, "The staged next HMAC key was preserved.");

                const second = spawnNodeScript(
                    "scripts/release-rotate-hmac.mjs",
                    {
                        ...process.env,
                        MSPACMAN_TEST_RELEASE_SECRETS_DIR: tempSecretsDir,
                        MSPACMAN_TEST_FAIL_RELEASE_STAGE: "after-stamp"
                    },
                    [],
                    fixtureRoot
                );
                assert.notEqual(second.status, 0, "Second rotation candidate should also fail at the injected release stage.");
                assert.equal(readKeyFile(nextPath, "Next HMAC key"), firstNextKey, "Rotation reruns must reuse an existing staged next key.");
                assertOutputIncludes(second, "Reusing next HMAC key.");
            } finally {
                rmSync(tempSecretsDir, { recursive: true, force: true });
            }
        });
    });

    await runTest("production active-key release rejects non-ignored dirty source before stamping", () => {
        const tempSecretsDir = mkdtempSync(join(tmpdir(), "mspacman-dirty-release-secrets-"));
        const untrackedPath = join(rootDir, "MSPACMAN_RELEASE_SAFETY_UNTRACKED_TEST.txt");
        try {
            const activeKey = createHmacKeyHex();
            writeKeyFile(join(tempSecretsDir, "ms-pac-man-2010-hmac.hex"), activeKey);
            writeFileSync(untrackedPath, "must not release from a dirty tree\n");

            const result = spawnNodeScript(
                "scripts/build-release.mjs",
                {
                    ...process.env,
                    MSPACMAN_RELEASE_ALLOW_DIRTY: "1",
                    MSPACMAN_TEST_RELEASE_SECRETS_DIR: tempSecretsDir
                },
                ["--target=pwa", "--key-source=active"]
            );
            assert.notEqual(result.status, 0, "Active-key release must reject a non-ignored untracked file even when the obsolete dirty bypass is set.");
            assertOutputIncludes(result, "Git working tree is not clean.");
            assertOutputDoesNotExposeKey(result, activeKey);
            assert.equal(readFileSync(versionPath, "utf8"), originalVersionJson, "Dirty-source rejection must not modify version.json.");
        } finally {
            rmSync(untrackedPath, { force: true });
            rmSync(tempSecretsDir, { recursive: true, force: true });
        }
    });

    await runTest("release provisioning rejects dirty source before creating an active key", () => {
        const tempSecretsDir = mkdtempSync(join(tmpdir(), "mspacman-dirty-provision-secrets-"));
        const untrackedPath = join(rootDir, "MSPACMAN_RELEASE_PROVISION_UNTRACKED_TEST.txt");
        try {
            writeFileSync(untrackedPath, "must not provision from a dirty tree\n");
            const result = spawnNodeScript("scripts/release-provision.mjs", {
                ...process.env,
                MSPACMAN_TEST_RELEASE_SECRETS_DIR: tempSecretsDir
            });
            assert.notEqual(result.status, 0, "Provisioning must reject a dirty source tree.");
            assertOutputIncludes(result, "Git working tree is not clean.");
            assert.equal(existsSync(join(tempSecretsDir, "ms-pac-man-2010-hmac.hex")), false, "Dirty provisioning must not create an active key.");
        } finally {
            rmSync(untrackedPath, { force: true });
            rmSync(tempSecretsDir, { recursive: true, force: true });
        }
    });

    await runTest("component release builds leave canonical dist unchanged", () => {
        const tempComponentsDir = mkdtempSync(join(tmpdir(), "mspacman-release-components-"));
        const distPath = join(rootDir, "dist");
        const beforeDist = snapshotDirectory(distPath);
        try {
            for (const target of ["pwa", "web"]) {
                const result = spawnNodeScript(
                    "scripts/build-release.mjs",
                    {
                        ...process.env,
                        MSPACMAN_HMAC_KEY_HEX: SYNTHETIC_RELEASE_HMAC_KEY_HEX,
                        MSPACMAN_TEST_RELEASE_COMPONENTS_DIR: tempComponentsDir
                    },
                    [`--target=${target}`, "--key-source=env"]
                );
                assert.equal(result.status, 0, formatFailure(`Component ${target} release build failed.`, result));
                assert.deepEqual(snapshotDirectory(distPath), beforeDist, `Component ${target} release build must not modify canonical dist/.`);
                assert.equal(existsSync(join(tempComponentsDir, target, "pwa", "sw.js")), true, `Component ${target} release build must write PWA output.`);
            }
            assert.equal(existsSync(join(tempComponentsDir, "web", "index.html")), true, "Component web release build must write about-page output.");
            const webDesktopZip = join(tempComponentsDir, "web", "downloads", "ms-pac-man-2010-desktop.zip");
            const webVersionedDesktopZip = join(tempComponentsDir, "web", "downloads", `ms-pac-man-2010-desktop-${originalVersion.version}.zip`);
            assert.equal(existsSync(webDesktopZip), true, "Component web release build must write the stable desktop ZIP linked by the about page.");
            assert.equal(existsSync(webVersionedDesktopZip), true, "Component web release build must write the versioned desktop ZIP.");
            assert.equal(
                createHash("sha256").update(readFileSync(webDesktopZip)).digest("hex"),
                createHash("sha256").update(readFileSync(webVersionedDesktopZip)).digest("hex"),
                "Component web release stable and versioned desktop ZIPs must be identical."
            );
        } finally {
            rmSync(tempComponentsDir, { recursive: true, force: true });
        }
    });

    await runTest("env-key full release uses managed synthetic output and restores version after injected failure", () => {
        const tempComponentsDir = mkdtempSync(join(tmpdir(), "mspacman-synthetic-components-"));
        const beforeDist = snapshotDirectory(join(rootDir, "dist"));
        const beforeStatus = readGitStatus();
        try {
            const result = spawnNodeScript(
                "scripts/build-release.mjs",
                {
                    ...process.env,
                    MSPACMAN_HMAC_KEY_HEX: SYNTHETIC_RELEASE_HMAC_KEY_HEX,
                    MSPACMAN_TEST_RELEASE_COMPONENTS_DIR: tempComponentsDir,
                    MSPACMAN_TEST_FAIL_RELEASE_STAGE: "after-stamp"
                },
                ["--target=full", "--key-source=env"]
            );
            assert.notEqual(result.status, 0, "Injected synthetic full release should fail.");
            assertOutputIncludes(result, "Injected release failure stage: after-stamp");
            assert.equal(readFileSync(versionPath, "utf8"), originalVersionJson, "Rejected env-key full release must restore version.json.");
            assert.equal(readGitStatus(), beforeStatus, "Rejected env-key full release must leave Git source state unchanged.");
            assert.deepEqual(snapshotDirectory(join(rootDir, "dist")), beforeDist, "Rejected env-key full release must not modify canonical dist/.");
            assert.equal(existsSync(join(tempComponentsDir, "synthetic-full")), false, "Failed synthetic full release must not promote output.");
        } finally {
            rmSync(tempComponentsDir, { recursive: true, force: true });
        }
    });

    await runTest("env-key full release rejects explicit output overrides before stamping", () => {
        const beforeDist = snapshotDirectory(join(rootDir, "dist"));
        const beforeStatus = readGitStatus();
        const result = spawnNodeScript(
            "scripts/build-release.mjs",
            {
                ...process.env,
                MSPACMAN_HMAC_KEY_HEX: SYNTHETIC_RELEASE_HMAC_KEY_HEX
            },
            ["--target=full", "--key-source=env", `--output-dir=${join(rootDir, "dist")}`]
        );
        assert.notEqual(result.status, 0, "Env-key full release with --output-dir must fail.");
        assertOutputIncludes(result, "Synthetic full releases use the managed");
        assert.equal(readFileSync(versionPath, "utf8"), originalVersionJson, "Rejected env-key full release must not modify version.json.");
        assert.equal(readGitStatus(), beforeStatus, "Rejected env-key full release must leave Git source state unchanged.");
        assert.deepEqual(snapshotDirectory(join(rootDir, "dist")), beforeDist, "Rejected env-key full release must not modify canonical dist/.");
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
                    MSPACMAN_TEST_RELEASE_SECRETS_DIR: tempSecretsDir
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
                    MSPACMAN_TEST_RELEASE_SECRETS_DIR: tempSecretsDir
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

    await runTest("release lock rejects concurrent operations and recovers stale owner", async () => {
        const beforeVersionJson = readFileSync(versionPath, "utf8");
        const holder = spawn(
            process.execPath,
            [
                "--input-type=module",
                "-e",
                [
                    'import { acquireReleaseLock } from "./scripts/release-lock.mjs";',
                    'const release = acquireReleaseLock("test-holder");',
                    'console.log("locked");',
                    "setInterval(() => undefined, 1000);",
                    "process.on('SIGTERM', () => process.exit(0));",
                    "void release;"
                ].join("")
            ],
            {
                cwd: rootDir,
                env: process.env,
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: true
            }
        );
        try {
            await waitForStdout(holder, "locked");
            const rejected = spawnNodeScript(
                "scripts/build-release.mjs",
                {
                    ...process.env,
                    MSPACMAN_HMAC_KEY_HEX: SYNTHETIC_RELEASE_HMAC_KEY_HEX
                },
                ["--target=pwa", "--key-source=env"]
            );
            assert.notEqual(rejected.status, 0, "Concurrent release operation must be rejected.");
            assertOutputIncludes(rejected, "Another release operation is running");
        } finally {
            const closePromise = waitForClose(holder);
            holder.kill();
            await closePromise;
        }

        const retry = spawnNodeScript(
            "scripts/build-release.mjs",
            {
                ...process.env,
                MSPACMAN_HMAC_KEY_HEX: SYNTHETIC_RELEASE_HMAC_KEY_HEX,
                MSPACMAN_TEST_FAIL_RELEASE_STAGE: "after-stamp"
            },
            ["--target=pwa", "--key-source=env"]
        );
        assert.notEqual(retry.status, 0, "Retry should reach the injected release stage after stale-lock recovery.");
        assertOutputIncludes(retry, "Injected release failure stage: after-stamp");
        assert.equal(readFileSync(versionPath, "utf8"), beforeVersionJson, "Release lock retry must restore version.json.");
    });

    await runTest("rollback-safe HMAC promotion keeps active key after injected failure", () => {
        const tempSecretsDir = mkdtempSync(join(tmpdir(), "mspacman-hmac-promote-failure-"));
        const previousSecretsDir = process.env.MSPACMAN_TEST_RELEASE_SECRETS_DIR;
        try {
            process.env.MSPACMAN_TEST_RELEASE_SECRETS_DIR = tempSecretsDir;
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
                delete process.env.MSPACMAN_TEST_RELEASE_SECRETS_DIR;
            } else {
                process.env.MSPACMAN_TEST_RELEASE_SECRETS_DIR = previousSecretsDir;
            }
            rmSync(tempSecretsDir, { recursive: true, force: true });
        }
    });

    await runTest("rotation abort removes staged next key and local candidate release", () => {
        const tempSecretsDir = mkdtempSync(join(tmpdir(), "mspacman-hmac-abort-"));
        const tempCandidateDir = mkdtempSync(join(tmpdir(), "mspacman-hmac-abort-candidate-"));
        const previousSecretsDir = process.env.MSPACMAN_TEST_RELEASE_SECRETS_DIR;
        const previousCandidateDir = process.env.MSPACMAN_TEST_HMAC_NEXT_CANDIDATE_DIR;
        try {
            process.env.MSPACMAN_TEST_RELEASE_SECRETS_DIR = tempSecretsDir;
            process.env.MSPACMAN_TEST_HMAC_NEXT_CANDIDATE_DIR = tempCandidateDir;
            const activeKey = createHmacKeyHex();
            let nextKey = createHmacKeyHex();
            while (nextKey === activeKey) {
                nextKey = createHmacKeyHex();
            }
            writeKeyFile(join(tempSecretsDir, "ms-pac-man-2010-hmac.hex"), activeKey);
            writeKeyFile(join(tempSecretsDir, "ms-pac-man-2010-hmac.next.hex"), nextKey);
            const hmacNextCandidateDir = getHmacNextCandidateDir();
            mkdirSync(hmacNextCandidateDir, { recursive: true });
            writeFileSync(join(hmacNextCandidateDir, "candidate-sentinel.txt"), "candidate\n");

            const result = abortRotation();
            assert.equal(result.nextRemoved, true);
            assert.equal(existsSync(join(tempSecretsDir, "ms-pac-man-2010-hmac.next.hex")), false);
            assert.equal(existsSync(hmacNextCandidateDir), false, "Abort must remove the next-key candidate release directory.");
        } finally {
            if (previousSecretsDir === undefined) {
                delete process.env.MSPACMAN_TEST_RELEASE_SECRETS_DIR;
            } else {
                process.env.MSPACMAN_TEST_RELEASE_SECRETS_DIR = previousSecretsDir;
            }
            if (previousCandidateDir === undefined) {
                delete process.env.MSPACMAN_TEST_HMAC_NEXT_CANDIDATE_DIR;
            } else {
                process.env.MSPACMAN_TEST_HMAC_NEXT_CANDIDATE_DIR = previousCandidateDir;
            }
            rmSync(tempSecretsDir, { recursive: true, force: true });
            rmSync(tempCandidateDir, { recursive: true, force: true });
        }
    });

    await runTest("release-state tests cannot delete a protected staged candidate sentinel", () => {
        const protectedRoot = mkdtempSync(join(tmpdir(), "mspacman-protected-release-state-"));
        const protectedCandidateDir = join(protectedRoot, ".release-candidates", "hmac-next");
        const tempStateRoot = mkdtempSync(join(tmpdir(), "mspacman-isolated-release-state-"));
        const tempSecretsDir = join(tempStateRoot, ".release-secrets");
        const tempCandidateDir = join(tempStateRoot, ".release-candidates", "hmac-next");
        const protectedSentinel = join(protectedCandidateDir, "protected-sentinel.txt");
        const previousSecretsDir = process.env.MSPACMAN_TEST_RELEASE_SECRETS_DIR;
        const previousCandidateDir = process.env.MSPACMAN_TEST_HMAC_NEXT_CANDIDATE_DIR;
        try {
            mkdirSync(protectedCandidateDir, { recursive: true });
            writeFileSync(protectedSentinel, "protected candidate\n");
            process.env.MSPACMAN_TEST_RELEASE_SECRETS_DIR = tempSecretsDir;
            process.env.MSPACMAN_TEST_HMAC_NEXT_CANDIDATE_DIR = tempCandidateDir;

            const activeKey = createHmacKeyHex();
            let nextKey = createHmacKeyHex();
            while (nextKey === activeKey) {
                nextKey = createHmacKeyHex();
            }
            writeKeyFile(join(tempSecretsDir, "ms-pac-man-2010-hmac.hex"), activeKey);
            writeKeyFile(join(tempSecretsDir, "ms-pac-man-2010-hmac.next.hex"), nextKey);
            mkdirSync(tempCandidateDir, { recursive: true });
            writeFileSync(join(tempCandidateDir, "candidate-sentinel.txt"), "isolated candidate\n");

            abortRotation();
            assert.equal(readFileSync(protectedSentinel, "utf8"), "protected candidate\n", "Protected candidate sentinel must remain untouched.");
            assert.equal(existsSync(tempCandidateDir), false, "Isolated test candidate should be removed by abort.");
        } finally {
            if (previousSecretsDir === undefined) {
                delete process.env.MSPACMAN_TEST_RELEASE_SECRETS_DIR;
            } else {
                process.env.MSPACMAN_TEST_RELEASE_SECRETS_DIR = previousSecretsDir;
            }
            if (previousCandidateDir === undefined) {
                delete process.env.MSPACMAN_TEST_HMAC_NEXT_CANDIDATE_DIR;
            } else {
                process.env.MSPACMAN_TEST_HMAC_NEXT_CANDIDATE_DIR = previousCandidateDir;
            }
            rmSync(protectedRoot, { recursive: true, force: true });
            rmSync(tempStateRoot, { recursive: true, force: true });
        }
    });

    await runTest("rotation abort rejects unsafe candidate overrides before removing the staged next key", () => {
        const tempSecretsDir = mkdtempSync(join(tmpdir(), "mspacman-hmac-abort-unsafe-"));
        const previousSecretsDir = process.env.MSPACMAN_TEST_RELEASE_SECRETS_DIR;
        const previousCandidateDir = process.env.MSPACMAN_TEST_HMAC_NEXT_CANDIDATE_DIR;
        try {
            process.env.MSPACMAN_TEST_RELEASE_SECRETS_DIR = tempSecretsDir;
            process.env.MSPACMAN_TEST_HMAC_NEXT_CANDIDATE_DIR = join(rootDir, "dist");
            const activeKey = createHmacKeyHex();
            let nextKey = createHmacKeyHex();
            while (nextKey === activeKey) {
                nextKey = createHmacKeyHex();
            }
            writeKeyFile(join(tempSecretsDir, "ms-pac-man-2010-hmac.hex"), activeKey);
            writeKeyFile(join(tempSecretsDir, "ms-pac-man-2010-hmac.next.hex"), nextKey);

            assert.throws(() => abortRotation(), /MSPACMAN_TEST_HMAC_NEXT_CANDIDATE_DIR|dist/);
            assert.equal(readKeyFile(join(tempSecretsDir, "ms-pac-man-2010-hmac.next.hex"), "Next HMAC key"), nextKey);
        } finally {
            if (previousSecretsDir === undefined) {
                delete process.env.MSPACMAN_TEST_RELEASE_SECRETS_DIR;
            } else {
                process.env.MSPACMAN_TEST_RELEASE_SECRETS_DIR = previousSecretsDir;
            }
            if (previousCandidateDir === undefined) {
                delete process.env.MSPACMAN_TEST_HMAC_NEXT_CANDIDATE_DIR;
            } else {
                process.env.MSPACMAN_TEST_HMAC_NEXT_CANDIDATE_DIR = previousCandidateDir;
            }
            rmSync(tempSecretsDir, { recursive: true, force: true });
        }
    });

    await runTest("release build restores version.json and source state after injected stamp failure", () => {
        const tempComponentsDir = mkdtempSync(join(tmpdir(), "mspacman-stamp-failure-components-"));
        try {
            const beforeStatus = readGitStatus();
            const result = spawnNodeScript(
                "scripts/build-release.mjs",
                {
                    ...process.env,
                    MSPACMAN_TEST_RELEASE_COMPONENTS_DIR: tempComponentsDir,
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
            rmSync(tempComponentsDir, { recursive: true, force: true });
        }
    });

    await runTest("failed late full release build preserves existing dist atomically", () => {
        writeFileSync(versionPath, originalVersionJson);
        const tempRoot = mkdtempSync(join(tmpdir(), "mspacman-atomic-release-"));
        const tempDistDir = join(tempRoot, "synthetic-full");
        try {
            mkdirSync(tempDistDir, { recursive: true });
            writeFileSync(join(tempDistDir, "sentinel.txt"), "known good\n");
            const beforeTree = snapshotDirectory(tempDistDir);
            const beforeStatus = readGitStatus();

            const result = spawnNodeScript(
                "scripts/build-release.mjs",
                {
                    ...process.env,
                    MSPACMAN_TEST_RELEASE_COMPONENTS_DIR: tempRoot,
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

    await runTest("final clean-source rejection happens before full release promotion", () => {
        writeFileSync(versionPath, originalVersionJson);
        const tempRoot = mkdtempSync(join(tmpdir(), "mspacman-final-clean-release-"));
        const tempDistDir = join(tempRoot, "synthetic-full");
        const trackedMutationFile = "README.md";
        const trackedMutationPath = join(rootDir, trackedMutationFile);
        const originalTrackedMutationText = readFileSync(trackedMutationPath, "utf8");
        try {
            mkdirSync(tempDistDir, { recursive: true });
            writeFileSync(join(tempDistDir, "sentinel.txt"), "known good\n");
            const beforeTree = snapshotDirectory(tempDistDir);

            const result = spawnNodeScript(
                "scripts/build-release.mjs",
                {
                    ...process.env,
                    MSPACMAN_TEST_RELEASE_COMPONENTS_DIR: tempRoot,
                    MSPACMAN_HMAC_KEY_HEX: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
                    MSPACMAN_TEST_MUTATE_TRACKED_FILE_AFTER_VERIFY: trackedMutationFile,
                    MSPACMAN_TEST_REQUIRE_FINAL_CLEAN_CHECK: "1"
                },
                ["--target=full", "--key-source=env"]
            );
            assert.notEqual(result.status, 0, "Final clean-source rejection should fail the release build.");
            assertOutputIncludes(result, "Git working tree is not clean.");
            assert.deepEqual(snapshotDirectory(tempDistDir), beforeTree, "Existing dist must survive final clean-source rejection byte-for-byte.");
            assert.equal(readFileSync(versionPath, "utf8"), originalVersionJson, "Final clean-source rejection must restore version.json.");
            assert.equal(
                readdirSync(tempRoot).some((entry) => entry.startsWith(".dist-pending-")),
                false,
                "Rejected pending release directory must be cleaned up."
            );
        } finally {
            writeFileSync(trackedMutationPath, originalTrackedMutationText);
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });
} finally {
    writeFileSync(versionPath, originalVersionJson);
    if (originalAllowPathOverrides === undefined) {
        delete process.env.MSPACMAN_ENABLE_TEST_PATH_OVERRIDES;
    } else {
        process.env.MSPACMAN_ENABLE_TEST_PATH_OVERRIDES = originalAllowPathOverrides;
    }
    assert.equal(readGitStatus(), originalGitStatus, "Release safety tests must restore the original Git status.");
}

function withCleanGitFixture(fn) {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "mspacman-clean-release-fixture-"));
    try {
        copyWorkingSourceToFixture(fixtureRoot);
        runGit(fixtureRoot, ["init"]);
        runGit(fixtureRoot, ["add", "."]);
        runGit(fixtureRoot, ["-c", "user.name=Ms Pac-Man Release Test", "-c", "user.email=release-test@example.invalid", "commit", "-m", "fixture"]);
        fn(fixtureRoot);
    } finally {
        removeTemporaryGitFixture(fixtureRoot);
    }
}

function removeTemporaryGitFixture(path) {
    rmSync(path, {
        force: true,
        maxRetries: 10,
        recursive: true,
        retryDelay: 100
    });
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

function runGit(cwd, args) {
    const result = spawnSync("git", args, {
        cwd,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true
    });
    assert.equal(result.status, 0, result.stderr);
    return result;
}

function spawnNodeScript(scriptName, env, args = [], cwd = rootDir) {
    return spawnSync(process.execPath, [scriptName, ...args], {
        cwd,
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

function assertOutputIncludes(result, text) {
    assert.ok(`${result.stdout}\n${result.stderr}`.includes(text), `Expected output to include ${JSON.stringify(text)}.`);
}

function assertOutputDoesNotExposeKey(result, keyHex) {
    assert.equal(result.stdout.includes(keyHex), false, "stdout must not expose full HMAC keys.");
    assert.equal(result.stderr.includes(keyHex), false, "stderr must not expose full HMAC keys.");
}

function formatFailure(message, result) {
    return [message, "stdout:", result.stdout, "stderr:", result.stderr, "error:", result.error?.message ?? ""].join("\n");
}

function waitForStdout(child, text) {
    return new Promise((resolve, reject) => {
        let output = "";
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for child stdout: ${text}\n${output}`)), 10000);
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            output += chunk;
            if (output.includes(text)) {
                clearTimeout(timer);
                resolve();
            }
        });
        child.stderr.on("data", (chunk) => {
            output += chunk;
        });
        child.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on("exit", (status) => {
            if (!output.includes(text)) {
                clearTimeout(timer);
                reject(new Error(`Child exited before stdout contained ${text}; status ${status}; output ${output}`));
            }
        });
    });
}

function waitForClose(child) {
    return new Promise((resolve) => {
        child.on("close", resolve);
    });
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
