import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanDirectory, releaseComponentsDir, rootDir, versionPath } from "./build-utils.mjs";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const outputDir = join(releaseComponentsDir, "web-unsigned");
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
    runNpmScript("_build:about", env);
    runNodeScript("write-source-archive.mjs", env);
    console.log(`Built unsigned web component artifact in ${outputDir}.`);
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
