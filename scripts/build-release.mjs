import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
    assertGitWorkingTreeClean,
    assertProjectVersionsMatch,
    assertSafeGeneratedDirectoryMutationPath,
    assertSafeReleaseMutationPath,
    cleanDirectory,
    ensureDirectory,
    getGitHeadCommit,
    getGitStatusPorcelain,
    getHmacNextCandidateDir,
    isPathInside,
    pathsEqual,
    readBuildVersion,
    releaseComponentsDir,
    repositoryDistDir,
    rootDir,
    desktopTargetDir
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
import { promoteFullDist, recoverAnyInterruptedFullDistPromotion } from "./release-dist-promotion.mjs";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const target = readOption("target", "full");
const keySource = readOption("key-source", "active");
const requestedOutputDir = normalizeRequestedOutputDir(rootDir, readOption("output-dir", ""));
let promotedFullBuild = false;
let productionCleanPreflight = false;
let releaseLock = () => undefined;
let buildDistDir = "";
let pendingFullBuild = false;

const validTargets = new Set(["pwa", "web", "desktop", "full"]);
if (!validTargets.has(target)) {
    throw new Error(`Unknown release target: ${target}`);
}
try {
    releaseLock = acquireReleaseLock(`build-release:${target}:${keySource}`);
    recoverAnyInterruptedFullDistPromotion();
    const releasePlan = resolveReleaseOutputPlan({
        hmacNextCandidateDir: getHmacNextCandidateDir(),
        keySource,
        releaseComponentsDir,
        repositoryDistDir,
        requestedOutputDir,
        target
    });
    pendingFullBuild = releasePlan.shouldPromoteFullBuild;
    buildDistDir = pendingFullBuild ? createTemporaryFullDistDir(releasePlan.finalDistDir) : releasePlan.buildDistDir;
    productionCleanPreflight = shouldRequireCleanSourcePreflight(keySource);
    if (shouldRequireFinalCleanSourceCheck()) {
        assertGitWorkingTreeClean();
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

    const buildStamp = new Date().toISOString();
    maybeFailReleaseStage("after-stamp");

    const version = readBuildVersionFromStamp(buildStamp);
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
        MSPACMAN_RELEASE_BUILD_STAMP: buildStamp,
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
    if (pendingFullBuild && buildDistDir !== "" && !promotedFullBuild) {
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
    assertSafeGeneratedDirectoryMutationPath(desktopTargetDir, "desktop target directory");
    rmSync(desktopTargetDir, { recursive: true, force: true });
}

function createTemporaryFullDistDir(finalDistDir) {
    ensureDirectory(dirname(finalDistDir));
    const pendingDir = mkdtempSync(join(dirname(finalDistDir), `.${basename(finalDistDir)}-pending-`));
    assertSafeReleaseMutationPath(pendingDir, "pending full release output");
    return pendingDir;
}

function readBuildVersionFromStamp(buildStamp) {
    return {
        ...readBuildVersion(),
        buildStamp
    };
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
