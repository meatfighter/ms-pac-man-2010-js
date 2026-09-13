import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const qualification = [
    ["verify:fullscreen", "scripts/run-fullscreen-qualification.mjs"],
    ["verify:fullscreen-timeout", "scripts/run-fullscreen-timeout-qualification.mjs"],
    ["verify:fullscreen-reentry", "scripts/run-fullscreen-reentry-qualification.mjs"],
    ["verify:fullscreen-settings", "scripts/run-fullscreen-settings-qualification.mjs"],
    ["verify:production-browser", "scripts/run-production-browser-qualification.mjs"],
    ["verify:activation-races", "scripts/run-activation-race-qualification.mjs"],
    ["verify:audio-interruption", "scripts/run-audio-interruption-qualification.mjs"],
    ["verify:lifecycle-events", "scripts/run-lifecycle-event-qualification.mjs"],
    ["verify:ownership-transfer", "scripts/run-ownership-transfer-qualification.mjs"],
    ["verify:persistence-failure", "scripts/run-persistence-failure-qualification.mjs"],
    ["verify:lifecycle-stress", "scripts/run-lifecycle-stress-qualification.mjs"]
];
const unrelatedBrowserSuites = qualification.slice(4).map(([, path]) => path);
const suitePath = "scripts/run-browser-qualification-suite.mjs";
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const suiteSource = readFileSync(suitePath, "utf8");

test("cutover browser qualification scripts are valid JavaScript", () => {
    for (const [, path] of qualification) {
        const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
        assert.equal(result.status, 0, `${path} failed node --check:\n${result.stderr || result.stdout}`);
    }
    const suiteResult = spawnSync(process.execPath, ["--check", suitePath], { encoding: "utf8" });
    assert.equal(suiteResult.status, 0, `${suitePath} failed node --check:\n${suiteResult.stderr || suiteResult.stdout}`);
});

test("qualify:browsers builds a fresh PWA and runs the audited suite in order", () => {
    for (const [name, path] of qualification) {
        assert.equal(packageJson.scripts?.[name], `node ${path}`, `${name} must invoke its audited browser qualifier`);
    }
    assert.equal(packageJson.scripts?.["qualify:browsers"], `node ${suitePath}`);
    assert.match(suiteSource, /resolve\("\.release-components", "pwa", "pwa"\)/);
    assert.match(suiteSource, /const npmExecPath = process\.env\.npm_execpath;/);
    assert.match(suiteSource, /spawnSync\(process\.execPath, \[npmExecPath, "run", script\]/);
    assert.doesNotMatch(suiteSource, /npm\.cmd|process\.platform === "win32"/);

    const arrayStart = suiteSource.indexOf("const qualificationScripts = [");
    const arrayEnd = suiteSource.indexOf("];", arrayStart);
    assert.ok(arrayStart >= 0 && arrayEnd > arrayStart, "browser suite qualification array is missing");
    const qualificationArraySource = suiteSource.slice(arrayStart, arrayEnd);
    let previous = -1;
    for (const [name] of qualification) {
        const index = qualificationArraySource.indexOf(`"${name}"`);
        assert.ok(index > previous, `${name} is missing or out of order in the browser-suite qualification array`);
        previous = index;
    }

    const buildIndex = suiteSource.indexOf('runNpmScript("build:pwa")');
    const loopIndex = suiteSource.indexOf("for (const script of qualificationScripts)", buildIndex);
    assert.ok(buildIndex >= 0, "browser suite must build the PWA first");
    assert.ok(loopIndex > buildIndex, "browser suite must run the audited qualification array after the fresh PWA build");
});

test("unrelated browser qualifiers explicitly disable the default-on Fullscreen preference", () => {
    for (const path of unrelatedBrowserSuites) {
        const source = readFileSync(path, "utf8");
        assert.match(
            source,
            /import \{ disableFullscreenPreference \} from "\.\/fullscreen-test-utils\.mjs";/,
            `${path} must import the shared Fullscreen-OFF helper`
        );
        const calls = source.match(/disableFullscreenPreference\s*\(/g) ?? [];
        assert.ok(calls.length >= 1, `${path} imports the helper but never calls it before exercising its original non-fullscreen contract`);
    }
});
