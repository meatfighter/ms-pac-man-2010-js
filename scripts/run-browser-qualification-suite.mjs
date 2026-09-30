import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const qualificationScripts = [
    "verify:departure-save",
    "verify:fullscreen",
    "verify:fullscreen-timeout",
    "verify:fullscreen-reentry",
    "verify:fullscreen-settings",
    "verify:production-browser",
    "verify:activation-races",
    "verify:audio-interruption",
    "verify:audio-policy",
    "verify:lifecycle-events",
    "verify:ownership-transfer",
    "verify:persistence-failure",
    "verify:lifecycle-stress",
    "verify:high-score-durability"
];

const pwaRoot = resolve(".release-components", "pwa", "pwa");

runNpmScript("build:pwa");
for (const script of qualificationScripts) {
    runNpmScript(script, {
        PWA_ROOT: pwaRoot
    });
}

function runNpmScript(script, extraEnv = {}) {
    const npmExecPath = process.env.npm_execpath;
    if (!npmExecPath) {
        throw new Error("npm_execpath is unavailable; run this suite through npm run qualify:browsers.");
    }
    const result = spawnSync(process.execPath, [npmExecPath, "run", script], {
        stdio: "inherit",
        env: {
            ...process.env,
            ...extraEnv
        }
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}
