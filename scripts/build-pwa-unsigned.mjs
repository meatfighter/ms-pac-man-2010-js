import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { cleanDirectory, releaseComponentsDir, rootDir } from "./build-utils.mjs";
import { acquireReleaseLock } from "./release-lock.mjs";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const outputDir = join(releaseComponentsDir, "pwa-unsigned");
const buildStamp = new Date().toISOString();
const releaseLock = acquireReleaseLock("build:pwa:unsigned");
const env = {
    ...process.env,
    MSPACMAN_INTERNAL_DIST_DIR: outputDir,
    MSPACMAN_INTERNAL_RELEASE_BUILD: "1",
    MSPACMAN_CACHE_VERSION: "",
    MSPACMAN_HMAC_KEY_HEX: "",
    MSPACMAN_RELEASE_BUILD_STAMP: buildStamp
};

try {
    cleanDirectory(outputDir);
    runNpmScript("_build:pwa:unsigned", env);
    console.log(`Built unsigned PWA component artifact in ${outputDir}.`);
} finally {
    releaseLock();
}

function runNpmScript(scriptName, env) {
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
