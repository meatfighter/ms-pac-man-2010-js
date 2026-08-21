import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { cleanDirectory, distDir, ensureDirectory, readVersion, rootDir } from "./build-utils.mjs";
import { checkRotationKeys, createCacheIdentity, getHmacFingerprint, readSelectedHmacKey } from "./hmac-config.mjs";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const target = readOption("target", "full");
const keySource = readOption("key-source", "active");

const validTargets = new Set(["pwa", "web", "desktop", "full"]);
if (!validTargets.has(target)) {
    throw new Error(`Unknown release target: ${target}`);
}

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
    MSPACMAN_HMAC_KEY_HEX: hmacKeyHex
};

prepareOutputTarget(target);

if (target === "pwa" || target === "web" || target === "full") {
    runNpmScript("_build:pwa:release", releaseEnv);
}

if (target === "web" || target === "full") {
    runNpmScript("_build:about", releaseEnv);
}

if (target === "desktop" || target === "full") {
    runNpmScript("_build:desktop:release", releaseEnv);
}

if (target === "full") {
    runNpmScript("_assemble", releaseEnv);
}

if (target === "web" || target === "full") {
    runNodeScript("write-release-checksums.mjs", [], releaseEnv);
}

runNodeScript("verify-release.mjs", ["--key-source=env"], {
    ...releaseEnv,
    MSPACMAN_RELEASE_VERIFY_TARGET: target
});

console.log(`Release build verified with key fingerprint ${initialFingerprint}.`);

function readOption(name, fallback) {
    const prefix = `--${name}=`;
    const match = process.argv.find((arg) => arg.startsWith(prefix));
    return match === undefined ? fallback : match.slice(prefix.length);
}

function prepareOutputTarget(target) {
    switch (target) {
        case "full":
            cleanDirectory(distDir);
            break;
        case "pwa":
            ensureDirectory(distDir);
            cleanDirectory(join(distDir, "pwa"));
            break;
        case "web":
            ensureDirectory(distDir);
            cleanDirectory(join(distDir, "pwa"));
            cleanDirectory(join(distDir, "assets"));
            rmSync(join(distDir, "index.html"), { force: true });
            rmSync(join(distDir, "styles.css"), { force: true });
            console.log("Building web-only release artifacts; use npm run build for the canonical full production bundle.");
            break;
        case "desktop":
            break;
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
