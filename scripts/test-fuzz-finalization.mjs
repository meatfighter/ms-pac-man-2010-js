import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Reporter } from "./persistence-fuzz/reporter.mjs";
import { finalizeCampaign } from "./persistence-fuzz/finalize.mjs";
test("exhausted finalization replaces a stale success summary with an explicit reserved failure", () => {
    const dir = mkdtempSync(join(tmpdir(), "fuzz-finalize-")),
        reporter = new Reporter(join(dir, "run"), resolve("."));
    try {
        reporter.atomic("summary.json", { status: "completed", exitCode: 0 });
        reporter.budget = reporter.bytes;
        const summary = {
            planCompleted: true,
            interrupted: false,
            incomplete: false,
            infrastructureFailures: 0,
            evidenceIncomplete: false,
            missingCoverage: [],
            completed: 1,
            findings: 1,
            captures: 2,
            writes: 1,
            restores: 1,
            progress: 1,
            issues: []
        };
        finalizeCampaign({}, reporter, summary, true);
        assert.equal(summary.exitCode, 2);
        assert.equal(JSON.parse(readFileSync(join(dir, "run/summary.json"))).exitCode, 2);
        assert.equal(JSON.parse(readFileSync(join(dir, "run/terminal.json"))).exitCode, 2);
    } finally {
        reporter.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
