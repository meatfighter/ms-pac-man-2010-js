import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSafeGeneratedFileMutationPath, assertSafeReleaseMutationPath, releasesDir } from "./build-utils.mjs";
import { getReleaseSecretPaths } from "./hmac-config.mjs";
import { copyFileAtomically, listFilesStrict, writeTextFileAtomically } from "./release-io.mjs";

const originalEnv = snapshotEnv();

try {
    process.env.MSPACMAN_ENABLE_TEST_PATH_OVERRIDES = "1";

    await runTest("managed release mutations reject intermediate linked directories", () => {
        for (const name of ["MSPACMAN_TEST_DIST_DIR", "MSPACMAN_TEST_RELEASE_COMPONENTS_DIR", "MSPACMAN_TEST_HMAC_NEXT_CANDIDATE_DIR"]) {
            withLinkedDirectory((fixture) => {
                process.env[name] = fixture.managedRoot;
                assert.throws(
                    () => assertSafeReleaseMutationPath(join(fixture.linkPath, "nested"), `${name} linked child`),
                    /symlink|junction|physically escapes/
                );
                assert.equal(readFileSync(fixture.sentinelPath, "utf8"), "external sentinel\n");
                delete process.env[name];
            });
        }
    });

    await runTest("release secrets directory rejects linked roots before key paths are returned", () => {
        withLinkedDirectory((fixture) => {
            process.env.MSPACMAN_TEST_RELEASE_SECRETS_DIR = fixture.linkPath;
            assert.throws(() => getReleaseSecretPaths(), /symlink|junction/);
            assert.equal(readFileSync(fixture.sentinelPath, "utf8"), "external sentinel\n");
            delete process.env.MSPACMAN_TEST_RELEASE_SECRETS_DIR;
        });
    });

    await runTest("generated file mutations reject linked destination files", () => {
        const externalRoot = mkdtempSync(join(tmpdir(), "mspacman-linked-release-file-"));
        const releaseZip = join(releasesDir, `mspacman-linked-destination-${process.pid}.zip`);
        const sentinelPath = join(externalRoot, "sentinel.zip");
        try {
            mkdirSync(releasesDir, { recursive: true });
            writeFileSync(sentinelPath, "SAFE\n");
            try {
                symlinkSync(sentinelPath, releaseZip, "file");
            } catch (error) {
                console.log(`ok - file link creation unavailable; skipped assertion (${error.code ?? "unknown"})`);
                return;
            }

            assert.throws(() => assertSafeGeneratedFileMutationPath(releaseZip, "desktop release ZIP"), /symlink|junction/);
            assert.equal(readFileSync(sentinelPath, "utf8"), "SAFE\n");
        } finally {
            rmSync(releaseZip, { force: true });
            rmSync(externalRoot, { recursive: true, force: true });
        }
    });

    await runTest("strict release file walker rejects linked roots", () => {
        withLinkedDirectory((fixture) => {
            assert.throws(() => listFilesStrict(fixture.linkPath, "linked release tree"), /root must not be a symlink|junction/);
            assert.equal(readFileSync(fixture.sentinelPath, "utf8"), "external sentinel\n");
        });
    });

    await runTest("strict release file walker rejects broken linked roots when the platform permits them", () => {
        const root = mkdtempSync(join(tmpdir(), "mspacman-broken-link-root-"));
        const linkPath = join(root, "broken-link");
        try {
            try {
                symlinkSync(join(root, "missing-target"), linkPath, "dir");
            } catch (error) {
                console.log(`ok - broken symlink creation unavailable; skipped assertion (${error.code ?? "unknown"})`);
                return;
            }
            assert.throws(() => listFilesStrict(linkPath, "broken release tree"), /root must not be a symlink|junction/);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    await runTest("atomic file copies replace regular files without temporary leftovers", () => {
        const dir = mkdtempSync(join(tmpdir(), "mspacman-atomic-copy-"));
        const source = join(dir, "source.zip");
        const destination = join(dir, "destination.zip");
        try {
            writeFileSync(source, "NEW\n");
            writeFileSync(destination, "OLD\n");
            copyFileAtomically(source, destination);
            assert.equal(readFileSync(destination, "utf8"), "NEW\n");
            assert.deepEqual(
                readdirSync(dir).filter((entry) => entry.includes(".tmp-")),
                [],
                "atomic copy must not leave a temporary file behind."
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    await runTest("atomic text writes remove temporary files after pre-rename failures", () => {
        for (const phase of ["after-create", "after-write", "after-fsync", "before-rename"]) {
            const dir = mkdtempSync(join(tmpdir(), "mspacman-atomic-write-"));
            const path = join(dir, "secret.hex");
            try {
                process.env.MSPACMAN_TEST_FAIL_ATOMIC_WRITE_PHASE = phase;
                assert.throws(() => writeTextFileAtomically(path, "secret-value\n"), /Injected atomic write failure/);
                assert.equal(existsSync(path), false, `${phase} must not leave the target file behind.`);
                assert.deepEqual(
                    readdirSync(dir).filter((entry) => entry.includes(".tmp-")),
                    [],
                    `${phase} must not leave a temporary file behind.`
                );
            } finally {
                delete process.env.MSPACMAN_TEST_FAIL_ATOMIC_WRITE_PHASE;
                rmSync(dir, { recursive: true, force: true });
            }
        }
    });

    await runTest("atomic text writes leave no temporary file after post-rename failure", () => {
        const dir = mkdtempSync(join(tmpdir(), "mspacman-atomic-write-"));
        const path = join(dir, "secret.hex");
        try {
            process.env.MSPACMAN_TEST_FAIL_ATOMIC_WRITE_PHASE = "after-rename";
            assert.throws(() => writeTextFileAtomically(path, "secret-value\n"), /Injected atomic write failure/);
            assert.equal(readFileSync(path, "utf8"), "secret-value\n");
            assert.deepEqual(
                readdirSync(dir).filter((entry) => entry.includes(".tmp-")),
                [],
                "post-rename failure must not leave a temporary file behind."
            );
        } finally {
            delete process.env.MSPACMAN_TEST_FAIL_ATOMIC_WRITE_PHASE;
            rmSync(dir, { recursive: true, force: true });
        }
    });
} finally {
    restoreEnv(originalEnv);
}

function withLinkedDirectory(fn) {
    const root = mkdtempSync(join(tmpdir(), "mspacman-link-root-"));
    const externalRoot = mkdtempSync(join(tmpdir(), "mspacman-link-external-"));
    const managedRoot = join(root, "managed");
    const linkPath = join(managedRoot, "linked");
    const sentinelPath = join(externalRoot, "sentinel.txt");
    try {
        mkdirSync(managedRoot, { recursive: true });
        writeFileSync(sentinelPath, "external sentinel\n");
        try {
            symlinkSync(externalRoot, linkPath, process.platform === "win32" ? "junction" : "dir");
        } catch (error) {
            console.log(`ok - directory link creation unavailable; skipped assertion (${error.code ?? "unknown"})`);
            return;
        }
        fn({
            externalRoot,
            linkPath,
            managedRoot,
            sentinelPath
        });
    } finally {
        rmSync(root, { recursive: true, force: true });
        rmSync(externalRoot, { recursive: true, force: true });
    }
}

function snapshotEnv() {
    return {
        MSPACMAN_ENABLE_TEST_PATH_OVERRIDES: process.env.MSPACMAN_ENABLE_TEST_PATH_OVERRIDES,
        MSPACMAN_TEST_DIST_DIR: process.env.MSPACMAN_TEST_DIST_DIR,
        MSPACMAN_TEST_FAIL_ATOMIC_WRITE_PHASE: process.env.MSPACMAN_TEST_FAIL_ATOMIC_WRITE_PHASE,
        MSPACMAN_TEST_HMAC_NEXT_CANDIDATE_DIR: process.env.MSPACMAN_TEST_HMAC_NEXT_CANDIDATE_DIR,
        MSPACMAN_TEST_RELEASE_COMPONENTS_DIR: process.env.MSPACMAN_TEST_RELEASE_COMPONENTS_DIR,
        MSPACMAN_TEST_RELEASE_SECRETS_DIR: process.env.MSPACMAN_TEST_RELEASE_SECRETS_DIR
    };
}

function restoreEnv(snapshot) {
    for (const [name, value] of Object.entries(snapshot)) {
        if (value === undefined) {
            delete process.env[name];
        } else {
            process.env[name] = value;
        }
    }
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
