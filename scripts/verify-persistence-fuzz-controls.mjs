import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { supervisedTrial } from "./persistence-fuzz/supervisor.mjs";
import { makeTrial } from "./persistence-fuzz/profiles.mjs";
import { sourceIdentity, inventory } from "./persistence-fuzz/identity.mjs";
import { Reporter } from "./persistence-fuzz/reporter.mjs";
import { runCampaign } from "./persistence-fuzz/campaign.mjs";

const repo = resolve("."),
    game = JSON.parse(readFileSync("package.json", "utf8")).name;
const identity = sourceIdentity(repo),
    before = inventory(repo, true);
const directory = resolve(repo, "..", "qualification-evidence", `${game}-fuzz-controls-${Date.now()}-${randomBytes(3).toString("hex")}`);
const spec = makeTrial(game, { seed: 0x20261004, profile: "qualification", ticks: 8, continuationTicks: 8 }, 0);
const results = [];
let branchCheckpoint;
for (const [mutant, expected] of [
    [null, null],
    ["reject-valid", "SAVE_REJECTED"],
    ["suppress-write", "SAVE_NOT_WRITTEN"],
    ["restore-score", "IMMEDIATE_RECAPTURE_MISMATCH"],
    ["missing-coverage", null]
]) {
    const reporter = new Reporter(resolve(directory, mutant ?? "baseline"), repo);
    let observed;
    const summary = await runCampaign(
        {
            game,
            profile: "qualification",
            seed: spec.seed,
            trials: 1,
            sourceIdentity: identity,
            ...(mutant === "missing-coverage" ? {} : { replaySpec: spec })
        },
        reporter,
        async () => (observed = await supervisedTrial({ repo, spec, mutant }, { timeoutMs: 180000 }))
    );
    const categories = observed?.issues?.map((issue) => issue.category) ?? [];
    assert.equal(observed?.setupComplete, true, `${mutant}: must initialize actual game resources`);
    assert.equal(observed?.infrastructureFailure, undefined, `${mutant}: infrastructure is not a mutation kill`);
    assert.ok(!categories.some((name) => ["SETUP_FAILED", "BROWSER_PAGE_ERROR", "HARNESS_OR_RUNTIME_EXCEPTION"].includes(name)), JSON.stringify(categories));
    if (expected) assert.ok(categories.includes(expected), `${mutant}: expected ${expected}, got ${categories}`);
    else if (mutant === "missing-coverage") {
        assert.equal(summary.exitCode, 2);
        assert.ok(summary.missingCoverage.length);
    } else assert.equal(summary.exitCode, 0, `baseline: ${JSON.stringify(summary)}`);
    if (mutant === null) branchCheckpoint = observed.acceptedCheckpoint;
    results.push({ mutant, exitCode: summary.exitCode, categories, metrics: observed.metrics });
    console.log(JSON.stringify(results.at(-1)));
}
assert.ok(branchCheckpoint, "baseline must yield an accepted branch root");
const branch = await supervisedTrial({ repo, spec: { ...spec, initialCheckpoint: branchCheckpoint, corpusParent: 0 } }, { timeoutMs: 180000 });
assert.equal(branch.setupComplete, true);
assert.deepEqual(branch.issues, []);
assert.ok(branch.metrics.restores > 0);
console.log(JSON.stringify({ acceptedCorpusBranch: true, metrics: branch.metrics }));
assert.deepEqual(inventory(repo, true), before, "mutation controls must preserve retained dist");
assert.equal(sourceIdentity(repo).digest, identity.digest, "mutation controls must preserve source");
console.log(`Behavioral fuzz controls passed: ${directory}`);
