import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const supplemental = [
    ["verify:activation-races", "scripts/run-activation-race-qualification.mjs"],
    ["verify:audio-interruption", "scripts/run-audio-interruption-qualification.mjs"],
    ["verify:lifecycle-events", "scripts/run-lifecycle-event-qualification.mjs"],
    ["verify:ownership-transfer", "scripts/run-ownership-transfer-qualification.mjs"],
    ["verify:persistence-failure", "scripts/run-persistence-failure-qualification.mjs"],
    ["verify:lifecycle-stress", "scripts/run-lifecycle-stress-qualification.mjs"]
];
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

test("cutover browser qualification scripts are valid JavaScript", () => {
    for (const [, path] of supplemental) {
        const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
        assert.equal(result.status, 0, `${path} failed node --check:\n${result.stderr || result.stdout}`);
    }
});

test("qualify:browsers wires the complete cutover acceptance chain", () => {
    for (const [name, path] of supplemental) {
        assert.equal(packageJson.scripts?.[name], `node ${path}`, `${name} must invoke its audited browser qualifier`);
    }
    assert.equal(
        packageJson.scripts?.["qualify:browsers"],
        ["verify:production-browser", ...supplemental.map(([name]) => name)].map((name) => `npm run ${name}`).join(" && ")
    );
});
