import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
    assertGitWorkingTreeClean,
    assertSafeReleaseMutationPath,
    getGitHeadCommit,
    getHmacNextCandidateDir,
    getReleaseDistDir,
    pathsEqual,
    rootDir
} from "./build-utils.mjs";
import { acquireReleaseLock } from "./release-lock.mjs";
import { writeTextFileAtomically } from "./release-io.mjs";
import { checkRotationKeys, getHmacFingerprint, getReleaseSecretPaths, promoteNextKey, readKeyFile, writeKeyFile } from "./hmac-config.mjs";

const TRANSACTION_FILE_NAME = "hmac-finalize-transaction.json";
const FINGERPRINT_PATTERN = /^[0-9a-f]{12}$/;
const GIT_COMMIT_PATTERN = /^[0-9a-f]{40,64}$/;

const releaseDistDir = getReleaseDistDir();
const hmacNextCandidateDir = getHmacNextCandidateDir();
const releaseLock = acquireReleaseLock("release:finalize-hmac");

try {
    assertGitWorkingTreeClean();

    const transaction = readFinalizeTransactionIfPresent();
    if (transaction !== null) {
        recoverFinalizeTransaction(transaction);
        console.log("Recovered interrupted HMAC rotation finalize.");
        console.log(`Previous key fingerprint: ${transaction.activeFingerprint}`);
        console.log(`Active key fingerprint: ${transaction.nextFingerprint}`);
    } else {
        const fingerprints = checkRotationKeys();
        validateCandidateMetadata(fingerprints);
        runVerifyCandidate(hmacNextCandidateDir);
        promoteCandidateAndKey(fingerprints);
        console.log("Finalized HMAC rotation.");
        console.log(`Previous key fingerprint: ${fingerprints.activeFingerprint}`);
        console.log(`Active key fingerprint: ${fingerprints.nextFingerprint}`);
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("HMAC rotation finalize failed. The full keys were not printed.");
    process.exitCode = 1;
} finally {
    releaseLock();
}

function validateCandidateMetadata(fingerprints) {
    const releaseMetadataPath = join(hmacNextCandidateDir, "release.json");
    assert.ok(existsSync(releaseMetadataPath), `Next-key release candidate is missing release.json: ${releaseMetadataPath}`);

    const metadata = JSON.parse(readFileSync(releaseMetadataPath, "utf8"));
    assert.equal(metadata.hmacKeyFingerprint, fingerprints.nextFingerprint, "Candidate release fingerprint must match the staged next HMAC key.");
    assert.equal(metadata.hmacKeySource, "next", "Candidate release key source must be next.");
    assert.equal(metadata.releaseKind, "rotation-candidate", "Candidate release kind must be rotation-candidate.");
    assert.equal(metadata.gitCommit, getGitHeadCommit(), "Candidate release commit must match the current clean checkout.");
    assert.equal(metadata.gitTreeState, "clean", "Candidate release must have been built from clean committed source.");
}

function runVerifyCandidate(candidateDir) {
    runVerifyRelease(candidateDir, readKeyFile(getReleaseSecretPaths().next, "Next HMAC key"), getGitHeadCommit());
}

function promoteCandidateAndKey(fingerprints) {
    const backupDir = join(dirname(releaseDistDir), `.${basename(releaseDistDir)}-active-before-hmac-finalize-${process.pid}-${Date.now()}`);
    const transaction = createFinalizeTransaction(backupDir, fingerprints);
    let movedExistingDist = false;
    let installedCandidate = false;

    try {
        writeFinalizeTransaction(transaction);
        assertSafeReleaseMutationPath(backupDir, "HMAC finalize backup directory");
        rmSync(backupDir, { recursive: true, force: true });
        if (existsSync(releaseDistDir)) {
            renameSync(releaseDistDir, backupDir);
            movedExistingDist = true;
        }
        renameSync(hmacNextCandidateDir, releaseDistDir);
        installedCandidate = true;
        writeFinalizeTransaction({
            ...transaction,
            phase: "dist-promoted"
        });
        maybeExitFinalizeStage("after-candidate-install");
        verifyRecoveredRelease(transaction);
        promoteNextKey({
            exitStage: process.env.MSPACMAN_TEST_EXIT_HMAC_FINALIZE_STAGE,
            failStage: process.env.MSPACMAN_TEST_FAIL_HMAC_PROMOTE_STAGE,
            preserveTempsOnError: true
        });
        writeFinalizeTransaction({
            ...transaction,
            phase: "key-promoted"
        });
        maybeExitFinalizeStage("after-key-promoted");
        cleanupFinalizeTransaction(transaction);
    } catch (error) {
        if (tryRollbackCandidatePromotion(transaction, { installedCandidate, movedExistingDist })) {
            removeFinalizeTransaction();
        }
        throw error;
    }
}

function createFinalizeTransaction(backupPath, fingerprints) {
    return {
        activeFingerprint: fingerprints.activeFingerprint,
        backupPath,
        candidatePath: hmacNextCandidateDir,
        distPath: releaseDistDir,
        gitCommit: getGitHeadCommit(),
        nextFingerprint: fingerprints.nextFingerprint,
        phase: "prepared",
        schemaVersion: 1
    };
}

function recoverFinalizeTransaction(transaction) {
    validateFinalizeTransaction(transaction);
    assert.equal(transaction.gitCommit, getGitHeadCommit(), "Interrupted finalization must be recovered from the same Git commit.");
    ensureCandidateInstalled(transaction);
    writeFinalizeTransaction({
        ...transaction,
        phase: "dist-promoted"
    });
    verifyRecoveredRelease(transaction);
    completeKeyPromotion(transaction);
    writeFinalizeTransaction({
        ...transaction,
        phase: "key-promoted"
    });
    cleanupFinalizeTransaction(transaction);
}

function ensureCandidateInstalled(transaction) {
    if (releaseDirHasFingerprint(releaseDistDir, transaction.nextFingerprint)) {
        return;
    }
    if (!existsSync(hmacNextCandidateDir)) {
        throw new Error("Interrupted HMAC finalize cannot recover because neither dist nor the candidate contains the next-key release.");
    }
    if (existsSync(releaseDistDir) && !existsSync(transaction.backupPath)) {
        renameSync(releaseDistDir, transaction.backupPath);
    }
    renameSync(hmacNextCandidateDir, releaseDistDir);
    if (!releaseDirHasFingerprint(releaseDistDir, transaction.nextFingerprint)) {
        throw new Error("Recovered HMAC finalize dist does not contain the expected next-key release.");
    }
}

function completeKeyPromotion(transaction) {
    const paths = getReleaseSecretPaths();
    const activeKey = readKeyFile(paths.active, "Active HMAC key");
    const activeFingerprint = getHmacFingerprint(activeKey);
    if (activeFingerprint === transaction.nextFingerprint) {
        ensurePreviousKeyAfterInterruptedPromotion(transaction);
        if (existsSync(paths.next)) {
            const nextKey = readKeyFile(paths.next, "Next HMAC key");
            assert.equal(getHmacFingerprint(nextKey), transaction.nextFingerprint, "Interrupted finalize next key must match the transaction.");
            rmSync(paths.next, { force: true });
        }
        cleanupHmacPromotionTempFiles(paths.dir);
        return;
    }

    assert.equal(activeFingerprint, transaction.activeFingerprint, "Active key fingerprint does not match interrupted finalize transaction.");
    const nextKey = readKeyFile(paths.next, "Next HMAC key");
    assert.equal(getHmacFingerprint(nextKey), transaction.nextFingerprint, "Next key fingerprint does not match interrupted finalize transaction.");
    promoteNextKey();
}

function ensurePreviousKeyAfterInterruptedPromotion(transaction) {
    const paths = getReleaseSecretPaths();
    if (existsSync(paths.previous)) {
        const previousKey = readKeyFile(paths.previous, "Previous HMAC key");
        assert.equal(
            getHmacFingerprint(previousKey),
            transaction.activeFingerprint,
            "Previous key fingerprint does not match interrupted finalize transaction."
        );
        return;
    }

    for (const candidatePath of [join(paths.dir, "ms-pac-man-2010-hmac.previous.hex.promote"), join(paths.dir, "ms-pac-man-2010-hmac.hex.rollback")]) {
        if (!existsSync(candidatePath)) {
            continue;
        }
        const candidateKey = readKeyFile(candidatePath, "Interrupted previous HMAC key");
        if (getHmacFingerprint(candidateKey) === transaction.activeFingerprint) {
            writeKeyFile(paths.previous, candidateKey);
            return;
        }
    }

    throw new Error("Interrupted HMAC finalize cannot recover the previous active key.");
}

function tryRollbackCandidatePromotion(transaction, state) {
    const paths = getReleaseSecretPaths();
    try {
        const activeKey = readKeyFile(paths.active, "Active HMAC key");
        if (getHmacFingerprint(activeKey) !== transaction.activeFingerprint) {
            return false;
        }
        const nextKey = readKeyFile(paths.next, "Next HMAC key");
        if (getHmacFingerprint(nextKey) !== transaction.nextFingerprint) {
            return false;
        }
        if (state.installedCandidate && existsSync(releaseDistDir) && !existsSync(hmacNextCandidateDir)) {
            renameSync(releaseDistDir, hmacNextCandidateDir);
        }
        if (state.movedExistingDist && !existsSync(releaseDistDir) && existsSync(transaction.backupPath)) {
            renameSync(transaction.backupPath, releaseDistDir);
        }
        const verifiedActiveKey = readKeyFile(paths.active, "Active HMAC key");
        const verifiedNextKey = readKeyFile(paths.next, "Next HMAC key");
        assert.equal(getHmacFingerprint(verifiedActiveKey), transaction.activeFingerprint);
        assert.equal(getHmacFingerprint(verifiedNextKey), transaction.nextFingerprint);
        return true;
    } catch {
        return false;
    }
}

function verifyRecoveredRelease(transaction) {
    runVerifyRelease(releaseDistDir, readRecoveryKey(transaction), transaction.gitCommit);
}

function readRecoveryKey(transaction) {
    const paths = getReleaseSecretPaths();
    if (existsSync(paths.next)) {
        const next = readKeyFile(paths.next, "Next HMAC key");
        assert.equal(getHmacFingerprint(next), transaction.nextFingerprint, "Recovery next key must match the transaction.");
        return next;
    }

    const active = readKeyFile(paths.active, "Active HMAC key");
    assert.equal(getHmacFingerprint(active), transaction.nextFingerprint, "Neither next nor active contains the transaction next key.");
    return active;
}

function runVerifyRelease(releaseDir, keyHex, gitCommit) {
    const result = spawnSync(
        process.execPath,
        ["scripts/verify-release.mjs", "--key-source=env", "--expected-release-kind=rotation-candidate", "--expected-hmac-key-source=next"],
        {
            cwd: rootDir,
            encoding: "utf8",
            env: {
                ...process.env,
                MSPACMAN_HMAC_KEY_HEX: keyHex,
                MSPACMAN_INTERNAL_DIST_DIR: releaseDir,
                MSPACMAN_INTERNAL_RELEASE_BUILD: "1",
                MSPACMAN_RELEASE_GIT_COMMIT: gitCommit,
                MSPACMAN_RELEASE_VERIFY_TARGET: "full"
            },
            maxBuffer: 96 * 1024 * 1024,
            windowsHide: true
        }
    );
    if (result.status !== 0 || result.error) {
        throw result.error ?? new Error(formatVerifyReleaseFailure(result));
    }
    if (result.stdout) {
        process.stdout.write(result.stdout);
    }
    if (result.stderr) {
        process.stderr.write(result.stderr);
    }
}

function formatVerifyReleaseFailure(result) {
    return [
        "Rotation release verification failed.",
        result.stdout === "" ? "" : `stdout:\n${result.stdout.trimEnd()}`,
        result.stderr === "" ? "" : `stderr:\n${result.stderr.trimEnd()}`
    ]
        .filter(Boolean)
        .join("\n");
}

function cleanupFinalizeTransaction(transaction) {
    rmSync(hmacNextCandidateDir, { recursive: true, force: true });
    rmSync(transaction.backupPath, { recursive: true, force: true });
    cleanupHmacPromotionTempFiles(getReleaseSecretPaths().dir);
    removeFinalizeTransaction();
}

function cleanupHmacPromotionTempFiles(secretsDir) {
    for (const name of ["ms-pac-man-2010-hmac.hex.rollback", "ms-pac-man-2010-hmac.hex.promote", "ms-pac-man-2010-hmac.previous.hex.promote"]) {
        rmSync(join(secretsDir, name), { force: true });
    }
}

function releaseDirHasFingerprint(releaseDir, fingerprint) {
    const releaseMetadataPath = join(releaseDir, "release.json");
    if (!existsSync(releaseMetadataPath)) {
        return false;
    }
    const metadata = JSON.parse(readFileSync(releaseMetadataPath, "utf8"));
    return metadata.hmacKeyFingerprint === fingerprint;
}

function readFinalizeTransactionIfPresent() {
    const path = getFinalizeTransactionPath();
    if (!existsSync(path)) {
        return null;
    }
    return JSON.parse(readFileSync(path, "utf8"));
}

function writeFinalizeTransaction(transaction) {
    maybeFailFinalizeJournalWrite(transaction.phase);
    const path = getFinalizeTransactionPath();
    writeTextFileAtomically(path, `${JSON.stringify(transaction, null, 4)}\n`, {
        failPhase: `hmac-finalize-journal-${transaction.phase}`,
        mode: 0o600
    });
}

function removeFinalizeTransaction() {
    rmSync(getFinalizeTransactionPath(), { force: true });
}

function getFinalizeTransactionPath() {
    return join(getReleaseSecretPaths().dir, TRANSACTION_FILE_NAME);
}

function validateFinalizeTransaction(transaction) {
    assert.equal(transaction.schemaVersion, 1, "Unsupported HMAC finalize transaction schema.");
    assert.ok(["prepared", "dist-promoted", "key-promoted"].includes(transaction.phase), "Unsupported HMAC finalize transaction phase.");
    for (const key of ["activeFingerprint", "backupPath", "candidatePath", "distPath", "gitCommit", "nextFingerprint"]) {
        assert.equal(typeof transaction[key], "string", `HMAC finalize transaction must contain ${key}.`);
        assert.notEqual(transaction[key], "", `HMAC finalize transaction ${key} must not be empty.`);
    }
    assert.match(transaction.activeFingerprint, FINGERPRINT_PATTERN, "Transaction active fingerprint must be a 12-character lowercase hex fingerprint.");
    assert.match(transaction.nextFingerprint, FINGERPRINT_PATTERN, "Transaction next fingerprint must be a 12-character lowercase hex fingerprint.");
    assert.match(transaction.gitCommit, GIT_COMMIT_PATTERN, "Transaction Git commit must be a full hex commit id.");
    assert.ok(pathsEqual(transaction.distPath, releaseDistDir), "HMAC finalize transaction dist path must match the canonical release dist path.");
    assert.ok(
        pathsEqual(transaction.candidatePath, hmacNextCandidateDir),
        "HMAC finalize transaction candidate path must match the canonical next-key candidate path."
    );
    assert.ok(pathsEqual(dirname(transaction.backupPath), dirname(releaseDistDir)), "HMAC finalize transaction backup path must be next to dist.");
    assert.match(basename(transaction.backupPath), /^\.dist-active-before-hmac-finalize-\d+-\d+$/, "HMAC finalize backup path has an unexpected name.");
}

function maybeExitFinalizeStage(stage) {
    if (process.env.MSPACMAN_TEST_EXIT_HMAC_FINALIZE_STAGE === stage) {
        process.exit(97);
    }
}

function maybeFailFinalizeJournalWrite(phase) {
    if (process.env.MSPACMAN_TEST_FAIL_FINALIZE_JOURNAL_PHASE === phase) {
        throw new Error(`Injected journal write failure: ${phase}`);
    }
}
