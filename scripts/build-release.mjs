import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
    assertGitWorkingTreeClean,
    assertProjectVersionsMatch,
    assertSafeReleaseMutationPath,
    cleanDirectory,
    ensureDirectory,
    getGitHeadCommit,
    getGitStatusPorcelain,
    getHmacNextCandidateDir,
    isPathInside,
    pathsEqual,
    readVersion,
    releaseComponentsDir,
    repositoryDistDir,
    rootDir,
    versionPath
} from "./build-utils.mjs";
import {
    assertRepositoryReleaseSecretsIgnored,
    assertSecretAbsentFromTrackedFiles,
    checkRotationKeys,
    createCacheIdentity,
    getHmacFingerprint,
    readSelectedHmacKey,
    SYNTHETIC_RELEASE_HMAC_KEY_HEX
} from "./hmac-config.mjs";
import { normalizeRequestedOutputDir, resolveReleaseOutputPlan } from "./release-output-plan.mjs";
import { acquireReleaseLock } from "./release-lock.mjs";
import { writeTextFileAtomically } from "./release-io.mjs";

const DIST_PROMOTION_TRANSACTION_FILE = join(rootDir, ".release-secrets", "dist-promotion-transaction.json");

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const target = readOption("target", "full");
const keySource = readOption("key-source", "active");
const requestedOutputDir = normalizeRequestedOutputDir(rootDir, readOption("output-dir", ""));
let promotedFullBuild = false;
let originalVersionJson = "";
let stampedVersionJson = false;
let productionCleanPreflight = false;
let releaseLock = () => undefined;

const validTargets = new Set(["pwa", "web", "desktop", "full"]);
if (!validTargets.has(target)) {
    throw new Error(`Unknown release target: ${target}`);
}
const releasePlan = resolveReleaseOutputPlan({
    createTemporaryFullDistDir,
    hmacNextCandidateDir: getHmacNextCandidateDir(),
    keySource,
    releaseComponentsDir,
    repositoryDistDir,
    requestedOutputDir,
    target
});
const buildDistDir = releasePlan.buildDistDir;

try {
    releaseLock = acquireReleaseLock(`build-release:${target}:${keySource}`);
    productionCleanPreflight = shouldRequireCleanSourcePreflight(keySource);
    if (shouldRequireFinalCleanSourceCheck()) {
        assertGitWorkingTreeClean();
    }
    if (releasePlan.shouldPromoteFullBuild) {
        recoverInterruptedFullDistPromotion(releasePlan.finalDistDir);
    }
    assertProjectVersionsMatch();
    const hmacKeyHex = readSelectedHmacKey(keySource);
    const releaseGitCommit = getGitHeadCommit();
    if (productionCleanPreflight) {
        await assertProductionHmacPreflight(hmacKeyHex);
    } else {
        await assertSyntheticOrEnvReleasePreflight(hmacKeyHex);
    }
    const releaseGitTreeState = productionCleanPreflight || getGitStatusPorcelain().trim() === "" ? "clean" : "unchecked";
    if (keySource === "next") {
        checkRotationKeys();
    }
    const initialFingerprint = getHmacFingerprint(hmacKeyHex);
    console.log(`Using ${keySource} HMAC key fingerprint: ${initialFingerprint}`);

    originalVersionJson = readFileSync(versionPath, "utf8");
    stampedVersionJson = true;
    runNpmScript("stamp");
    maybeFailReleaseStage("after-stamp");

    const version = readVersion();
    const cacheIdentity = createCacheIdentity(version, hmacKeyHex);
    const releaseEnv = {
        ...process.env,
        MSPACMAN_INTERNAL_DIST_DIR: buildDistDir,
        MSPACMAN_INTERNAL_RELEASE_BUILD: "1",
        MSPACMAN_CACHE_VERSION: cacheIdentity,
        MSPACMAN_RELEASE_HMAC_KEY_SOURCE: releasePlan.hmacKeySource,
        MSPACMAN_RELEASE_GIT_COMMIT: releaseGitCommit,
        MSPACMAN_RELEASE_GIT_TREE_STATE: releaseGitTreeState,
        MSPACMAN_RELEASE_KIND: releasePlan.releaseKind,
        MSPACMAN_HMAC_KEY_HEX: hmacKeyHex
    };

    prepareOutputTarget(target, buildDistDir);

    if (target === "pwa" || target === "web" || target === "full") {
        runNpmScript("_build:pwa:release", releaseEnv);
    }

    if (target === "web" || target === "full") {
        runNpmScript("_build:about", releaseEnv);
    }

    if (target === "desktop" || target === "full") {
        cleanDesktopTarget();
        runNpmScript("_build:desktop:release", releaseEnv);
        runNpmScript("test:desktop-high-score", releaseEnv);
    }

    if (target === "full") {
        runNpmScript("_assemble", releaseEnv);
    }

    if (target === "web" || target === "full") {
        runNodeScript("write-source-archive.mjs", [], releaseEnv);
    }

    if (target === "web" || target === "full") {
        runNodeScript("write-release-metadata.mjs", [], releaseEnv);
        runNodeScript("write-release-checksums.mjs", [], releaseEnv);
    }

    maybeFailReleaseStage("after-artifacts-before-verify");

    runNodeScript(
        "verify-release.mjs",
        ["--key-source=env", `--expected-release-kind=${releasePlan.releaseKind}`, `--expected-hmac-key-source=${releasePlan.hmacKeySource}`],
        {
            ...releaseEnv,
            MSPACMAN_RELEASE_VERIFY_TARGET: target
        }
    );

    maybeMutateTrackedFileAfterVerify();

    if (stampedVersionJson) {
        writeFileSync(versionPath, originalVersionJson);
        stampedVersionJson = false;
    }
    if (shouldRequireFinalCleanSourceCheck()) {
        assertGitWorkingTreeClean();
    }

    if (releasePlan.shouldPromoteFullBuild) {
        promoteFullDist(buildDistDir, releasePlan.finalDistDir);
        promotedFullBuild = true;
        console.log(`Promoted verified release output to ${releasePlan.finalDistDir}.`);
    }

    console.log(`Release build verified with key fingerprint ${initialFingerprint}.`);
} finally {
    if (stampedVersionJson) {
        writeFileSync(versionPath, originalVersionJson);
    }
    if (releasePlan.shouldPromoteFullBuild && !promotedFullBuild) {
        assertSafeReleaseMutationPath(buildDistDir, "pending full release output");
        rmSync(buildDistDir, { recursive: true, force: true });
    }
    releaseLock();
}

function readOption(name, fallback) {
    const prefix = `--${name}=`;
    const match = process.argv.find((arg) => arg.startsWith(prefix));
    return match === undefined ? fallback : match.slice(prefix.length);
}

function prepareOutputTarget(target, outputDir) {
    switch (target) {
        case "full":
            cleanDirectory(outputDir);
            break;
        case "pwa":
            ensureDirectory(outputDir);
            cleanDirectory(join(outputDir, "pwa"));
            break;
        case "web":
            ensureDirectory(outputDir);
            cleanDirectory(join(outputDir, "pwa"));
            cleanDirectory(join(outputDir, "assets"));
            cleanDirectory(join(outputDir, "downloads"));
            rmSync(join(outputDir, "index.html"), { force: true });
            rmSync(join(outputDir, "styles.css"), { force: true });
            rmSync(join(outputDir, "release.json"), { force: true });
            rmSync(join(outputDir, "checksums.sha256"), { force: true });
            console.log(`Building noncanonical web component artifacts in ${outputDir}. Use npm run build for canonical production dist/.`);
            break;
        case "desktop":
            break;
    }
}

function cleanDesktopTarget() {
    rmSync(join(rootDir, "desktop", "target"), { recursive: true, force: true });
}

function createTemporaryFullDistDir(finalDistDir) {
    ensureDirectory(dirname(finalDistDir));
    const pendingDir = mkdtempSync(join(dirname(finalDistDir), `.${basename(finalDistDir)}-pending-`));
    assertSafeReleaseMutationPath(pendingDir, "pending full release output");
    return pendingDir;
}

function promoteFullDist(sourceDir, finalDistDir) {
    const backupDir = join(dirname(finalDistDir), `.${basename(finalDistDir)}-previous-${process.pid}-${Date.now()}`);
    let movedExistingDist = false;
    let installedNewDist = false;
    const transaction = {
        backupPath: backupDir,
        distPath: finalDistDir,
        pendingPath: sourceDir,
        phase: "prepared",
        schemaVersion: 1
    };
    try {
        writeDistPromotionTransaction(transaction);
        rmSync(backupDir, { recursive: true, force: true });
        if (existsSync(finalDistDir)) {
            renameSync(finalDistDir, backupDir);
            movedExistingDist = true;
            writeDistPromotionTransaction({
                ...transaction,
                phase: "old-moved"
            });
        }
        renameSync(sourceDir, finalDistDir);
        installedNewDist = true;
        writeDistPromotionTransaction({
            ...transaction,
            phase: "new-installed"
        });
        try {
            rmSync(backupDir, { recursive: true, force: true });
        } catch (error) {
            console.warn(`Warning: release succeeded but old dist backup could not be removed: ${backupDir}`);
            console.warn(error instanceof Error ? error.message : String(error));
        }
        removeDistPromotionTransaction();
    } catch (error) {
        if (!installedNewDist && movedExistingDist && !existsSync(finalDistDir) && existsSync(backupDir)) {
            renameSync(backupDir, finalDistDir);
        }
        throw error;
    }
}

function recoverInterruptedFullDistPromotion(finalDistDir) {
    if (!existsSync(DIST_PROMOTION_TRANSACTION_FILE)) {
        return;
    }
    const transaction = JSON.parse(readFileSync(DIST_PROMOTION_TRANSACTION_FILE, "utf8"));
    validateDistPromotionTransaction(transaction, finalDistDir);

    if (!existsSync(transaction.distPath) && existsSync(transaction.backupPath)) {
        renameSync(transaction.backupPath, transaction.distPath);
    } else if (existsSync(transaction.distPath) && existsSync(transaction.backupPath)) {
        rmSync(transaction.backupPath, { recursive: true, force: true });
    }

    if (existsSync(transaction.pendingPath) && isControlledPromotionSibling(transaction.pendingPath, transaction.distPath, "pending")) {
        rmSync(transaction.pendingPath, { recursive: true, force: true });
    }
    removeDistPromotionTransaction();
}

function writeDistPromotionTransaction(transaction) {
    writeTextFileAtomically(DIST_PROMOTION_TRANSACTION_FILE, `${JSON.stringify(transaction, null, 4)}\n`, {
        failPhase: `dist-promotion-journal-${transaction.phase}`,
        mode: 0o600
    });
}

function removeDistPromotionTransaction() {
    rmSync(DIST_PROMOTION_TRANSACTION_FILE, { force: true });
}

function validateDistPromotionTransaction(transaction, expectedDistDir) {
    assertDistPromotionString(transaction, "backupPath");
    assertDistPromotionString(transaction, "distPath");
    assertDistPromotionString(transaction, "pendingPath");
    if (transaction.schemaVersion !== 1 || !["prepared", "old-moved", "new-installed"].includes(transaction.phase)) {
        throw new Error("Unsupported dist promotion transaction.");
    }
    if (!pathsEqual(transaction.distPath, expectedDistDir)) {
        throw new Error("Interrupted dist promotion transaction does not match this release output path.");
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

async function assertProductionHmacPreflight(hmacKeyHex) {
    assertRepositoryReleaseSecretsIgnored();
    await assertSecretAbsentFromTrackedFiles(hmacKeyHex);
}

async function assertSyntheticOrEnvReleasePreflight(hmacKeyHex) {
    assertRepositoryReleaseSecretsIgnored();
    if (hmacKeyHex !== SYNTHETIC_RELEASE_HMAC_KEY_HEX) {
        await assertSecretAbsentFromTrackedFiles(hmacKeyHex);
    }
}

function shouldRequireCleanSourcePreflight(keySource) {
    return keySource === "active" || keySource === "next";
}

function shouldRequireFinalCleanSourceCheck() {
    return productionCleanPreflight || process.env.MSPACMAN_TEST_REQUIRE_FINAL_CLEAN_CHECK === "1";
}

function maybeFailReleaseStage(stage) {
    if (process.env.MSPACMAN_TEST_FAIL_RELEASE_STAGE === stage) {
        throw new Error(`Injected release failure stage: ${stage}`);
    }
}

function maybeMutateTrackedFileAfterVerify() {
    const path = process.env.MSPACMAN_TEST_MUTATE_TRACKED_FILE_AFTER_VERIFY;
    if (path === undefined || path === "") {
        return;
    }
    const resolvedPath = join(rootDir, path);
    if (!pathsEqual(resolvedPath, rootDir) && !isPathInside(resolvedPath, rootDir)) {
        throw new Error("MSPACMAN_TEST_MUTATE_TRACKED_FILE_AFTER_VERIFY must resolve inside the repository.");
    }
    writeFileSync(resolvedPath, `mutated after verify ${new Date().toISOString()}\n`);
}

function runNpmScript(scriptName, env = process.env) {
    const result =
        process.platform === "win32"
            ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `${npmCommand} run ${scriptName}`], {
                  cwd: rootDir,
                  env,
                  stdio: "inherit",
                  windowsHide: true
              })
            : spawnSync(npmCommand, ["run", scriptName], {
                  cwd: rootDir,
                  env,
                  stdio: "inherit",
                  windowsHide: true
              });
    if (result.status !== 0 || result.error) {
        throw result.error ?? new Error(`npm run ${scriptName} failed.`);
    }
}

function runNodeScript(scriptName, args, env = process.env) {
    const result = spawnSync(process.execPath, [`scripts/${scriptName}`, ...args], {
        cwd: rootDir,
        env,
        stdio: "inherit",
        windowsHide: true
    });
    if (result.status !== 0 || result.error) {
        throw result.error ?? new Error(`node scripts/${scriptName} failed.`);
    }
}
