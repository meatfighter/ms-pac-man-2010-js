import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { assertSafeReleaseMutationPath, getHmacNextCandidateDir, pathsEqual, releaseComponentsDir, repositoryDistDir } from "./build-utils.mjs";
import { getReleaseSecretPaths } from "./hmac-config.mjs";
import { writeTextFileAtomically } from "./release-io.mjs";

const VALID_PHASES = new Set(["prepared", "old-moved", "new-installed", "cleanup-pending"]);

export function recoverAnyInterruptedFullDistPromotion() {
    const transactionFile = getDistPromotionTransactionFile();
    if (!existsSync(transactionFile)) {
        return;
    }

    const transaction = JSON.parse(readFileSync(transactionFile, "utf8"));
    validateDistPromotionTransaction(transaction);

    switch (transaction.phase) {
        case "prepared":
            recoverPreparedPromotion(transaction);
            break;
        case "old-moved":
            recoverOldMovedPromotion(transaction);
            break;
        case "new-installed":
        case "cleanup-pending":
            recoverCommittedPromotion(transaction);
            break;
    }
}

export function promoteFullDist(sourceDir, finalDistDir) {
    const backupDir = join(dirname(finalDistDir), `.${basename(finalDistDir)}-previous-${process.pid}-${Date.now()}`);
    const transaction = {
        backupPath: backupDir,
        distPath: finalDistDir,
        pendingPath: sourceDir,
        phase: "prepared",
        schemaVersion: 1
    };
    let movedExistingDist = false;
    let installedNewDist = false;

    assertSafeReleaseMutationPath(sourceDir, "pending full release output");
    assertSafeReleaseMutationPath(finalDistDir, "final full release output");
    assertSafeReleaseMutationPath(backupDir, "full release backup output");

    try {
        writeDistPromotionTransaction(transaction);
        maybeExitDistPromotionStage("journal-prepared");

        rmSync(backupDir, { recursive: true, force: true });
        if (existsSync(finalDistDir)) {
            renameSync(finalDistDir, backupDir);
            movedExistingDist = true;
            writeDistPromotionTransaction({
                ...transaction,
                phase: "old-moved"
            });
        }
        maybeExitDistPromotionStage("old-moved");

        renameSync(sourceDir, finalDistDir);
        installedNewDist = true;
        maybeExitDistPromotionStage("new-installed-before-journal");

        try {
            writeDistPromotionTransaction({
                ...transaction,
                phase: "new-installed"
            });
            maybeExitDistPromotionStage("new-installed");
            rmSync(backupDir, { recursive: true, force: true });
            removeDistPromotionTransaction();
            return {
                cleanupComplete: true,
                committed: true
            };
        } catch (error) {
            preserveCommittedPromotionForRecovery(transaction, error);
            return {
                cleanupComplete: false,
                committed: true
            };
        }
    } catch (error) {
        if (!installedNewDist && movedExistingDist && !existsSync(finalDistDir) && existsSync(backupDir)) {
            renameSync(backupDir, finalDistDir);
        }
        throw error;
    }
}

export function getDistPromotionTransactionFile() {
    return join(getReleaseSecretPaths().dir, "dist-promotion-transaction.json");
}

export function isManagedFullReleaseDestination(path) {
    return [repositoryDistDir, join(releaseComponentsDir, "synthetic-full"), getHmacNextCandidateDir()].some((allowed) => pathsEqual(path, allowed));
}

function recoverPreparedPromotion(transaction) {
    if (!existsSync(transaction.distPath) && existsSync(transaction.backupPath)) {
        renameSync(transaction.backupPath, transaction.distPath);
    }
    removePendingIfPresent(transaction);
    removeBackupIfSafe(transaction);
    removeDistPromotionTransaction();
}

function recoverOldMovedPromotion(transaction) {
    if (existsSync(transaction.distPath) && existsSync(transaction.backupPath) && !existsSync(transaction.pendingPath)) {
        recoverCommittedPromotion(transaction);
        return;
    }

    if (!existsSync(transaction.distPath) && existsSync(transaction.backupPath)) {
        renameSync(transaction.backupPath, transaction.distPath);
    }
    removePendingIfPresent(transaction);
    removeBackupIfSafe(transaction);
    removeDistPromotionTransaction();
}

function recoverCommittedPromotion(transaction) {
    writeDistPromotionTransaction({
        ...transaction,
        phase: "cleanup-pending"
    });
    removePendingIfPresent(transaction);
    removeBackupIfSafe(transaction);
    removeDistPromotionTransaction();
}

function preserveCommittedPromotionForRecovery(transaction, error) {
    console.warn("Release bytes were committed, but promotion cleanup is pending.");
    console.warn(error instanceof Error ? error.message : String(error));
    try {
        writeDistPromotionTransaction({
            ...transaction,
            phase: "cleanup-pending"
        });
    } catch (journalError) {
        console.warn("Unable to write cleanup-pending promotion journal. The previous journal was preserved for recovery.");
        console.warn(journalError instanceof Error ? journalError.message : String(journalError));
    }
}

function removePendingIfPresent(transaction) {
    if (existsSync(transaction.pendingPath)) {
        rmSync(transaction.pendingPath, { recursive: true, force: true });
    }
}

function removeBackupIfSafe(transaction) {
    if (existsSync(transaction.backupPath)) {
        rmSync(transaction.backupPath, { recursive: true, force: true });
    }
}

function writeDistPromotionTransaction(transaction) {
    writeTextFileAtomically(getDistPromotionTransactionFile(), `${JSON.stringify(transaction, null, 4)}\n`, {
        failPhase: `dist-promotion-journal-${transaction.phase}`,
        mode: 0o600
    });
}

function removeDistPromotionTransaction() {
    rmSync(getDistPromotionTransactionFile(), { force: true });
}

function validateDistPromotionTransaction(transaction) {
    assertDistPromotionString(transaction, "backupPath");
    assertDistPromotionString(transaction, "distPath");
    assertDistPromotionString(transaction, "pendingPath");
    if (transaction.schemaVersion !== 1 || !VALID_PHASES.has(transaction.phase)) {
        throw new Error("Unsupported dist promotion transaction.");
    }
    if (!isManagedFullReleaseDestination(transaction.distPath)) {
        throw new Error("Interrupted dist promotion destination is not an allowed full-release output path.");
    }
    if (!isControlledPromotionSibling(transaction.pendingPath, transaction.distPath, "pending")) {
        throw new Error("Interrupted dist promotion pending path has an unexpected name.");
    }
    if (!isControlledPromotionSibling(transaction.backupPath, transaction.distPath, "previous")) {
        throw new Error("Interrupted dist promotion backup path has an unexpected name.");
    }
    assertSafeReleaseMutationPath(transaction.distPath, "interrupted dist promotion dist");
    assertSafeReleaseMutationPath(transaction.pendingPath, "interrupted dist promotion pending");
    assertSafeReleaseMutationPath(transaction.backupPath, "interrupted dist promotion backup");
}

function assertDistPromotionString(transaction, key) {
    if (typeof transaction[key] !== "string" || transaction[key] === "") {
        throw new Error(`Interrupted dist promotion transaction must contain ${key}.`);
    }
}

function isControlledPromotionSibling(path, distPath, kind) {
    const label = kind === "pending" ? "pending" : "previous";
    return pathsEqual(dirname(path), dirname(distPath)) && basename(path).startsWith(`.${basename(distPath)}-${label}-`);
}

function maybeExitDistPromotionStage(stage) {
    if (process.env.MSPACMAN_TEST_EXIT_DIST_PROMOTION_STAGE === stage) {
        process.exit(97);
    }
}
