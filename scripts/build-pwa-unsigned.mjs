import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanDirectory, releaseComponentsDir, rootDir, versionPath } from "./build-utils.mjs";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const outputDir = join(releaseComponentsDir, "pwa-unsigned");
const env = {
    ...process.env,
    MSPACMAN_DIST_DIR: outputDir
};
const originalVersionJson = readFileSync(versionPath, "utf8");
let stampedVersionJson = false;

try {
    cleanDirectory(outputDir);
    stampedVersionJson = true;
    runNpmScript("stamp", env);
    runNpmScript("_build:pwa:unsigned", env);
    console.log(`Built unsigned PWA component artifact in ${outputDir}.`);
} finally {
    if (stampedVersionJson) {
        writeFileSync(versionPath, originalVersionJson);
    }
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
