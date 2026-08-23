import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { cleanDirectory, releaseComponentsDir, rootDir } from "./build-utils.mjs";
import { acquireReleaseLock } from "./release-lock.mjs";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const outputDir = join(releaseComponentsDir, "web-unsigned");
const buildStamp = new Date().toISOString();
const releaseLock = acquireReleaseLock("build:web:unsigned");
const env = {
    ...process.env,
    MSPACMAN_INTERNAL_DIST_DIR: outputDir,
    MSPACMAN_INTERNAL_RELEASE_BUILD: "1",
    MSPACMAN_RELEASE_BUILD_STAMP: buildStamp
};

try {
    cleanDirectory(outputDir);
    runNpmScript("_build:pwa:unsigned", env);
    runNpmScript("_build:about", env);
    runNodeScript("write-source-archive.mjs", env);
    console.log(`Built unsigned web component artifact in ${outputDir}.`);
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

function runNodeScript(scriptName, env) {
    const result = spawnSync(process.execPath, [`scripts/${scriptName}`], {
        cwd: rootDir,
        env,
        stdio: "inherit",
        windowsHide: true
    });
    if (result.status !== 0 || result.error) {
        throw result.error ?? new Error(`node scripts/${scriptName} failed.`);
    }
}
