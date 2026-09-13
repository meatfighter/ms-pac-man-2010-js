import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const qualificationScripts = [
    "verify:fullscreen",
    "verify:fullscreen-timeout",
    "verify:fullscreen-reentry",
    "verify:production-browser",
    "verify:activation-races",
    "verify:audio-interruption",
    "verify:lifecycle-events",
    "verify:ownership-transfer",
    "verify:persistence-failure",
    "verify:lifecycle-stress"
];
const pwaRoot = resolve(".release-components", "pwa", "pwa");

runNpmScript("build:pwa");
for (const script of qualificationScripts) {
    runNpmScript(script, { PWA_ROOT: pwaRoot });
}

function runNpmScript(script, extraEnv = {}) {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const result = spawnSync(npm, ["run", script], {
        stdio: "inherit",
        env: { ...process.env, ...extraEnv }
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}
