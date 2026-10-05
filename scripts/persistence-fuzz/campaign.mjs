import { performance } from "node:perf_hooks";
import { makeTrial, casePlan, missingCaseWork } from "./profiles.mjs";
import { random, mix } from "./prng.mjs";

/** Collector results are provisional until the CLI verifies integrity and finalizes. */
export async function runCampaign(config, reporter, execute, { signal, onProgress = () => {}, now = () => performance.now() } = {}) {
    const started = now(),
        coverage = new Set(),
        corpus = [],
        corpusMarkers = new Set();
    const plan = config.replaySpec
        ? [{ caseId: config.replaySpec.caseId, requestedContext: config.replaySpec, strategy: config.replaySpec.strategy }]
        : casePlan(config.game);
    const selector = random(mix(config.seed, 71));
    let corpusBytes = 0;
    const summary = {
        formatVersion: 2,
        game: config.game,
        profile: config.profile,
        seed: config.seed,
        startedAt: new Date().toISOString(),
        status: "running",
        exitCode: null,
        planCompleted: false,
        stopReason: null,
        plannedCases: config.hours ? null : config.trials,
        attempted: 0,
        completed: 0,
        findings: 0,
        infrastructureFailures: 0,
        captures: 0,
        writes: 0,
        restores: 0,
        callbacks: 0,
        renders: 0,
        progress: 0,
        saveMs: 0,
        saveMaxMs: 0,
        maxSnapshotChars: 0,
        browserVersion: null,
        corpusEntries: 0,
        interrupted: false,
        incomplete: false,
        evidenceIncomplete: false,
        integrityVerified: false,
        missingCoverage: [],
        coverage: [],
        issues: [],
        caseEvidence: Object.fromEntries(plan.map((row) => [row.caseId, { ...row, planned: true }]))
    };
    const refresh = () => {
        summary.elapsedMs = Math.round(now() - started);
        summary.coverage = [...coverage].sort();
        summary.missingCoverage = plan.flatMap((row) => missingCaseWork(summary.caseEvidence[row.caseId]).map((work) => `${row.caseId}:${work}`));
        summary.issues = [...reporter.issues.values()];
        summary.evidenceIncomplete ||= reporter.incomplete;
        summary.completedCases = summary.completed;
        return summary;
    };
    try {
        reporter.atomic("campaign.json", { formatVersion: 2, config, plan });
        reporter.atomic("summary.json", refresh());
        for (let index = 0; index < config.trials; index++) {
            if (signal?.aborted) {
                summary.interrupted = true;
                summary.stopReason = "user";
                break;
            }
            if (config.hours && now() - started >= config.hours * 3600000) {
                summary.planCompleted = true;
                summary.stopReason = "duration-limit";
                break;
            }
            let spec = config.replaySpec ?? makeTrial(config.game, config, index);
            if (config.profile === "soak" && corpus.length && index >= plan.length && index % 3 === 2) {
                const parent = corpus[selector.int(corpus.length)];
                spec = {
                    ...spec,
                    ...parent.checkpoint.captureContext,
                    strategy: "accepted-corpus-branch",
                    lane: "corpus",
                    caseId: `corpus:${index}`,
                    initialCheckpoint: parent.checkpoint,
                    corpusParent: parent.index
                };
            }
            const reproduction = { formatVersion: 2, sourceIdentity: config.sourceIdentity, browserEngine: config.browserEngine, spec };
            reporter.atomic("pending-trial.json", { state: "running", reproduction });
            reporter.event({ event: "trial-start", index, caseId: spec.caseId, strategy: spec.strategy });
            summary.attempted++;
            const delivered = new Set();
            const ingest = (issue) => {
                if (issue.evidenceId && delivered.has(issue.evidenceId)) return;
                const id = reporter.finding(issue, reproduction);
                if (issue.evidenceId) delivered.add(issue.evidenceId);
                summary.findings += issue.occurrences ?? 1;
                onProgress({ event: "finding", index, id, category: issue.category });
            };
            let result;
            try {
                result = await execute(spec, {
                    onEvidence: (packet) => {
                        for (const issue of packet.issues ?? []) ingest(issue);
                        if (packet.checkpoint) reporter.atomic("last-checkpoint.json", { index, checkpoint: packet.checkpoint });
                        reporter.atomic("last-progress.json", { index, ...packet, checkpoint: undefined, issues: undefined });
                    }
                });
            } catch (error) {
                result = { infrastructureFailure: { name: error.name, message: error.message }, issues: [] };
            }
            // Partial findings precede EVERY termination branch.
            for (const issue of result.issues ?? [])
                ingest({ ...issue, actualPlacement: result.actualPlacement, lastPhase: result.lastPhase, workerTail: result.workerTail });
            if (result.infrastructureFailure) {
                summary.infrastructureFailures++;
                reporter.finding({ category: "INFRASTRUCTURE_FAILURE", error: result.infrastructureFailure, workerTail: result.workerTail }, reproduction);
            }
            summary.incomplete ||= Boolean(result.incomplete);
            summary.interrupted ||= Boolean(result.interrupted);
            const metrics = result.metrics ?? {};
            const row = {
                requestedContext: { stage: spec.stage, world: spec.world, hard: spec.hard },
                observedStartContext: result.observedStartContext,
                strategy: spec.strategy,
                setupCompleted: result.setupComplete === true,
                callbacksRequested: spec.frames.length,
                callbacksExecuted: result.explorationCallbacks ?? 0,
                gameplayUpdates: (result.explorationMetrics ?? metrics).gameplayUpdates ?? 0,
                autonomousUpdates: (result.explorationMetrics ?? metrics).autonomousUpdates ?? 0,
                inputActionsObserved: (result.explorationMetrics ?? metrics).inputActionsObserved ?? 0,
                captures: metrics.captures ?? 0,
                validatedSnapshots: metrics.validations ?? 0,
                acceptedWrites: metrics.writes ?? 0,
                coldRestores: metrics.restores ?? 0,
                comparedContinuationSteps: result.comparedContinuationSteps ?? 0,
                observedMarkers: result.coverage ?? [],
                issues: result.issues?.length ?? 0,
                termination: result.interrupted ? "interrupted" : result.incomplete || result.infrastructureFailure ? "incomplete" : "completed"
            };
            row.missingMarkers = missingCaseWork(row);
            // Every invocation is retained; later work cannot hide an inert required case.
            reporter.atomic(`cases/${index}.json`, { formatVersion: 2, caseId: spec.caseId, ...row });
            if (!summary.caseEvidence[spec.caseId]?.termination) summary.caseEvidence[spec.caseId] = { ...summary.caseEvidence[spec.caseId], ...row };
            for (const marker of result.coverage ?? []) coverage.add(marker);
            for (const key of ["saveMaxMs", "maxSnapshotChars"]) summary[key] = Math.max(summary[key], metrics[key] ?? 0);
            for (const key of ["captures", "writes", "restores", "callbacks", "renders", "progress", "saveMs"]) summary[key] += metrics[key] ?? 0;
            summary.browserVersion = result.browserVersion ?? summary.browserVersion;
            if (result.saveBenchmark) reporter.atomic(`save-benchmark-${index}.json`, result.saveBenchmark);
            const novelty = (result.coverage ?? []).filter((marker) => !corpusMarkers.has(marker));
            if (
                config.profile === "soak" &&
                result.acceptedCheckpoint?.captureContext &&
                !result.issues?.length &&
                !result.infrastructureFailure &&
                !result.incomplete &&
                !result.interrupted &&
                novelty.length &&
                corpus.length < 32
            ) {
                const entry = { index, checkpoint: result.acceptedCheckpoint, coverage: novelty };
                const bytes = Buffer.byteLength(JSON.stringify(entry));
                if (corpusBytes + bytes <= 8 * 1024 * 1024) {
                    reporter.atomic(`corpus/${index}.json`, { formatVersion: 2, sourceIdentity: config.sourceIdentity.digest, ...entry });
                    corpus.push(entry);
                    corpusBytes += bytes;
                    for (const marker of result.coverage ?? []) corpusMarkers.add(marker);
                }
            }
            summary.corpusEntries = corpus.length;
            if (row.missingMarkers.length === 0) summary.completed++;
            reporter.event({ event: "trial-finish", index, caseId: spec.caseId, ...row });
            reporter.atomic("pending-trial.json", { state: row.termination, index, reproduction });
            reporter.atomic("summary.json", refresh());
            onProgress({ event: "trial-finish", index, summary: { ...summary, issues: summary.issues.length, coverage: summary.coverage.length } });
            if (summary.interrupted) {
                summary.stopReason = "user";
                break;
            }
            if (summary.infrastructureFailures >= 3) {
                summary.incomplete = true;
                summary.stopReason = "infrastructure";
                break;
            }
            if (index + 1 === config.trials || config.replaySpec) {
                summary.planCompleted = !config.hours;
                summary.stopReason = config.hours ? "trial-cap" : "trial-limit";
                break;
            }
        }
    } catch (error) {
        summary.evidenceIncomplete ||= reporter.incomplete;
        summary.infrastructureFailures++;
        summary.stopReason = reporter.incomplete ? "evidence-budget" : "infrastructure";
        summary.failure = { name: error.name, message: error.message };
    } finally {
        summary.interrupted ||= Boolean(signal?.aborted);
        if (summary.interrupted) summary.stopReason = "user";
        refresh();
        // Even the last campaign summary remains explicitly provisional.
        try {
            reporter.atomic("summary.json", summary);
        } catch {
            summary.evidenceIncomplete = true;
        }
    }
    return summary;
}
