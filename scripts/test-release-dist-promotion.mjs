import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { getDistPromotionTransactionFile } from "./release-dist-promotion.mjs";
import { rootDir } from "./build-utils.mjs";

const originalEnv = snapshotEnv();

try {
    process.env.MSPACMAN_ENABLE_TEST_PATH_OVERRIDES = "1";

    await runTest("ordinary full-release promotion recovers pre-commit exits to the old release", () => {
        for (const stage of ["journal-prepared", "old-moved"]) {
            withPromotionFixture((fixture) => {
                const first = runPromotion(fixture, {
                    MSPACMAN_TEST_EXIT_DIST_PROMOTION_STAGE: stage
                });
                assert.equal(first.status, 97, formatFailure(`Expected promotion exit at ${stage}.`, first));
                const recovery = runRecovery(fixture);
                assert.equal(recovery.status, 0, formatFailure(`Expected recovery after ${stage}.`, recovery));
                assert.equal(readDistSentinel(fixture), "old\n", `${stage} should recover the previous release.`);
                assert.equal(existsSync(fixture.pendingDir), false, `${stage} should remove pending output.`);
                assert.equal(existsSync(getDistPromotionTransactionFile()), false, `${stage} should remove transaction journal.`);
            });
        }
    });

    await runTest("ordinary full-release promotion recovers post-commit exits to the new release", () => {
        for (const stage of ["new-installed-before-journal", "new-installed"]) {
            withPromotionFixture((fixture) => {
                const first = runPromotion(fixture, {
                    MSPACMAN_TEST_EXIT_DIST_PROMOTION_STAGE: stage
                });
                assert.equal(first.status, 97, formatFailure(`Expected promotion exit at ${stage}.`, first));
                const recovery = runRecovery(fixture);
                assert.equal(recovery.status, 0, formatFailure(`Expected recovery after ${stage}.`, recovery));
                assert.equal(readDistSentinel(fixture), "new\n", `${stage} should keep the committed release.`);
                assert.equal(existsSync(fixture.pendingDir), false, `${stage} should leave no pending output.`);
                assert.equal(existsSync(getDistPromotionTransactionFile()), false, `${stage} should remove transaction journal.`);
            });
        }
    });

    await runTest("post-commit journal failure preserves cleanup transaction for recovery", () => {
        withPromotionFixture((fixture) => {
            const first = runPromotion(fixture, {
                MSPACMAN_TEST_FAIL_ATOMIC_WRITE_PHASE: "dist-promotion-journal-new-installed"
            });
            assert.equal(first.status, 0, formatFailure("Committed promotion with cleanup pending should report success.", first));
            assert.equal(readDistSentinel(fixture), "new\n");
            assert.equal(existsSync(getDistPromotionTransactionFile()), true, "Cleanup-pending transaction must remain for recovery.");

            const recovery = runRecovery(fixture);
            assert.equal(recovery.status, 0, formatFailure("Expected cleanup-pending recovery to succeed.", recovery));
            assert.equal(readDistSentinel(fixture), "new\n");
            assert.equal(existsSync(getDistPromotionTransactionFile()), false);
        });
    });

    await runTest("ordinary full-release promotion rejects unknown transaction destinations", () => {
        withPromotionFixture((fixture) => {
            const externalRoot = mkdtempSync(join(tmpdir(), "mspacman-promotion-external-"));
            const externalDist = join(externalRoot, "dist");
            const externalSentinel = join(externalRoot, "sentinel.txt");
            try {
                mkdirSync(externalDist, { recursive: true });
                writeFileSync(externalSentinel, "external\n");
                writeFileSync(
                    getDistPromotionTransactionFile(),
                    `${JSON.stringify(
                        {
                            backupPath: join(externalRoot, ".dist-previous-test"),
                            distPath: externalDist,
                            pendingPath: join(externalRoot, ".dist-pending-test"),
                            phase: "prepared",
                            schemaVersion: 1
                        },
                        null,
                        4
                    )}\n`
                );
                const recovery = runRecovery(fixture);
                assert.notEqual(recovery.status, 0, "Unknown promotion transaction destination must fail recovery.");
                assertOutputIncludes(recovery, "not an allowed full-release output path");
                assert.equal(readFileSync(externalSentinel, "utf8"), "external\n");
            } finally {
                rmSync(externalRoot, { recursive: true, force: true });
                rmSync(getDistPromotionTransactionFile(), { force: true });
            }
        });
    });
} finally {
    restoreEnv(originalEnv);
}

function withPromotionFixture(fn) {
    const stateRoot = mkdtempSync(join(tmpdir(), "mspacman-promotion-state-"));
    const secretsDir = join(stateRoot, "secrets");
    const finalDir = join(stateRoot, "synthetic-full");
    const pendingDir = join(stateRoot, ".synthetic-full-pending-test");
    try {
        process.env.MSPACMAN_TEST_RELEASE_COMPONENTS_DIR = stateRoot;
        process.env.MSPACMAN_TEST_RELEASE_SECRETS_DIR = secretsDir;
        mkdirSync(finalDir, { recursive: true });
        mkdirSync(pendingDir, { recursive: true });
        mkdirSync(secretsDir, { recursive: true });
        writeFileSync(join(finalDir, "sentinel.txt"), "old\n");
        writeFileSync(join(pendingDir, "sentinel.txt"), "new\n");
        fn({
            finalDir,
            pendingDir,
            secretsDir,
            stateRoot
        });
    } finally {
        delete process.env.MSPACMAN_TEST_RELEASE_COMPONENTS_DIR;
        delete process.env.MSPACMAN_TEST_RELEASE_SECRETS_DIR;
        rmSync(stateRoot, { recursive: true, force: true });
    }
}

function runPromotion(fixture, extraEnv = {}) {
    return runModule(
        [
            'import { promoteFullDist } from "./scripts/release-dist-promotion.mjs";',
            "promoteFullDist(process.env.MSPACMAN_TEST_PENDING_DIR, process.env.MSPACMAN_TEST_FINAL_DIR);"
        ].join(""),
        fixture,
        extraEnv
    );
}

function runRecovery(fixture, extraEnv = {}) {
    return runModule(
        'import { recoverAnyInterruptedFullDistPromotion } from "./scripts/release-dist-promotion.mjs"; recoverAnyInterruptedFullDistPromotion();',
        fixture,
        extraEnv
    );
}

function runModule(source, fixture, extraEnv) {
    return spawnSync(process.execPath, ["--input-type=module", "-e", source], {
        cwd: rootDir,
        encoding: "utf8",
        env: {
            ...process.env,
            ...extraEnv,
            MSPACMAN_ENABLE_TEST_PATH_OVERRIDES: "1",
            MSPACMAN_TEST_FINAL_DIR: fixture.finalDir,
            MSPACMAN_TEST_PENDING_DIR: fixture.pendingDir,
            MSPACMAN_TEST_RELEASE_COMPONENTS_DIR: fixture.stateRoot,
            MSPACMAN_TEST_RELEASE_SECRETS_DIR: fixture.secretsDir
        },
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true
    });
}

function readDistSentinel(fixture) {
    return readFileSync(join(fixture.finalDir, "sentinel.txt"), "utf8");
}

function snapshotEnv() {
    return {
        MSPACMAN_ENABLE_TEST_PATH_OVERRIDES: process.env.MSPACMAN_ENABLE_TEST_PATH_OVERRIDES,
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

function assertOutputIncludes(result, text) {
    assert.ok(`${result.stdout}\n${result.stderr}`.includes(text), `Expected output to include ${JSON.stringify(text)}.`);
}

function formatFailure(message, result) {
    return [message, "stdout:", result.stdout, "stderr:", result.stderr, "error:", result.error?.message ?? "", "status:", String(result.status)].join("\n");
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
