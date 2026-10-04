import { GENERATOR_VERSION, mix, framesFor } from "./prng.mjs";
export const PROFILE_VERSION = 1;
export function strata(game) {
    if (game === "ms-pac-man-2010-js") return Array.from({ length: 32 }, (_, index) => ({ stage: index % 8, world: Math.floor(index / 8), hard: false }));
    return Array.from({ length: 12 }, (_, index) => ({ stage: index % 6, world: 0, hard: index >= 6 }));
}
export function stratumId(spec) {
    return `stage:${spec.stage}:world:${spec.world}:hard:${spec.hard}`;
}
export function makeTrial(game, config, index, selectedStratum = null) {
    const options = strata(game);
    const selected = selectedStratum ?? options[index % options.length];
    const seed = mix(config.seed, index);
    const inputSeed = mix(seed, 1),
        scheduleSeed = mix(seed, 2);
    const lane = Math.floor(index / options.length) % 3 === 1 ? "natural" : "spatial";
    const ticks = config.ticks ?? (config.profile === "soak" ? 900 : config.profile === "browser-qualification" ? 120 : 240);
    return {
        formatVersion: 1,
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
export function evaluateCampaign(_config, summary) {
    if (summary.interrupted) return 130;
    if (summary.infrastructureFailures || summary.evidenceIncomplete || summary.incomplete || summary.completed === 0) return 2;
    if (summary.missingCoverage.length || !summary.captures || !summary.writes || !summary.restores || !summary.progress) return 2;
    if (summary.findings > 0) return 1;
    return 0;
}
