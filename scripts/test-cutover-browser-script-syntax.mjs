import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const scripts = [
    "scripts/run-activation-race-qualification.mjs",
    "scripts/run-audio-interruption-qualification.mjs",
    "scripts/run-lifecycle-event-qualification.mjs",
    "scripts/run-lifecycle-stress-qualification.mjs"
];

test("cutover browser qualification scripts are valid JavaScript", () => {
    for (const path of scripts) {
        const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
        assert.equal(result.status, 0, `${path} failed node --check:\n${result.stderr || result.stdout}`);
    }
});
