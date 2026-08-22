import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { assertGitWorkingTreeClean, distDir, getGitHeadCommit, getHmacNextCandidateDir, rootDir } from "./build-utils.mjs";
import { checkRotationKeys, getHmacFingerprint, getReleaseSecretPaths, promoteNextKey, readKeyFile, writeKeyFile } from "./hmac-config.mjs";

const TRANSACTION_FILE_NAME = "hmac-finalize-transaction.json";

try {
    assertGitWorkingTreeClean();

    const transaction = readFinalizeTransactionIfPresent();
    if (transaction !== null) {
        recoverFinalizeTransaction(transaction);
        console.log(`Recovered interrupted HMAC rotation finalize.`);
        console.log(`Previous key fingerprint: ${transaction.activeFingerprint}`);
        console.log(`Active key fingerprint: ${transaction.nextFingerprint}`);
        process.exit(0);
    }

    const fingerprints = checkRotationKeys();
    const hmacNextCandidateDir = getHmacNextCandidateDir();
    const releaseMetadataPath = join(hmacNextCandidateDir, "release.json");
    assert.ok(existsSync(releaseMetadataPath), `Next-key release candidate is missing release.json: ${releaseMetadataPath}`);

    const metadata = JSON.parse(readFileSync(releaseMetadataPath, "utf8"));
    assert.equal(metadata.hmacKeyFingerprint, fingerprints.nextFingerprint, "Candidate release fingerprint must match the staged next HMAC key.");
    assert.equal(metadata.hmacKeySource, "next", "Candidate release key source must be next.");
    assert.equal(metadata.releaseKind, "rotation-candidate", "Candidate release kind must be rotation-candidate.");
    assert.equal(metadata.gitCommit, getGitHeadCommit(), "Candidate release commit must match the current clean checkout.");
    assert.equal(metadata.gitTreeState, "clean", "Candidate release must have been built from clean committed source.");
    assert.equal(metadata.source?.archiveIncludesCommittedSourceOnly, true, "Candidate release must use a committed-source-only source archive.");

    runVerifyCandidate(hmacNextCandidateDir);
    promoteCandidateAndKey(hmacNextCandidateDir, fingerprints);
    console.log(`Finalized HMAC rotation.`);
    console.log(`Previous key fingerprint: ${fingerprints.activeFingerprint}`);
    console.log(`Active key fingerprint: ${fingerprints.nextFingerprint}`);
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("HMAC rotation finalize failed. The full keys were not printed.");
    process.exitCode = 1;
}

function runVerifyCandidate(hmacNextCandidateDir) {
    const result = spawnSync(process.execPath, ["scripts/verify-release.mjs", "--key-source=next"], {
        cwd: rootDir,
        env: {
            ...process.env,
            MSPACMAN_DIST_DIR: hmacNextCandidateDir,
            MSPACMAN_RELEASE_VERIFY_TARGET: "full"
        },
        stdio: "inherit",
        windowsHide: true
    });
    if (result.status !== 0 || result.error) {
        throw result.error ?? new Error("Next-key candidate release verification failed.");
    }
}

function promoteCandidateAndKey(hmacNextCandidateDir, fingerprints) {
    const backupDir = join(dirname(distDir), `.${basename(distDir)}-active-before-hmac-finalize-${process.pid}-${Date.now()}`);
    let movedExistingDist = false;
    let installedCandidate = false;
    let promotedKey = false;
    const transaction = createFinalizeTransaction(hmacNextCandidateDir, backupDir, fingerprints);

    try {
        writeFinalizeTransaction(transaction);
        rmSync(backupDir, { recursive: true, force: true });
        if (existsSync(distDir)) {
            renameSync(distDir, backupDir);
            movedExistingDist = true;
        }
        renameSync(hmacNextCandidateDir, distDir);
        installedCandidate = true;
        writeFinalizeTransaction({
            ...transaction,
            phase: "dist-promoted"
        });
        maybeExitFinalizeStage("after-candidate-install");
        promoteNextKey({
            exitStage: process.env.MSPACMAN_TEST_EXIT_HMAC_FINALIZE_STAGE,
            failStage: process.env.MSPACMAN_TEST_FAIL_HMAC_PROMOTE_STAGE
        });
        promotedKey = true;
        writeFinalizeTransaction({
            ...transaction,
            phase: "key-promoted"
        });
        maybeExitFinalizeStage("after-key-promoted");
        try {
            rmSync(backupDir, { recursive: true, force: true });
        } catch (error) {
            console.warn(`Warning: finalized rotation but old dist backup could not be removed: ${backupDir}`);
            console.warn(error instanceof Error ? error.message : String(error));
        }
        removeFinalizeTransaction();
    } catch (error) {
        if (!promotedKey) {
            if (installedCandidate && existsSync(distDir) && !existsSync(hmacNextCandidateDir)) {
                renameSync(distDir, hmacNextCandidateDir);
            }
            if (movedExistingDist && !existsSync(distDir) && existsSync(backupDir)) {
                renameSync(backupDir, distDir);
            }
        }
        removeFinalizeTransaction();
        throw error;
    }
}

function createFinalizeTransaction(candidatePath, backupPath, fingerprints) {
    return {
        activeFingerprint: fingerprints.activeFingerprint,
        backupPath,
        candidatePath,
        distPath: distDir,
        gitCommit: getGitHeadCommit(),
        nextFingerprint: fingerprints.nextFingerprint,
        phase: "prepared",
        schemaVersion: 1
    };
}

function recoverFinalizeTransaction(transaction) {
    validateFinalizeTransaction(transaction);
    ensureCandidateInstalled(transaction);
    writeFinalizeTransaction({
        ...transaction,
        phase: "dist-promoted"
    });
    completeKeyPromotion(transaction);
    writeFinalizeTransaction({
        ...transaction,
        phase: "key-promoted"
    });
    cleanupFinalizeTransaction(transaction);
}

function ensureCandidateInstalled(transaction) {
    if (releaseDirHasFingerprint(transaction.distPath, transaction.nextFingerprint)) {
        return;
    }
    if (!existsSync(transaction.candidatePath)) {
        throw new Error("Interrupted HMAC finalize cannot recover because neither dist nor the candidate contains the next-key release.");
    }
    if (existsSync(transaction.distPath) && !existsSync(transaction.backupPath)) {
        renameSync(transaction.distPath, transaction.backupPath);
    }
    renameSync(transaction.candidatePath, transaction.distPath);
    if (!releaseDirHasFingerprint(transaction.distPath, transaction.nextFingerprint)) {
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

function cleanupFinalizeTransaction(transaction) {
    rmSync(transaction.candidatePath, { recursive: true, force: true });
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
    const path = getFinalizeTransactionPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(transaction, null, 4)}\n`, { mode: 0o600 });
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
    assert.equal(transaction.distPath, distDir, "HMAC finalize transaction dist path must match the configured dist path.");
}

function maybeExitFinalizeStage(stage) {
    if (process.env.MSPACMAN_TEST_EXIT_HMAC_FINALIZE_STAGE === stage) {
        process.exit(97);
    }
}
