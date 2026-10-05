import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { seed32, GENERATOR_VERSION } from "./prng.mjs";
import { strata, casePlan, PROFILE_VERSION } from "./profiles.mjs";
import { Reporter } from "./reporter.mjs";
import { sourceIdentity, inventory } from "./identity.mjs";
import { supervisedTrial } from "./supervisor.mjs";
import { runCampaign } from "./campaign.mjs";
import { assertCheckpoint } from "./checkpoint.mjs";
import { readSemanticFloor } from "./semantic-floor.mjs";
import { finalizeCampaign } from "./finalize.mjs";
import { minimizeTrial } from "./shrink.mjs";

export const HELP = `Persistence fuzz campaign (test-only, requires installed dev dependencies and real game resources)

  npm run verify:persistence-fuzz
  npm run verify:persistence-fuzz:browsers
  npm run fuzz:persistence:soak -- --hours=10 --seed=0x20261004 --artifacts=../qualification-evidence/my-run
  npm run fuzz:persistence:replay -- --replay=../qualification-evidence/my-run/issues/<id>/repro.json

Options:
  --profile=qualification|browser-qualification|soak|replay
  --hours=N                 Soak duration (default 8). Stops between trials.
  --trials=N                Limit trials instead of a duration; first sweep is stratified.
  --seed=UINT32             Decimal or hexadecimal master seed, logged immediately.
  --ticks=N                 Outer update callbacks per trial (not assumed fixed ticks).
  --continuation-ticks=N    Original-vs-restored continuation length (default 24).
  --write-every=N           Full store write frequency; transitions also trigger writes.
  --timeout-ms=N            Hard per-trial process-tree watchdog (default 180000).
  --engine=chromium|firefox|webkit
  --executable=PATH         Optional browser executable, no automatic installation.
  --audio=controlled|native Controlled logical-transport lane is reproducible;
                           native-audio lane is observational/environment-sensitive.
  --artifacts=PATH          NEW directory outside the repository. Never dist.
  --max-evidence-mib=N      Disk budget (default 128); exhaustion is incomplete.
  --replay=PATH             Replay exact recorded setup/input/schedule; same source required.
  --allow-source-drift      Explicit replay-only override to verify a proposed repair.
  --shrink                 Replay-only bounded minimization after reproducing a finding.
  --max-shrink-attempts=N   Independent fresh trials (default 32). Original evidence stays intact.
  --help

Both profiles log/deduplicate findings and continue with fresh trials.
Exit codes: 0 complete pass, 1 completed with findings, 2 incomplete/infrastructure,
130 user interruption. No production builds, dependency installs, Actions or deployment.
`;
const integer = (text, name, min, max) => {
    if (!/^\d+$/.test(String(text))) throw new Error(`${name} must be an integer`);
    const value = Number(text);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}`);
    return value;
};
export function parseArgs(args, game) {
    const raw = {};
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
        const split = arg.indexOf("=");
        const name = split < 0 ? arg.slice(2) : arg.slice(2, split);
        if (Object.hasOwn(raw, name)) throw new Error(`Duplicate option: --${name}`);
        if (["help", "allow-source-drift", "shrink"].includes(name)) {
            if (split >= 0) throw new Error(`--${name} takes no value`);
            raw[name] = true;
            continue;
        }
        const value = split < 0 ? args[++index] : arg.slice(split + 1);
        if (!value || value.startsWith("--")) throw new Error(`Missing value for --${name}`);
        raw[name] = value;
    }
    const supported = new Set([
        "help",
        "allow-source-drift",
        "profile",
        "hours",
        "trials",
        "seed",
        "ticks",
        "continuation-ticks",
        "write-every",
        "timeout-ms",
        "engine",
        "executable",
        "audio",
        "artifacts",
        "max-evidence-mib",
        "replay",
        "shrink",
        "max-shrink-attempts"
    ]);
    for (const key of Object.keys(raw)) if (!supported.has(key)) throw new Error(`Unknown option: --${key}`);
    if (raw.help) return { help: true };
    const profile = raw.profile ?? "qualification";
    if (!["qualification", "browser-qualification", "soak", "replay"].includes(profile)) throw new Error("Invalid campaign profile");
    if (profile === "replay" && !raw.replay) throw new Error("Replay profile requires --replay");
    if (raw.hours && profile !== "soak") throw new Error("--hours is only valid for the soak profile");
    if (raw.hours && raw.trials) throw new Error("Select --hours or --trials, not both");
    const hours = raw.hours ? Number(raw.hours) : profile === "soak" && !raw.trials ? 8 : null;
    if (hours !== null && (!Number.isFinite(hours) || hours <= 0 || hours > 168)) throw new Error("--hours must be greater than zero and at most 168");
    const browserEngine = raw.engine ?? "chromium";
    if (!["chromium", "firefox", "webkit"].includes(browserEngine)) throw new Error("Unsupported browser engine");
    const audio = raw.audio ?? "controlled";
    if (!["controlled", "native"].includes(audio)) throw new Error("Unsupported audio lane");
    const seed = raw.seed ? seed32(raw.seed) : profile === "soak" ? randomBytes(4).readUInt32LE() : 0x20261004;
    const config = {
        game,
        requireLanes: true,
        command: [process.execPath, ...process.argv.slice(1)],
        profile,
        seed,
        hours,
        browserEngine,
        audio,
        trials: raw.trials ? integer(raw.trials, "--trials", 1, 10000000) : profile === "soak" ? 10000000 : casePlan(game).length,
        timeoutMs: raw["timeout-ms"] ? integer(raw["timeout-ms"], "--timeout-ms", 100, 3600000) : 180000,
        evidenceBudget: (raw["max-evidence-mib"] ? integer(raw["max-evidence-mib"], "--max-evidence-mib", 1, 4096) : 128) * 1024 * 1024,
        artifacts: raw.artifacts,
        executablePath: raw.executable,
        replay: raw.replay,
        allowSourceDrift: Boolean(raw["allow-source-drift"])
    };
    if (raw.ticks) config.ticks = integer(raw.ticks, "--ticks", 1, 1000000);
    if (raw["continuation-ticks"]) config.continuationTicks = integer(raw["continuation-ticks"], "--continuation-ticks", 1, 1000);
    if (raw["write-every"]) config.writeEvery = integer(raw["write-every"], "--write-every", 1, 1000000);
    if (config.allowSourceDrift && !config.replay) throw new Error("--allow-source-drift requires --replay");
    config.shrink = Boolean(raw.shrink);
    config.maxShrinkAttempts = raw["max-shrink-attempts"] ? integer(raw["max-shrink-attempts"], "--max-shrink-attempts", 1, 10000) : 32;
    if ((config.shrink || raw["max-shrink-attempts"]) && !config.replay) throw new Error("Minimization requires --replay");
    return config;
}
export async function main(args = process.argv.slice(2)) {
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    const game = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).name;
    const config = parseArgs(args, game);
    if (config.help) {
        console.log(HELP);
        return 0;
    }
    config.repo = repo;
    config.sourceIdentity = sourceIdentity(repo);
    if (config.replay) {
        const bytes = readFileSync(resolve(config.replay));
        if (bytes.length > 32 * 1024 * 1024) throw new Error("Replay file exceeds 32 MiB");
        const document = JSON.parse(bytes);
        const replay = document.reproduction ?? document;
        if (replay.formatVersion !== 2 || replay.spec?.game !== game || !Array.isArray(replay.spec.frames) || !Array.isArray(replay.spec.continuation))
            throw new Error("Unsupported replay document");
        if (
            !config.allowSourceDrift &&
            (replay.sourceIdentity?.digest !== config.sourceIdentity.digest || replay.sourceIdentity?.engineDigest !== config.sourceIdentity.engineDigest)
        )
            throw new Error("Replay source identity differs; use --allow-source-drift explicitly when verifying a repair");
        for (const frame of [...replay.spec.frames, ...replay.spec.continuation]) {
            if (
                !Number.isInteger(frame.mask) ||
                frame.mask < 0 ||
                frame.mask > 255 ||
                !Number.isFinite(frame.deltaMs) ||
                frame.deltaMs <= 0 ||
                frame.deltaMs > 1000 ||
                !Number.isInteger(frame.renderCount) ||
                frame.renderCount < 0 ||
                frame.renderCount > 8
            )
                throw new Error("Invalid replay frame");
        }
        const saved = replay.spec;
        if (saved.initialCheckpoint !== undefined) {
            const entry = saved.initialCheckpoint;
            if (
                typeof entry?.text !== "string" ||
                entry.text.length > 4 * 1024 * 1024 ||
                !Number.isFinite(entry.clock) ||
                entry.clock < 1_000_000 ||
                !Number.isSafeInteger(saved.corpusParent)
            )
                throw new Error("Invalid corpus replay checkpoint");
            assertCheckpoint(entry, config.sourceIdentity, config.allowSourceDrift);
            JSON.parse(entry.text);
        }
        if (
            saved.formatVersion !== 2 ||
            saved.generatorVersion !== GENERATOR_VERSION ||
            saved.profileVersion !== PROFILE_VERSION ||
            !["natural", "spatial", "corpus"].includes(saved.lane) ||
            !["controlled", "native"].includes(saved.audio) ||
            !Number.isSafeInteger(saved.writeEvery) ||
            saved.writeEvery < 1 ||
            saved.writeEvery > 1000000 ||
            saved.frames.length < 1 ||
            saved.frames.length > 1000000 ||
            saved.continuation.length > 1000 ||
            (!saved.initialCheckpoint &&
                !strata(game).some((stratum) => stratum.stage === saved.stage && stratum.world === saved.world && stratum.hard === saved.hard))
        )
            throw new Error("Replay recipe/version is not supported by this game");
        for (const key of ["seed", "setupSeed", "inputSeed", "scheduleSeed", "gameSeed"]) seed32(String(saved[key]));
        config.replayTargetSignature = replay.targetSignature ?? null;
        config.replaySpec = saved;
        config.seed = replay.spec.seed;
        config.trials = 1;
        config.hours = null;
        config.browserEngine = replay.browserEngine ?? config.browserEngine;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const directory = config.artifacts ?? resolve(repo, "..", "qualification-evidence", `${game}-persistence-fuzz-${stamp}-${randomBytes(3).toString("hex")}`);
    const reporter = new Reporter(directory, repo, config.evidenceBudget);
    const beforeDist = inventory(repo, true);
    reporter.atomic("retained-dist-before.json", beforeDist);
    console.log(`Persistence fuzz ${game}: profile=${config.profile}, seed=0x${config.seed.toString(16)}, evidence=${reporter.directory}`);
    const stop = new AbortController();
    const interrupt = () => stop.abort();
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
    let summary;
    try {
        summary = await runCampaign(
            config,
            reporter,
            (spec, { onEvidence }) =>
                supervisedTrial(
                    {
                        repo,
                        spec,
                        sourceIdentity: config.sourceIdentity,
                        allowSourceDrift: config.allowSourceDrift,
                        browserEngine: config.browserEngine,
                        executablePath: config.executablePath
                    },
                    { timeoutMs: config.timeoutMs, signal: stop.signal, onEvidence }
                ),
            {
                signal: stop.signal,
                onProgress(event) {
                    if (event.event === "finding") console.error(`Finding ${event.id}: ${event.category}, trial ${event.index}`);
                    else
                        console.log(
                            `Trial ${event.index + 1}: ${event.summary.captures} captures; ${event.summary.writes} writes; ${event.summary.restores} restores; ${event.summary.issues} distinct issues`
                        );
                }
            }
        );
        if (config.shrink && summary.findings > 0 && !summary.infrastructureFailures && config.replaySpec) {
            const target = config.replayTargetSignature ?? summary.issues.find((row) => row.category !== "INFRASTRUCTURE_FAILURE")?.signature;
            if (target) {
                const reduction = await minimizeTrial(
                    config.replaySpec,
                    target,
                    (spec) =>
                        supervisedTrial(
                            {
                                repo,
                                spec,
                                sourceIdentity: config.sourceIdentity,
                                allowSourceDrift: config.allowSourceDrift,
                                browserEngine: config.browserEngine,
                                executablePath: config.executablePath
                            },
                            { timeoutMs: config.timeoutMs, signal: stop.signal }
                        ),
                    {
                        maxAttempts: config.maxShrinkAttempts,
                        signal: stop.signal,
                        onProgress(value) {
                            reporter.atomic("minimization-progress.json", value);
                        }
                    }
                );
                reporter.atomic("minimization.json", reduction);
                if (reduction.verified)
                    reporter.atomic("minimized-repro.json", {
                        formatVersion: 2,
                        sourceIdentity: config.sourceIdentity,
                        browserEngine: config.browserEngine,
                        targetSignature: target,
                        spec: reduction.spec
                    });
                if (reduction.interrupted) {
                    summary.interrupted = true;
                    summary.exitCode = 130;
                }
            }
        }
    } finally {
        process.removeListener("SIGINT", interrupt);
        process.removeListener("SIGTERM", interrupt);
    }
    let afterIdentity = {},
        afterDist = null;
    try {
        afterIdentity = sourceIdentity(repo);
        afterDist = inventory(repo, true);
    } catch (error) {
        summary.incomplete = true;
        summary.integrityFailure = String(error);
    }
    const unchanged =
        afterIdentity.digest === config.sourceIdentity.digest &&
        afterIdentity.engineDigest === config.sourceIdentity.engineDigest &&
        JSON.stringify(beforeDist) === JSON.stringify(afterDist);
    if (!unchanged) {
        summary.incomplete = true;
        console.error("Source or retained dist changed during the campaign. This is incomplete, not a passing qualification.");
    }
    // Integrity reports precede the single terminal coordinator.
    try {
        reporter.atomic("retained-dist-after.json", afterDist);
        reporter.atomic("integrity.json", {
            sourceUnchanged: afterIdentity.digest === config.sourceIdentity.digest,
            engineUnchanged: afterIdentity.engineDigest === config.sourceIdentity.engineDigest,
            distUnchanged: JSON.stringify(beforeDist) === JSON.stringify(afterDist)
        });
    } catch (error) {
        summary.evidenceIncomplete = true;
        console.error(error.message);
    }
    if (!config.replaySpec) {
        try {
            const semantic = readSemanticFloor(repo, config.sourceIdentity);
            reporter.atomic("semantic-floor.json", semantic);
            summary.missingCoverage.push(...semantic.missing.map((group) => `semantic:${group}`));
        } catch (error) {
            summary.evidenceIncomplete = true;
            summary.semanticFailure = String(error);
        }
    }
    finalizeCampaign(config, reporter, summary, unchanged);
    console.log(JSON.stringify({ ...summary, coverage: summary.coverage.length, issues: summary.issues }, null, 2));
    return summary.exitCode;
}
