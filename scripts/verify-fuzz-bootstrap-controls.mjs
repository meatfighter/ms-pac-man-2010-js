import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { supervisedTrial } from "./persistence-fuzz/supervisor.mjs";
import { sourceIdentity, inventory } from "./persistence-fuzz/identity.mjs";
import { makeTrial } from "./persistence-fuzz/profiles.mjs";
import { Reporter } from "./persistence-fuzz/reporter.mjs";
import { eligibleFinding } from "./persistence-fuzz/failure-protocol.mjs";
const repo = resolve("."),
    game = JSON.parse(readFileSync("package.json")).name;
const identity = sourceIdentity(repo),
    before = inventory(repo, true);
const directory = resolve(repo, "..", "qualification-evidence", `${game}-bootstrap-controls-${Date.now()}`);
const reporter = new Reporter(directory, repo);
const rows = [];
try {
    for (const browserEngine of ["chromium", "firefox"])
        for (const [index, fixtureFault] of [null, null, "html-500", "module-missing", "configure", "restore-false", "final-drain-missing"].entries()) {
            const spec = makeTrial(game, { seed: 0x20261004, profile: "qualification", ticks: 80, continuationTicks: 24 }, 0);
            const result = await supervisedTrial(
                { repo, spec, browserEngine, fixtureFault, sourceIdentity: identity },
                {
                    onEvidence: (packet) => {
                        if (packet.context) reporter.atomic(`trials/${browserEngine}-${index}/context.json`, packet.context);
                        for (const issue of packet.issues ?? []) reporter.finding(issue, { spec, browserEngine, fixtureFault });
                    }
                }
            );
            reporter.atomic(`result-${browserEngine}-${index}.json`, { ...result, acceptedCheckpoint: undefined });
            rows.push({
                browserEngine,
                fixtureFault,
                browserVersion: result.browserVersion,
                cleanup: result.cleanup,
                workerExit: result.workerExit,
                issues: result.issues
            });
            assert.equal(result.cleanup?.complete, true, JSON.stringify(result.infrastructureFailure));
            assert.equal(result.workerExit.code, 0);
            if (fixtureFault === null) {
                assert.deepEqual(result.issues, []);
                assert.ok(result.acceptedCheckpoint);
                assert.equal(result.evidenceComplete, true);
            } else if (fixtureFault === "restore-false") {
                const rejection = result.issues.find((issue) => issue.category === "SAVE_SUCCEEDED_RESTORE_REJECTED");
                assert.ok(eligibleFinding(rejection));
                assert.equal(rejection.restoreWitness.returned, false);
            } else {
                assert.equal(result.incomplete, true);
                assert.equal(result.acceptedCheckpoint, undefined);
                assert.ok(result.issues.length);
                assert.ok(result.issues.every((issue) => !eligibleFinding(issue)));
            }
            console.log(`${browserEngine}: ${fixtureFault ?? "clean cold/observer/departure"} passed`);
        }
    assert.deepEqual(inventory(repo, true), before);
    assert.equal(sourceIdentity(repo).digest, identity.digest);
    reporter.atomic("controls.json", { protocolVersion: 3, identity, rows, status: "passed" });
} finally {
    reporter.close();
}
console.log(directory);
