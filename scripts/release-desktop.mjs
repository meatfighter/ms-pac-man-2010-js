import { spawnSync } from "node:child_process";
import { rootDir } from "./build-utils.mjs";
import { acquireReleaseLock } from "./release-lock.mjs";

const releaseLock = acquireReleaseLock("release:desktop");

try {
    runNodeScript("build-release.mjs", ["--target=desktop", "--key-source=active"]);
    runNodeScript("copy-desktop-release.mjs");
} finally {
    releaseLock();
}

function runNodeScript(scriptName, args = []) {
    const result = spawnSync(process.execPath, [`scripts/${scriptName}`, ...args], {
        cwd: rootDir,
        env: process.env,
        stdio: "inherit",
        windowsHide: true
    });
    if (result.status !== 0 || result.error) {
        throw result.error ?? new Error(`node scripts/${scriptName} failed.`);
    }
}
