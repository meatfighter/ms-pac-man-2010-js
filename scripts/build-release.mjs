import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { assertProjectVersionsMatch, cleanDirectory, distDir, ensureDirectory, readVersion, rootDir } from "./build-utils.mjs";
import { checkRotationKeys, createCacheIdentity, getHmacFingerprint, readSelectedHmacKey } from "./hmac-config.mjs";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const target = readOption("target", "full");
const keySource = readOption("key-source", "active");
const canonicalDistDir = distDir;
const buildDistDir = target === "full" ? createTemporaryFullDistDir(canonicalDistDir) : canonicalDistDir;
let promotedFullBuild = false;

const validTargets = new Set(["pwa", "web", "desktop", "full"]);
if (!validTargets.has(target)) {
    throw new Error(`Unknown release target: ${target}`);
}

try {
    assertProjectVersionsMatch();
    if (keySource === "next") {
        checkRotationKeys();
    }
    const hmacKeyHex = readSelectedHmacKey(keySource);
    const initialFingerprint = getHmacFingerprint(hmacKeyHex);
    console.log(`Using ${keySource} HMAC key fingerprint: ${initialFingerprint}`);

    runNpmScript("stamp");
    const version = readVersion();
    const cacheIdentity = createCacheIdentity(version, hmacKeyHex);
    const releaseEnv = {
        ...process.env,
        MSPACMAN_CACHE_VERSION: cacheIdentity,
        MSPACMAN_DIST_DIR: buildDistDir,
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
    if (target === "full" && !promotedFullBuild) {
        rmSync(buildDistDir, { recursive: true, force: true });
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
            rmSync(join(outputDir, "index.html"), { force: true });
            rmSync(join(outputDir, "styles.css"), { force: true });
            console.log("Building web-only release artifacts; use npm run build for the canonical full production bundle.");
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

function promoteFullDist(sourceDir, finalDistDir) {
    const backupDir = join(dirname(finalDistDir), `.${basename(finalDistDir)}-previous-${process.pid}-${Date.now()}`);
    let movedExistingDist = false;
    try {
        rmSync(backupDir, { recursive: true, force: true });
        if (existsSync(finalDistDir)) {
            renameSync(finalDistDir, backupDir);
            movedExistingDist = true;
        }
        renameSync(sourceDir, finalDistDir);
        rmSync(backupDir, { recursive: true, force: true });
    } catch (error) {
        if (movedExistingDist && !existsSync(finalDistDir) && existsSync(backupDir)) {
            renameSync(backupDir, finalDistDir);
        }
        throw error;
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
