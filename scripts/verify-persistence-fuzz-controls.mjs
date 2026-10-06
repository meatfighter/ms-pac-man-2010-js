import { eligibleFinding } from "./persistence-fuzz/failure-protocol.mjs";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { supervisedTrial } from "./persistence-fuzz/supervisor.mjs";
import { makeTrial } from "./persistence-fuzz/profiles.mjs";
import { sourceIdentity, inventory } from "./persistence-fuzz/identity.mjs";
import { Reporter } from "./persistence-fuzz/reporter.mjs";
import { finalizeCampaign } from "./persistence-fuzz/finalize.mjs";
import { runCampaign } from "./persistence-fuzz/campaign.mjs";

const repo = resolve("."),
    game = JSON.parse(readFileSync("package.json", "utf8")).name;
const identity = sourceIdentity(repo),
    before = inventory(repo, true);
const directory = resolve(repo, "..", "qualification-evidence", `${game}-fuzz-controls-${Date.now()}-${randomBytes(3).toString("hex")}`);
const spec = makeTrial(game, { seed: 0x20261004, profile: "qualification", ticks: 80, continuationTicks: 24 }, 0);
spec.frames = spec.frames.map((frame, i) => ({ ...frame, mask: i % 24 < 12 ? 8 : 4 }));
spec.continuation = spec.continuation.map((frame) => ({ ...frame, mask: 8 }));
const results = [];
const failures = [];
let branchCheckpoint,
    extraEvidenceSequence = 0;
const extraEvidence = (packet) =>
    writeFileSync(resolve(directory, `additional-evidence-${++extraEvidenceSequence}.json`), JSON.stringify(packet), { flush: true });
for (const [mutant, expected] of [
    [null, null],
    ["reject-valid", "SAVE_REJECTED"],
    ["suppress-write", "SAVE_NOT_WRITTEN"],
    ["restore-score", "IMMEDIATE_RECAPTURE_MISMATCH"],
    ["missing-coverage", null],
    ["disable-gameplay", null],
    ["drop-input", null],
    ["save-input", "OBSERVATION_CHANGED_RUNTIME"],
    ["save-rng", "OBSERVATION_CHANGED_RUNTIME"],
    ["save-deferred", "OBSERVATION_CHANGED_RUNTIME"]
]) {
    const reporter = new Reporter(resolve(directory, mutant ?? "baseline"), repo);
    let observed;
    try {
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
            async (_spec, { onEvidence }) =>
                (observed = await supervisedTrial({ repo, spec, mutant, sourceIdentity: identity }, { timeoutMs: 180000, onEvidence }))
        );
        finalizeCampaign({}, reporter, summary, true);
        const categories = observed?.issues?.map((issue) => issue.category) ?? [];
        assert.equal(observed?.setupComplete, true, `${mutant}: must initialize actual game resources`);
        assert.equal(observed?.infrastructureFailure, undefined, `${mutant}: infrastructure is not a mutation kill`);
        assert.ok(
            !categories.some((name) => ["SETUP_FAILED", "BROWSER_PAGE_ERROR", "HARNESS_OR_RUNTIME_EXCEPTION"].includes(name)),
            JSON.stringify(categories)
        );
        if (expected)
            assert.ok(
                observed.issues.some((issue) => issue.category === expected && eligibleFinding(issue)),
                `${mutant}: expected ${expected}, got ${categories}`
            );
        else if (["missing-coverage", "disable-gameplay", "drop-input"].includes(mutant)) {
            assert.equal(summary.exitCode, 2);
            assert.ok(summary.missingCoverage.length);
        } else assert.equal(summary.exitCode, 0, `baseline: ${JSON.stringify(summary)}`);
        if (mutant === null) branchCheckpoint = observed.acceptedCheckpoint;
        results.push({ mutant, exitCode: summary.exitCode, categories, metrics: observed.metrics });
        console.log(JSON.stringify(results.at(-1)));
    } catch (error) {
        failures.push({ mutant, error: error.stack });
        console.error(error);
    } finally {
        reporter.close();
    }
}
try {
    assert.ok(branchCheckpoint, "baseline must yield an accepted branch root");
    const branch = await supervisedTrial(
        {
            repo,
            sourceIdentity: identity,
            spec: { ...spec, strategy: "accepted-corpus-branch", lane: "corpus", initialCheckpoint: branchCheckpoint, corpusParent: 0 }
        },
        { timeoutMs: 180000, onEvidence: extraEvidence }
    );
    assert.equal(branch.setupComplete, true);
    assert.deepEqual(branch.issues, []);
    assert.ok(branch.metrics.restores > 0);
    console.log(JSON.stringify({ acceptedCorpusBranch: true, metrics: branch.metrics }));
} catch (error) {
    failures.push({ mutant: "accepted-corpus-branch", error: error.stack });
}
writeFileSync(resolve(directory, "controls.json"), JSON.stringify({ results, failures }, null, 2));
assert.deepEqual(inventory(repo, true), before, "mutation controls must preserve retained dist");
assert.equal(sourceIdentity(repo).digest, identity.digest, "mutation controls must preserve source");
assert.deepEqual(failures, [], "all independent controls attempted; failures retained above");
console.log(`Behavioral fuzz controls passed: ${directory}`);
