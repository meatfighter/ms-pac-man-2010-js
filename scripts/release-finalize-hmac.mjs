import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { assertGitWorkingTreeClean, distDir, getGitHeadCommit, hmacNextCandidateDir, rootDir } from "./build-utils.mjs";
import { checkRotationKeys, promoteNextKey } from "./hmac-config.mjs";

try {
    if (process.env.MSPACMAN_RELEASE_ALLOW_DIRTY !== "1") {
        assertGitWorkingTreeClean();
    }

    const fingerprints = checkRotationKeys();
    const releaseMetadataPath = join(hmacNextCandidateDir, "release.json");
    assert.ok(existsSync(releaseMetadataPath), `Next-key release candidate is missing release.json: ${releaseMetadataPath}`);

    const metadata = JSON.parse(readFileSync(releaseMetadataPath, "utf8"));
    assert.equal(metadata.hmacKeyFingerprint, fingerprints.nextFingerprint, "Candidate release fingerprint must match the staged next HMAC key.");
    assert.equal(metadata.gitCommit, getGitHeadCommit(), "Candidate release commit must match the current clean checkout.");
    assert.equal(metadata.gitTreeState, "clean", "Candidate release must have been built from clean committed source.");
    assert.equal(metadata.source?.archiveIncludesCommittedSourceOnly, true, "Candidate release must use a committed-source-only source archive.");

    runVerifyCandidate();
    promoteCandidateAndKey();
    console.log(`Finalized HMAC rotation.`);
    console.log(`Previous key fingerprint: ${fingerprints.activeFingerprint}`);
    console.log(`Active key fingerprint: ${fingerprints.nextFingerprint}`);
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("HMAC rotation finalize failed. The full keys were not printed.");
    process.exitCode = 1;
}

function runVerifyCandidate() {
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

function promoteCandidateAndKey() {
    const backupDir = join(dirname(distDir), `.${basename(distDir)}-active-before-hmac-finalize-${process.pid}-${Date.now()}`);
    let movedExistingDist = false;
    let installedCandidate = false;
    let promotedKey = false;

    try {
        rmSync(backupDir, { recursive: true, force: true });
        if (existsSync(distDir)) {
            renameSync(distDir, backupDir);
            movedExistingDist = true;
        }
        renameSync(hmacNextCandidateDir, distDir);
        installedCandidate = true;
        promoteNextKey({
            failStage: process.env.MSPACMAN_TEST_FAIL_HMAC_PROMOTE_STAGE
        });
        promotedKey = true;
        try {
            rmSync(backupDir, { recursive: true, force: true });
        } catch (error) {
            console.warn(`Warning: finalized rotation but old dist backup could not be removed: ${backupDir}`);
            console.warn(error instanceof Error ? error.message : String(error));
        }
    } catch (error) {
        if (!promotedKey) {
            if (installedCandidate && existsSync(distDir) && !existsSync(hmacNextCandidateDir)) {
                renameSync(distDir, hmacNextCandidateDir);
            }
            if (movedExistingDist && !existsSync(distDir) && existsSync(backupDir)) {
                renameSync(backupDir, distDir);
            }
        }
        throw error;
    }
}
