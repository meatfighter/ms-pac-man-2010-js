import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHmacKeyHex, getHmacFingerprint, readKeyFile, writeKeyFile } from "./hmac-config.mjs";
import { rootDir, versionPath } from "./build-utils.mjs";

const originalVersionJson = readFileSync(versionPath, "utf8");

try {
    await runTest("release provisioning preserves generated active key when build fails", () => {
        withMismatchedVersionJson(() => {
            const tempSecretsDir = mkdtempSync(join(tmpdir(), "mspacman-provision-secrets-"));
            const tempDistDir = mkdtempSync(join(tmpdir(), "mspacman-provision-dist-"));
            try {
                const result = spawnNodeScript("scripts/release-provision.mjs", {
                    ...process.env,
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

    await runTest("failed late full release build preserves existing dist atomically", () => {
        writeFileSync(versionPath, originalVersionJson);
        const tempRoot = mkdtempSync(join(tmpdir(), "mspacman-atomic-release-"));
        const tempDistDir = join(tempRoot, "dist");
        try {
            mkdirSync(tempDistDir, { recursive: true });
            writeFileSync(join(tempDistDir, "sentinel.txt"), "known good\n");

            const result = spawnNodeScript(
                "scripts/build-release.mjs",
                {
                    ...process.env,
                    MSPACMAN_DIST_DIR: tempDistDir,
                    MSPACMAN_HMAC_KEY_HEX: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
                    JAVA_TOOL_OPTIONS: "-XX:InvalidMsPacManReleaseSafetyOption",
                    JDK_JAVAC_OPTIONS: "--invalid-ms-pacman-release-safety-test"
                },
                ["--target=full", "--key-source=env"]
            );
            assert.notEqual(
                result.status,
                0,
                ["Full release should fail when the desktop compiler fails.", "stdout:", result.stdout, "stderr:", result.stderr].join("\n")
            );
            assert.equal(readFileSync(join(tempDistDir, "sentinel.txt"), "utf8"), "known good\n", "Existing dist must survive a failed full build.");
            assert.equal(existsSync(join(tempDistDir, "pwa")), false, "Failed pending output must not be promoted into existing dist.");
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });
} finally {
    writeFileSync(versionPath, originalVersionJson);
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
