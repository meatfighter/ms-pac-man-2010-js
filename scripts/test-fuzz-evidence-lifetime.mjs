import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import vm from "node:vm";
import { FindingBuffer } from "./persistence-fuzz/findings.mjs";
import { Reporter } from "./persistence-fuzz/reporter.mjs";
import { runCampaign } from "./persistence-fuzz/campaign.mjs";
import { makeTrial, casePlan } from "./persistence-fuzz/profiles.mjs";
import { finalizeCampaign } from "./persistence-fuzz/finalize.mjs";
import { minimizeTrial } from "./persistence-fuzz/shrink.mjs";
import { issueSignature } from "./persistence-fuzz/compare.mjs";

function bridge() {
    const source = readFileSync("scripts/persistence-fuzz/browser.mjs", "utf8");
    const methods = source.slice(source.indexOf("    prepareDrain("), source.indexOf("    storedText("));
    const findings = new FindingBuffer(),
        metrics = { captures: 2, writes: 1 };
    const ctx = vm.createContext({
        findings,
        protocolVersion: 3,
        bootWitness: { documentId: "doc" },
        drainedMetrics: {},
        preparedBatch: null,
        lastAck: null,
        result: () => ({ issues: findings.values(), metrics, coverage: [] })
    });
    const api = vm.runInContext(`({result,${methods}})`, ctx);
    return { api, findings, metrics };
}
test("actual browser drain retains identical prepared payload until durable ACK, with bounded backpressure", () => {
    const { api, findings, metrics } = bridge();
    findings.add({ domain: "persistence", category: "SAVE_REJECTED", ruleCode: "one" });
    const first = api.prepareDrain("A");
    findings.add({ domain: "persistence", category: "SAVE_REJECTED", ruleCode: "one" });
    metrics.captures++;
    assert.equal(api.prepareDrain("A"), first);
    assert.throws(() => api.prepareDrain("B"), /backpressure/);
    assert.equal(first.issues[0].occurrences, 1);
    assert.equal(first.metrics.captures, 2);
    assert.equal(api.ackDrain("A"), true);
    assert.equal(api.ackDrain("A"), true);
    const second = api.prepareDrain("B");
    assert.equal(second.issues[0].occurrences, 1);
    assert.equal(second.metrics.captures, 1);
    assert.throws(() => api.ackDrain("wrong"), /mismatch/);
});
test("duplicate deliveries enrich diagnostic tails once; variants retain their own reproduction", () => {
    const dir = mkdtempSync(join(tmpdir(), "fuzz-evidence-"));
    const reporter = new Reporter(join(dir, "run"), resolve("."));
    try {
        const first = { domain: "persistence", category: "SAVE_REJECTED", evidenceId: "A", snapshot: { x: 1 }, operation: "cold-restore", documentId: "one" };
        const id = reporter.finding(first, { spec: { index: 1 } });
        reporter.finding({ ...first, workerTail: "late causal diagnostic" }, { spec: { index: 1 } });
        reporter.finding({ ...first, evidenceId: "B", snapshot: { x: 2 }, documentId: "two" }, { spec: { index: 2 } });
        const row = [...reporter.issues.values()][0];
        assert.equal(row.occurrences, 2);
        assert.equal(row.variants.length, 2);
        assert.equal(JSON.parse(readFileSync(join(dir, "run", `issues/${id}/enrichment.json`))).workerTail, "late causal diagnostic");
        const meta = JSON.parse(readFileSync(join(dir, "run", `issues/${id}/variant-${row.variants[1]}.meta.json`)));
        assert.equal(meta.documentId, "two");
        assert.equal(JSON.parse(readFileSync(join(dir, "run", meta.reproductionRef))).spec.index, 2);
    } finally {
        reporter.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
test("late exploratory bootstrap failure remains incomplete after all required work passed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fuzz-late-"));
    const reporter = new Reporter(join(dir, "run"), resolve("."));
    const game = JSON.parse(readFileSync("package.json")).name,
        count = casePlan(game).length;
    const config = { game, profile: "qualification", seed: 17, trials: count + 1 };
    try {
        const summary = await runCampaign(config, reporter, async (spec) => ({
            setupComplete: true,
            evidenceComplete: true,
            cleanup: { complete: true },
            explorationCallbacks: spec.frames.length,
            comparedContinuationSteps: 24,
            metrics: {
                validations: 10,
                captures: 10,
                writes: 2,
                restores: 1,
                callbacks: spec.frames.length,
                renders: 10,
                progress: 10,
                gameplayUpdates: 10,
                inputActionsObserved: 10
            },
            issues: spec.index === count ? [{ domain: "bootstrap", category: "FIXTURE_BOOTSTRAP_FAILED", stage: "bridge-import" }] : [],
            incomplete: spec.index === count
        }));
        finalizeCampaign(config, reporter, summary, true);
        assert.equal(summary.exitCode, 2);
        assert.equal(summary.harnessErrors, 1);
        assert.equal(summary.findings, 0);
    } finally {
        reporter.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
test("bootstrap, cleanup and transport targets cannot be shrunk as gameplay failures", async () => {
    const game = JSON.parse(readFileSync("package.json")).name;
    const spec = makeTrial(game, { seed: 17, profile: "qualification", ticks: 80, continuationTicks: 24 }, 0);
    for (const domain of ["bootstrap", "harness", "evidence"]) {
        const issue = { domain, category: "SAME_STRING" };
        const result = await minimizeTrial(spec, issueSignature(issue), async () => ({ setupComplete: true, issues: [issue] }));
        assert.equal(result.verified, false);
    }
});
