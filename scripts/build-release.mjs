import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
    assertGitWorkingTreeClean,
    assertProjectVersionsMatch,
    cleanDirectory,
    distDir,
    ensureDirectory,
    getGitHeadCommit,
    getGitStatusPorcelain,
    readVersion,
    releaseComponentsDir,
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

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const target = readOption("target", "full");
const keySource = readOption("key-source", "active");
const canonicalDistDir = distDir;
const explicitDistDir = process.env.MSPACMAN_DIST_DIR !== undefined && process.env.MSPACMAN_DIST_DIR !== "";
const buildDistDir = resolveBuildDistDir(target, canonicalDistDir, explicitDistDir);
let promotedFullBuild = false;
let originalVersionJson = "";
let stampedVersionJson = false;
let productionCleanPreflight = false;

const validTargets = new Set(["pwa", "web", "desktop", "full"]);
if (!validTargets.has(target)) {
    throw new Error(`Unknown release target: ${target}`);
}

try {
    productionCleanPreflight = shouldRequireCleanSourcePreflight(keySource);
    if (productionCleanPreflight) {
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

    originalVersionJson = readFileSync(versionPath, "utf8");
    stampedVersionJson = true;
    runNpmScript("stamp");
    maybeFailReleaseStage("after-stamp");

    const version = readVersion();
    const cacheIdentity = createCacheIdentity(version, hmacKeyHex);
    const releaseEnv = {
        ...process.env,
        MSPACMAN_CACHE_VERSION: cacheIdentity,
        MSPACMAN_DIST_DIR: buildDistDir,
        MSPACMAN_RELEASE_GIT_COMMIT: releaseGitCommit,
        MSPACMAN_RELEASE_GIT_TREE_STATE: releaseGitTreeState,
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

    runNodeScript("verify-release.mjs", ["--key-source=env"], {
        ...releaseEnv,
        MSPACMAN_RELEASE_VERIFY_TARGET: target
    });

    if (target === "full") {
        promoteFullDist(buildDistDir, canonicalDistDir);
        promotedFullBuild = true;
        console.log(`Promoted verified release output to ${canonicalDistDir}.`);
    }

    console.log(`Release build verified with key fingerprint ${initialFingerprint}.`);
} finally {
    if (stampedVersionJson) {
        writeFileSync(versionPath, originalVersionJson);
    }
    if (target === "full" && !promotedFullBuild) {
        rmSync(buildDistDir, { recursive: true, force: true });
    }
    if (productionCleanPreflight) {
        assertGitWorkingTreeClean();
    }
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
    return mkdtempSync(join(dirname(finalDistDir), `.${basename(finalDistDir)}-pending-`));
}

function resolveBuildDistDir(target, finalDistDir, explicitDistDir) {
    if (target === "full") {
        return createTemporaryFullDistDir(finalDistDir);
    }
    if (explicitDistDir) {
        return finalDistDir;
    }
    if (target === "pwa" || target === "web") {
        return join(releaseComponentsDir, target);
    }
    return finalDistDir;
}

function promoteFullDist(sourceDir, finalDistDir) {
    const backupDir = join(dirname(finalDistDir), `.${basename(finalDistDir)}-previous-${process.pid}-${Date.now()}`);
    let movedExistingDist = false;
    let installedNewDist = false;
    try {
        rmSync(backupDir, { recursive: true, force: true });
        if (existsSync(finalDistDir)) {
            renameSync(finalDistDir, backupDir);
            movedExistingDist = true;
        }
        renameSync(sourceDir, finalDistDir);
        installedNewDist = true;
        try {
            rmSync(backupDir, { recursive: true, force: true });
        } catch (error) {
            console.warn(`Warning: release succeeded but old dist backup could not be removed: ${backupDir}`);
            console.warn(error instanceof Error ? error.message : String(error));
        }
    } catch (error) {
        if (!installedNewDist && movedExistingDist && !existsSync(finalDistDir) && existsSync(backupDir)) {
            renameSync(backupDir, finalDistDir);
        }
        throw error;
    }
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

function maybeFailReleaseStage(stage) {
    if (process.env.MSPACMAN_TEST_FAIL_RELEASE_STAGE === stage) {
        throw new Error(`Injected release failure stage: ${stage}`);
    }
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
