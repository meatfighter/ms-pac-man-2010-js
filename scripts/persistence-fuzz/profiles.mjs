import { GENERATOR_VERSION, mix, framesFor } from "./prng.mjs";
export const PROFILE_VERSION = 2;
export function strata(game) {
    if (game === "ms-pac-man-2010-js") return Array.from({ length: 32 }, (_, index) => ({ stage: index % 8, world: Math.floor(index / 8), hard: false }));
    return Array.from({ length: 12 }, (_, index) => ({ stage: index % 6, world: 0, hard: index >= 6 }));
}
export function stratumId(spec) {
    return `stage:${spec.stage}:world:${spec.world}:hard:${spec.hard}`;
}
export function makeTrial(game, config, index, selectedStratum = null) {
    const options = strata(game);
    const planned = casePlan(game)[index];
    const selected = selectedStratum ?? planned?.requestedContext ?? options[index % options.length];
    const seed = mix(config.seed, index);
    const inputSeed = mix(seed, 1),
        scheduleSeed = mix(seed, 2);
    const lane = planned?.lane ?? (Math.floor(index / options.length) % 2 === 1 ? "natural" : "spatial");
    const ticks = config.ticks ?? (config.profile === "soak" ? 900 : config.profile === "browser-qualification" ? 120 : 240);
    return {
        formatVersion: 2,
        generatorVersion: GENERATOR_VERSION,
        profileVersion: PROFILE_VERSION,
        game,
        index,
        seed,
        setupSeed: mix(seed, 0),
        inputSeed,
        scheduleSeed,
        gameSeed: mix(seed, 3),
        ...selected,
        lane,
        strategy: planned?.strategy ?? `${lane}-entry`,
        caseId: planned?.caseId ?? `${stratumId(selected)}:${lane}-entry`,
        ...(planned?.targetRegion ? { targetRegion: planned.targetRegion } : {}),
        ...(planned?.recordingBoundary ? { recordingBoundary: planned.recordingBoundary } : {}),
        audio: config.audio ?? "controlled",
        frames: framesFor(inputSeed, scheduleSeed, ticks, game),
        continuation: framesFor(mix(inputSeed, 4), mix(scheduleSeed, 4), config.continuationTicks ?? 24, game),
        writeEvery: config.writeEvery ?? 17,
        observerControl: index % 4 === 0,
        lifecycle: config.profile === "browser-qualification" || index % 8 === 0
    };
}
export function requiredMarkers(game) {
    return strata(game).map(stratumId);
}
export function casePlan(game) {
    const plan = ["spatial", "natural"].flatMap((lane) =>
        strata(game).map((context) => ({
            caseId: `${stratumId(context)}:${lane}-entry`,
            requestedContext: context,
            strategy: `${lane}-entry`,
            lane
        }))
    );
    if (game === "stickvania-js") {
        // Loaded topology census: every nonempty checkpointless region, both difficulties.
        // Zero-width terminal partitions (stage 0/segment 0/region 4 and 2/0/1)
        // have no player footprint/active entry door; retain them in each census.
        const targets = [
            [[1, 0]],
            [
                [1, 1],
                [2, 1],
                [3, 0]
            ],
            [
                [1, 0],
                [2, 0]
            ],
            [],
            [
                [1, 0],
                [2, 1],
                [3, 0]
            ],
            [
                [1, 1],
                [2, 0]
            ]
        ];
        for (const hard of [false, true])
            for (const [stage, regions] of targets.entries())
                for (const [segment, region] of regions) {
                    const context = { stage, world: 0, hard };
                    plan.push({
                        caseId: `${stratumId(context)}:checkpointless:${segment}:${region}`,
                        requestedContext: context,
                        strategy: "explicit-boundary",
                        lane: "spatial",
                        targetRegion: { segment, region }
                    });
                }
    }
    if (game === "ms-pac-man-2010-js")
        for (let index = 0; index < 4; index++)
            for (const offset of [-1, 0, 1]) {
                const context = { stage: index, world: index, hard: false };
                plan.push({
                    caseId: `recording:${index}:${offset}`,
                    requestedContext: context,
                    strategy: "explicit-boundary",
                    lane: "natural",
                    recordingBoundary: { index, offset }
                });
            }
    return plan;
}
export function missingCaseWork(row) {
    const missing = [];
    if (!row?.setupCompleted) missing.push("setup");
    if (!row?.observedMarkers?.length) missing.push("observed-markers");
    for (const key of [
        "callbacksExecuted",
        "gameplayUpdates",
        "inputActionsObserved",
        "captures",
        "validatedSnapshots",
        "acceptedWrites",
        "coldRestores",
        "comparedContinuationSteps"
    ])
        if (!(row?.[key] > 0)) missing.push(key);
    if (row?.callbacksExecuted < row?.callbacksRequested) missing.push("requested-callbacks");
    if (row?.termination !== "completed") missing.push("termination");
    return missing;
}
export function evaluateCampaign(_config, summary) {
    if (summary.status === "running") return null;
    if (summary.interrupted) return 130;
    if (
        !summary.planCompleted ||
        !summary.integrityVerified ||
        summary.infrastructureFailures ||
        summary.harnessErrors ||
        summary.evidenceIncomplete ||
        summary.incomplete ||
        summary.completed === 0
    )
        return 2;
    if (summary.missingCoverage.length || !summary.captures || !summary.writes || !summary.restores || !summary.progress) return 2;
    if (summary.findings > 0) return 1;
    return 0;
}
