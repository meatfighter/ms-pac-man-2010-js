import { performance } from "node:perf_hooks";
import { makeTrial, requiredMarkers, evaluateCampaign } from "./profiles.mjs";
import { random, mix } from "./prng.mjs";

/** Injectable executor keeps collector tests independent of browser availability. */
export async function runCampaign(config, reporter, execute, { signal, onProgress = () => {}, now = () => performance.now() } = {}) {
    const started = now(),
        coverage = new Set(),
        visits = new Map();
    const required = config.replaySpec ? [] : [...requiredMarkers(config.game), ...(config.requireLanes ? ["lane:natural", "lane:spatial"] : [])];
    const corpus = [],
        corpusMarkers = new Set();
    let corpusBytes = 0;
    const stageMarkers = requiredMarkers(config.game);
    const selector = random(mix(config.seed, 71));
    const summary = {
        game: config.game,
        profile: config.profile,
        seed: config.seed,
        startedAt: new Date().toISOString(),
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
        missingCoverage: [...required],
        coverage: [],
        issues: [],
        exitCode: null
    };
    const finishSummary = () => {
        summary.elapsedMs = Math.round(now() - started);
        summary.coverage = [...coverage].sort();
        summary.missingCoverage = required.filter((marker) => !coverage.has(marker));
        summary.issues = [...reporter.issues.values()];
        summary.evidenceIncomplete = reporter.incomplete;
        summary.exitCode = evaluateCampaign(config, summary);
        return summary;
    };
    try {
        reporter.atomic("campaign.json", { formatVersion: 1, config });
        reporter.atomic("summary.json", finishSummary());
        for (let index = 0; index < config.trials; index++) {
            if (signal?.aborted) {
                summary.interrupted = true;
                break;
            }
            if (config.hours && now() - started >= config.hours * 3600000) break;
            let spec = config.replaySpec ?? makeTrial(config.game, config, index);
            // The first sweep is stratified. Later overnight trials prefer strata
            // with fewer useful state markers, without consulting the validator.
            if (config.profile === "soak" && index >= stageMarkers.length + 1 && !config.replaySpec) {
                const candidates = Array.from({ length: stageMarkers.length }, (_, candidate) => makeTrial(config.game, config, candidate));
                candidates.sort((a, b) => (visits.get(stageMarkers[a.index]) ?? 0) - (visits.get(stageMarkers[b.index]) ?? 0));
                const selected = candidates[selector.int(Math.max(1, Math.ceil(candidates.length / 3)))];
                spec = makeTrial(config.game, config, index, { stage: selected.stage, world: selected.world, hard: selected.hard });
            }
            if (config.profile === "soak" && corpus.length && index >= stageMarkers.length + 1 && index % 3 === 2) {
                const parent = corpus[selector.int(corpus.length)];
                spec = {
                    ...spec,
                    stage: parent.stage,
                    world: parent.world,
                    hard: parent.hard,
                    initialCheckpoint: parent.checkpoint,
                    corpusParent: parent.index
                };
            }
            const reproduction = { formatVersion: 1, sourceIdentity: config.sourceIdentity, browserEngine: config.browserEngine, spec };
            reporter.atomic("pending-trial.json", { state: "running", reproduction });
            reporter.event({ event: "trial-start", index, seed: spec.seed, stage: spec.stage, world: spec.world, hard: spec.hard, lane: spec.lane });
            summary.attempted++;
            let result;
            try {
                result = await execute(spec);
            } catch (error) {
                result = { infrastructureFailure: { name: error.name, message: error.message }, issues: [], metrics: {}, coverage: [] };
            }
            if (result.interrupted) {
                summary.interrupted = true;
                break;
            }
            if (result.infrastructureFailure) {
                summary.infrastructureFailures++;
                reporter.finding({ category: "INFRASTRUCTURE_FAILURE", error: result.infrastructureFailure, workerTail: result.workerTail }, reproduction);
            }
            if (result.incomplete) summary.incomplete = true;
            for (const issue of result.issues ?? []) {
                const id = reporter.finding(
                    { ...issue, actualPlacement: result.actualPlacement, workerTail: result.workerTail, lastPhase: result.lastPhase },
                    reproduction
                );
                summary.findings++;
                onProgress({ event: "finding", index, id, category: issue.category });
            }
            const novelty = (result.coverage ?? []).filter((marker) => !corpusMarkers.has(marker));
            if (
                config.profile === "soak" &&
                result.acceptedCheckpoint &&
                !result.issues?.length &&
                !result.infrastructureFailure &&
                !result.incomplete &&
                novelty.length &&
                corpus.length < 32
            ) {
                const entry = { index, stage: spec.stage, world: spec.world, hard: spec.hard, checkpoint: result.acceptedCheckpoint, coverage: novelty };
                const bytes = Buffer.byteLength(JSON.stringify(entry));
                if (corpusBytes + bytes <= 8 * 1024 * 1024) {
                    reporter.atomic(`corpus/${index}.json`, { formatVersion: 1, sourceIdentity: config.sourceIdentity.digest, ...entry });
                    corpus.push(entry);
                    corpusBytes += bytes;
                    for (const marker of result.coverage ?? []) corpusMarkers.add(marker);
                    reporter.event({ event: "corpus-admitted", index, novelty, bytes, corpusBytes });
                }
            }
            for (const marker of result.coverage ?? []) coverage.add(marker);
            if (result.saveBenchmark) reporter.atomic(`save-benchmark-${index}.json`, result.saveBenchmark);
            summary.browserVersion = result.browserVersion ?? summary.browserVersion;
            summary.corpusEntries = corpus.length;
            for (const key of ["saveMaxMs", "maxSnapshotChars"]) summary[key] = Math.max(summary[key], result.metrics?.[key] ?? 0);
            for (const key of ["captures", "writes", "restores", "callbacks", "renders", "progress", "saveMs"]) summary[key] += result.metrics?.[key] ?? 0;
            for (const marker of required)
                if ((result.coverage ?? []).includes(marker)) visits.set(marker, (visits.get(marker) ?? 0) + (result.coverage?.length ?? 1));
            summary.completed++;
            reporter.atomic("pending-trial.json", { state: "finished", index, seed: spec.seed });
            reporter.event({
                event: "trial-finish",
                index,
                issues: result.issues?.length ?? 0,
                metrics: result.metrics ?? {},
                placement: result.actualPlacement,
                coverage: result.coverage ?? []
            });
            reporter.atomic("summary.json", finishSummary());
            onProgress({ event: "trial-finish", index, summary: { ...summary, issues: summary.issues.length, coverage: summary.coverage.length } });
            // Systemic startup failures are not game findings. Avoid an overnight
            // loop of missing dependencies; never turn the incomplete run green.
            if (summary.infrastructureFailures >= 3) {
                summary.incomplete = true;
                break;
            }
            if (config.replaySpec) break;
        }
    } catch (error) {
        summary.evidenceIncomplete = reporter.incomplete;
        summary.infrastructureFailures++;
        summary.failure = { name: error.name, message: error.message };
    } finally {
        if (signal?.aborted) summary.interrupted = true;
        finishSummary();
        try {
            reporter.atomic("summary.json", summary);
        } catch {
            summary.evidenceIncomplete = true;
            summary.exitCode = 2;
        }
        reporter.close();
    }
    return summary;
}
