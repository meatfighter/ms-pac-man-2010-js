import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { seed32, random, framesFor, mix } from "./persistence-fuzz/prng.mjs";
import { makeTrial, strata, casePlan, requiredMarkers, evaluateCampaign } from "./persistence-fuzz/profiles.mjs";
import { normalizeSnapshot, firstDifference, issueSignature, snapshotTransitionKey } from "./persistence-fuzz/compare.mjs";
import { Reporter, assertExternalPath } from "./persistence-fuzz/reporter.mjs";
import { finalizeCampaign } from "./persistence-fuzz/finalize.mjs";
import { runCampaign as collectCampaign } from "./persistence-fuzz/campaign.mjs";
import { parseArgs } from "./persistence-fuzz/cli.mjs";
import { supervisedTrial } from "./persistence-fuzz/supervisor.mjs";
import { assertNoFuzzInRelease } from "./persistence-fuzz/guard.mjs";

async function runCampaign(config, reporter, execute, options) {
    const result = await collectCampaign(config, reporter, execute, options);
    return finalizeCampaign(config, reporter, result, true);
}
const game = JSON.parse(readFileSync("package.json", "utf8")).name;
function directory() {
    return mkdtempSync(join(tmpdir(), "persistence-fuzz-tests-"));
}
function config(overrides = {}) {
    return { game, profile: "qualification", seed: 17, trials: casePlan(game).length, sourceIdentity: { digest: "test" }, ...overrides };
}
function good(spec) {
    return {
        issues: [],
        coverage: [requiredMarkers(game)[spec.index % strata(game).length]],
        metrics: {
            validations: 10,
            captures: 10,
            writes: 2,
            restores: 1,
            callbacks: 10,
            renders: 10,
            progress: 10,
            gameplayUpdates: 10,
            inputActionsObserved: 10
        },
        explorationCallbacks: spec.frames.length,
        comparedContinuationSteps: 24,
        setupComplete: true
    };
}

test("strict deterministic seed parser and separate input/schedule streams", () => {
    assert.equal(seed32("0x20261004"), 0x20261004);
    for (const invalid of ["-1", "NaN", "0x", "4294967296", "1.5"]) assert.throws(() => seed32(invalid));
    const a = random(42),
        b = random(42);
    assert.deepEqual(
        Array.from({ length: 50 }, () => a.next()),
        Array.from({ length: 50 }, () => b.next())
    );
    assert.deepEqual(makeTrial(game, config(), 5), makeTrial(game, config(), 5));
    const frames = framesFor(mix(4, 1), mix(4, 2), 100, game),
        changed = framesFor(mix(4, 1), mix(5, 2), 100, game);
    assert.deepEqual(
        frames.map((f) => f.mask),
        changed.map((f) => f.mask)
    );
    assert.notDeepEqual(
        frames.map((f) => f.deltaMs),
        changed.map((f) => f.deltaMs)
    );
});

test("short seed bank covers all maze/stage/difficulty strata", () => {
    for (const name of ["jackal-js", "stickvania-js", "ms-pac-man-2010-js"]) {
        const markers = new Set(
            Array.from({ length: strata(name).length }, (_, i) => {
                const s = makeTrial(name, config(), i);
                return `stage:${s.stage}:world:${s.world}:hard:${s.hard}`;
            })
        );
        assert.deepEqual([...markers].sort(), requiredMarkers(name).sort());
    }
});

test("CLI rejects silent typos, bad limits, and invalid profile combinations", () => {
    for (const args of [
        ["--unknown=x"],
        ["--ticks=0"],
        ["--seed=-1"],
        ["--profile=other"],
        ["--hours=2"],
        ["--profile=soak", "--hours=2", "--trials=5"],
        ["--engine=foo"],
        ["--audio=foo"],
        ["--allow-source-drift"]
    ])
        assert.throws(() => parseArgs(args, game));
    assert.equal(parseArgs(["--profile=soak", "--hours=10", "--seed=3"], game).hours, 10);
    assert.equal(parseArgs(["--help"], game).help, true);
});

test("comparison retains all gameplay values and only excludes declared metadata", () => {
    const a = {
        savedAt: "a",
        appVersion: "1",
        random: { seed: 1 },
        mainFields: { score: 12, nextFrameTime: 100 },
        audio: { playback: { positionSeconds: 1, transport: "playing" } }
    };
    const b = structuredClone(a);
    b.savedAt = "b";
    b.mainFields.nextFrameTime = 200;
    assert.equal(firstDifference(normalizeSnapshot(a), normalizeSnapshot(b)), null);
    b.random.seed++;
    assert.match(firstDifference(normalizeSnapshot(a), normalizeSnapshot(b)).path, /random.seed/);
    b.random.seed--;
    b.audio.playback.transport = "paused";
    assert.ok(firstDifference(normalizeSnapshot(a, { nativeAudio: true }), normalizeSnapshot(b, { nativeAudio: true })));
    assert.equal(
        issueSignature({ category: "DIVERGENCE", difference: { path: "$.things[1].x" } }),
        issueSignature({ category: "DIVERGENCE", difference: { path: "$.things[5].x" } })
    );
});

test("a campaign records multiple defects, deduplicates repeats, and never stops at the first finding", async () => {
    const base = directory(),
        reporter = new Reporter(join(base, "run"), resolve("."));
    const visited = [];
    try {
        const result = await runCampaign(config(), reporter, async (spec) => {
            visited.push(spec.index);
            const result = good(spec);
            if (spec.index === 0 || spec.index === 2) result.issues = [{ category: "SAVE_REJECTED", ruleCode: "boat", snapshot: { sprite: 1 } }];
            if (spec.index === 1) result.issues = [{ category: "CONTINUATION_DIVERGENCE", difference: { path: "$.random.seed" } }];
            return result;
        });
        assert.equal(visited.length, casePlan(game).length);
        assert.equal(result.exitCode, 1);
        assert.equal(result.issues.length, 2);
        assert.equal(result.findings, 3);
        assert.equal(result.issues.find((row) => row.ruleCode === "boat").occurrences, 2);
        const receipt = JSON.parse(readFileSync(join(base, "run/summary.json"), "utf8"));
        assert.equal(receipt.exitCode, 1);
        const repro = JSON.parse(readFileSync(join(base, "run/issues", result.issues[0].id, "repro.json"), "utf8"));
        assert.deepEqual(repro.spec, makeTrial(game, config(), 0));
    } finally {
        rmSync(base, { recursive: true, force: true });
    }
});

test("no-op, missing coverage, interrupted and crashed workers cannot pass", async () => {
    const base = directory();
    try {
        const noop = await runCampaign(config(), new Reporter(join(base, "noop"), resolve(".")), async (spec) => ({ ...good(spec), metrics: {} }));
        assert.equal(noop.exitCode, 2);
        const gaps = await runCampaign(config({ trials: 1 }), new Reporter(join(base, "gaps"), resolve(".")), async (spec) => good(spec));
        assert.equal(gaps.exitCode, 2);
        const controller = new AbortController();
        controller.abort();
        const stopped = await runCampaign(config(), new Reporter(join(base, "stop"), resolve(".")), async () => assert.fail("aborted"), {
            signal: controller.signal
        });
        assert.equal(stopped.exitCode, 130);
        assert.equal(evaluateCampaign(config(), { completed: 1, captures: 1, writes: 1, restores: 1, missingCoverage: [], incomplete: true }), 2);
    } finally {
        rmSync(base, { recursive: true, force: true });
    }
});

test("a complete exercised campaign passes and summaries are bounded replacements", async () => {
    const base = directory();
    try {
        const reporter = new Reporter(join(base, "pass"), resolve("."));
        const result = await runCampaign(config(), reporter, async (spec) => good(spec));
        assert.equal(result.exitCode, 0);
        const before = reporter.bytes;
        for (let i = 0; i < 100; i++) reporter.atomic("latest.json", { value: i });
        assert.ok(reporter.bytes - before < 100, "replacing a checkpoint must not consume cumulative disk budget");
    } finally {
        rmSync(base, { recursive: true, force: true });
    }
});

test("evidence cannot touch the repository, traverse a symlink, or exceed its budget", () => {
    const base = directory();
    try {
        assert.throws(() => assertExternalPath(resolve("dist/fuzz"), resolve(".")));
        mkdirSync(join(base, "actual"));
        symlinkSync(join(base, "actual"), join(base, "link"), process.platform === "win32" ? "junction" : "dir");
        assert.throws(() => assertExternalPath(join(base, "link/next"), resolve(".")));
        const reporter = new Reporter(join(base, "budget"), resolve("."), 20);
        assert.throws(() => reporter.event({ oversized: "x".repeat(100) }));
        assert.equal(reporter.incomplete, true);
        reporter.close();
    } finally {
        rmSync(base, { recursive: true, force: true });
    }
});

test("supervisor terminates hung trials, permitting the next independent trial", async () => {
    const base = directory();
    try {
        const hung = join(base, "hung.mjs"),
            okay = join(base, "okay.mjs");
        writeFileSync(hung, 'process.on("message",()=>{process.send({type:"progress",phase:"loop"});setInterval(()=>{},1000);});');
        writeFileSync(okay, 'process.on("message",()=>process.send({type:"result",result:{issues:[],metrics:{},coverage:[]}},()=>process.exit(0)));');
        const result = await supervisedTrial({ repo: resolve(".") }, { workerUrl: pathToFileURL(hung), timeoutMs: 150 });
        assert.equal(result.issues[0].category, "WORKER_TIMEOUT");
        const next = await supervisedTrial({ repo: resolve(".") }, { workerUrl: pathToFileURL(okay), timeoutMs: 5000 });
        assert.deepEqual(next.issues, []);
    } finally {
        rmSync(base, { recursive: true, force: true });
    }
});

test("release leak guard fails a deliberately injected harness marker", () => {
    const base = directory();
    try {
        writeFileSync(join(base, "index.js"), 'console.log("ordinary production");');
        assert.doesNotThrow(() => assertNoFuzzInRelease(base));
        writeFileSync(join(base, "sw.js"), 'const marker="__persistenceFuzz";');
        assert.throws(() => assertNoFuzzInRelease(base));
    } finally {
        rmSync(base, { recursive: true, force: true });
    }
});

test("fuzzer runs production capture/update paths without release imports or Actions", () => {
    const source = readFileSync("scripts/persistence-fuzz/browser.mjs", "utf8");
    assert.match(source, /store\.save\(main, authorized\)/);
    assert.match(source, /container\.updateGame\(frame.deltaMs\)/);
    assert.match(source, /saveFrozenGame/);
    assert.match(source, /pagehide/);
    const worker = readFileSync("scripts/persistence-fuzz/worker.mjs", "utf8");
    assert.match(worker, /page\.reload/);
    assert.match(worker, /serviceWorkers: "block"/);
    assert.doesNotMatch(worker, /\.github\/workflows|workflow_dispatch/);
    const entry = game === "jackal-js" ? "pwa/src/main.ts" : game === "stickvania-js" ? "pwa/src/main.ts" : "pwa/src/app/main.ts";
    assert.doesNotMatch(readFileSync(entry, "utf8"), /persistence-fuzz|__persistenceFuzz/);
});

test("single-trial replay can pass without pretending to cover every level", async () => {
    const base = directory();
    try {
        const spec = makeTrial(game, config(), 2);
        const result = await runCampaign(config({ replaySpec: spec, trials: 1 }), new Reporter(join(base, "replay"), resolve(".")), async (value) =>
            good(value)
        );
        assert.equal(result.exitCode, 0);
        assert.deepEqual(result.missingCoverage, []);
        assert.equal(result.completed, 1);
    } finally {
        rmSync(base, { recursive: true, force: true });
    }
});

test("evidence paths cannot enter a sibling game or engine checkout", () => {
    const base = directory();
    try {
        const sibling = join(base, "different-folder-name");
        mkdirSync(sibling);
        writeFileSync(join(sibling, "package.json"), JSON.stringify({ name: "slick2d-ts" }));
        assert.throws(() => assertExternalPath(join(sibling, "dist/fuzz-evidence"), resolve(".")));
    } finally {
        rmSync(base, { recursive: true, force: true });
    }
});

test("bounded minimizer preserves the exact failure class and original recipe", async () => {
    const { minimizeTrial } = await import("./persistence-fuzz/shrink.mjs");
    const issue = { category: "SAVE_REJECTED", ownerType: "GrayBoat", ruleCode: "explicit-enum" };
    const original = {
        stage: 2,
        seed: 91,
        frames: Array.from({ length: 12 }, (_, i) => ({ mask: i === 7 ? 16 : 1, deltaMs: 10, renderCount: 1 })),
        continuation: []
    };
    const immutable = JSON.stringify(original);
    const signature = issueSignature(issue);
    const result = await minimizeTrial(
        original,
        signature,
        async (spec) => ({ setupComplete: true, issues: spec.frames.some((frame) => frame.mask === 16) ? [issue] : [] }),
        { maxAttempts: 32 }
    );
    assert.equal(result.verified, true);
    assert.ok(result.spec.frames.length < original.frames.length);
    assert.equal(result.spec.seed, original.seed);
    assert.ok(result.spec.frames.some((frame) => frame.mask === 16));
    assert.equal(JSON.stringify(original), immutable);
    const bad = await minimizeTrial(original, signature, async () => ({
        setupComplete: true,
        infrastructureFailure: { message: "missing resource" },
        issues: [issue]
    }));
    assert.equal(bad.status, "original-not-reproduced");
    assert.equal(bad.verified, false);
});

test("wire normalization and transient transition detection are narrow", () => {
    assert.deepEqual(normalizeSnapshot({ x: -0 }), { x: 0 });
    const a = { mainFields: { paused: false, score: 0 }, gameMode: { entities: [] } };
    const b = structuredClone(a);
    b.mainFields.paused = true;
    assert.notEqual(snapshotTransitionKey(a), snapshotTransitionKey(b));
    const c = structuredClone(a);
    c.gameMode.entities.push({ id: 1, type: "GrayBoat", fields: { state: 0 } });
    assert.notEqual(snapshotTransitionKey(a), snapshotTransitionKey(c));
    const d = structuredClone(c);
    d.gameMode.entities[0].fields.state = 1;
    assert.notEqual(snapshotTransitionKey(c), snapshotTransitionKey(d));
    assert.throws(() => parseArgs(["--shrink"], game), /replay/);
});

test("soak collects multiple findings and retains only bounded accepted novel branches", async () => {
    const base = directory(),
        visited = [],
        branches = [];
    try {
        const result = await runCampaign(
            config({ profile: "soak", trials: casePlan(game).length + 6 }),
            new Reporter(join(base, "soak"), resolve(".")),
            async (spec) => {
                visited.push(spec.index);
                if (spec.initialCheckpoint) branches.push(spec.corpusParent);
                const row = good(spec);
                if (spec.index < 2) row.issues = [{ category: "SAVE_REJECTED", ownerType: spec.index ? "GreenBoat" : "GrayBoat" }];
                else
                    row.acceptedCheckpoint = {
                        text: JSON.stringify({ version: 1, id: spec.index }),
                        clock: 1000000,
                        actualPlacement: {},
                        captureContext: { stage: spec.stage, world: spec.world, hard: spec.hard }
                    };
                return row;
            }
        );
        assert.equal(result.exitCode, 1);
        assert.equal(visited.length, casePlan(game).length + 6);
        assert.equal(result.issues.length, 2);
        assert.ok(result.corpusEntries > 0 && result.corpusEntries <= 32);
        assert.ok(branches.length > 0);
        assert.ok(
            branches.every((index) => index >= 2),
            "failed trials must never seed the corpus"
        );
    } finally {
        rmSync(base, { recursive: true, force: true });
    }
});

test("a frozen world with captures, audio and writes still cannot qualify", async () => {
    const base = directory();
    try {
        const result = await runCampaign(config(), new Reporter(join(base, "frozen"), resolve(".")), async (spec) => ({
            ...good(spec),
            metrics: { captures: 10, writes: 10, restores: 1, callbacks: 10, renders: 10, progress: 0 }
        }));
        assert.equal(result.exitCode, 2);
    } finally {
        rmSync(base, { recursive: true, force: true });
    }
});

test("first cancellation gives the worker a cooperative cleanup boundary", async () => {
    const base = directory();
    try {
        const worker = join(base, "cooperative.mjs");
        writeFileSync(
            worker,
            'process.on("message",(m)=>{if(m.type==="stop")process.send({type:"result",result:{interrupted:true,cooperative:true,issues:[],metrics:{},coverage:[]}},()=>process.exit(130));else process.send({type:"progress",phase:"running"});});'
        );
        const stop = new AbortController();
        const result = await supervisedTrial(
            { repo: resolve(".") },
            { workerUrl: pathToFileURL(worker), signal: stop.signal, timeoutMs: 5000, progress: () => stop.abort() }
        );
        assert.equal(result.interrupted, true);
        assert.equal(result.cooperative, true);
    } finally {
        rmSync(base, { recursive: true, force: true });
    }
});

test("continuation deduplication retains entity type and phase without transient IDs", () => {
    const value = (type, state, index = 0) => ({
        category: "CONTINUATION_DIVERGENCE",
        difference: { path: `$.things[${index}].fields.x` },
        snapshot: { things: Array.from({ length: index + 1 }, () => ({ type, fields: { state } })) }
    });
    assert.equal(issueSignature(value("Bat", 0)), issueSignature(value("Bat", 0, 3)));
    assert.notEqual(issueSignature(value("Bat", 0)), issueSignature(value("Dog", 0)));
    assert.notEqual(issueSignature(value("Bat", 0)), issueSignature(value("Bat", 1)));
});

test("replay command cannot silently run a new qualification campaign", () => {
    assert.throws(() => parseArgs(["--profile=replay"], game), /requires --replay/);
    assert.equal(parseArgs(["--profile=replay", "--replay=evidence.json"], game).profile, "replay");
});

test("running summary never publishes a success and only coordinator verifies integrity", async () => {
    const base = directory(),
        reporter = new Reporter(join(base, "run"), resolve("."));
    try {
        const settings = config();
        const result = await collectCampaign(settings, reporter, async (spec) => {
            const current = JSON.parse(readFileSync(join(base, "run/summary.json"), "utf8"));
            assert.equal(current.status, "running");
            assert.equal(current.exitCode, null);
            return good(spec);
        });
        assert.equal(result.exitCode, null);
        finalizeCampaign(settings, reporter, result, false);
        const terminal = JSON.parse(readFileSync(join(base, "run/terminal.json"), "utf8"));
        assert.equal(terminal.status, "incomplete");
        assert.equal(terminal.exitCode, 2);
    } finally {
        reporter.close();
        rmSync(base, { recursive: true, force: true });
    }
});

test("partial interrupted findings and duplicate streamed delivery survive exactly once", async () => {
    const base = directory(),
        reporter = new Reporter(join(base, "run"), resolve("."));
    try {
        const result = await runCampaign(config(), reporter, async (spec, { onEvidence }) => {
            const issue = { category: "SAVE_REJECTED", evidenceId: "run:trial:doc:1", ruleCode: "boat" };
            onEvidence({ issues: [issue] });
            onEvidence({ issues: [issue] });
            return { ...good(spec), issues: [issue], interrupted: true };
        });
        assert.equal(result.exitCode, 130);
        assert.equal(result.findings, 1);
        assert.equal(result.issues[0].occurrences, 1);
        assert.equal(result.corpusEntries, 0);
    } finally {
        reporter.close();
        rmSync(base, { recursive: true, force: true });
    }
});

test("each strategy and stratum owes its own gameplay, input, writer and continuation work", async () => {
    const base = directory();
    try {
        for (const missing of ["gameplayUpdates", "inputActionsObserved", "writes", "restores", "continuation"]) {
            const reporter = new Reporter(join(base, missing), resolve("."));
            const result = await runCampaign(config(), reporter, async (spec) => {
                const row = good(spec);
                if (spec.index === 3) {
                    if (missing === "continuation") row.comparedContinuationSteps = 0;
                    else row.metrics[missing] = 0;
                }
                return row;
            });
            assert.equal(result.exitCode, 2, missing);
            assert.ok(result.missingCoverage.some((marker) => marker.startsWith(makeTrial(game, config(), 3).caseId)));
        }
        const defaults = parseArgs([], game);
        assert.equal(defaults.trials, casePlan(game).length);
        assert.equal(new Set(Array.from({ length: defaults.trials }, (_, i) => makeTrial(game, defaults, i).caseId)).size, defaults.trials);
    } finally {
        rmSync(base, { recursive: true, force: true });
    }
});

test("duration between complete trials is valid but count truncation is incomplete", async () => {
    const base = directory();
    try {
        let clock = 0;
        const spec = makeTrial(game, config(), 0);
        const settings = config({ profile: "soak", trials: 100, hours: 1 / 3600 });
        const result = await runCampaign(
            settings,
            new Reporter(join(base, "duration"), resolve(".")),
            async (value) => {
                clock += 1000 / casePlan(game).length;
                return good(value);
            },
            { now: () => clock }
        );
        assert.equal(result.exitCode, 0);
        assert.equal(result.stopReason, "duration-limit");
        const short = await runCampaign(config({ trials: 1 }), new Reporter(join(base, "short"), resolve(".")), async () => good(spec));
        assert.equal(short.exitCode, 2);
    } finally {
        rmSync(base, { recursive: true, force: true });
    }
});

test("terminal evidence reserve remains available after normal budget exhaustion", async () => {
    const base = directory(),
        reporter = new Reporter(join(base, "run"), resolve("."), 500);
    try {
        const result = await runCampaign(config(), reporter, async (spec) => good(spec));
        assert.equal(result.exitCode, 2);
        const terminal = JSON.parse(readFileSync(join(base, "run/terminal.json"), "utf8"));
        assert.equal(terminal.exitCode, 2);
        assert.equal(terminal.evidenceIncomplete, true);
    } finally {
        reporter.close();
        rmSync(base, { recursive: true, force: true });
    }
});

test("findings acknowledged before a hung worker remain in watchdog outcome", async () => {
    const base = directory();
    try {
        const worker = join(base, "finding-hang.mjs"),
            retained = [];
        writeFileSync(
            worker,
            'process.on("message", m => {if(m.type === "evidence-ack") {process.send({type:"progress",phase:"acknowledged"}); return;} process.send({type:"evidence",sequence:1,packet:{issues:[{category:"SAVE_REJECTED",evidenceId:"r:t:d:1"}],metrics:{callbacks:8},explorationCallbacks:8}});setInterval(()=>{},1000);});'
        );
        const result = await supervisedTrial(
            { repo: resolve(".") },
            { workerUrl: pathToFileURL(worker), timeoutMs: 1000, onEvidence: (packet) => retained.push(...packet.issues) }
        );
        assert.equal(retained.length, 1);
        assert.equal(result.issues.length, 2);
        assert.equal(result.issues[0].category, "SAVE_REJECTED");
        assert.equal(result.incomplete, true);
        assert.equal(result.metrics.callbacks, 8);
    } finally {
        rmSync(base, { recursive: true, force: true });
    }
});

test("generic throw sites differ and uncertain gate groups retain bounded variants", () => {
    const a = { category: "RUNTIME_EXCEPTION", error: { name: "Error", message: "Missing boat target 14", stack: "Error\n at Boat.fire (boat.ts:14:2)" } };
    const b = {
        category: "RUNTIME_EXCEPTION",
        error: { name: "Error", message: "Missing player input 14", stack: "Error\n at Player.update (player.ts:55:2)" }
    };
    assert.notEqual(issueSignature(a), issueSignature(b));
    const base = directory(),
        reporter = new Reporter(join(base, "run"), resolve("."));
    try {
        for (let i = 0; i < 6; i++)
            reporter.finding(
                { category: "VALIDATION_REJECTED", ruleCode: "structure-and-graph", snapshot: { mainFields: { [i % 2 ? "timer" : "score"]: -i - 1 } } },
                {}
            );
        const row = [...reporter.issues.values()][0];
        assert.equal(row.occurrences, 6);
        assert.equal(row.variants.length, 4);
        assert.equal(row.omittedVariants, 2);
    } finally {
        reporter.close();
        rmSync(base, { recursive: true, force: true });
    }
});

test("actual Jackal completion/music/voice transitions are distinct from advancing cursors", () => {
    const state = {
        mainFields: {},
        gameMode: { fields: { stageCompletedFlag: false }, entities: [] },
        currentSongState: { id: "stage", activeMusic: { id: "intro", playback: { transport: "playing", positionSeconds: 1 } } },
        audioState: { sounds: [{ id: "gun", playback: { voices: [] } }] }
    };
    for (const change of [
        (s) => (s.gameMode.fields.stageCompletedFlag = true),
        (s) => (s.currentSongState.activeMusic.playback.transport = "paused"),
        (s) => s.audioState.sounds[0].playback.voices.push({ positionSeconds: 0 })
    ]) {
        const next = structuredClone(state);
        change(next);
        assert.notEqual(snapshotTransitionKey(state), snapshotTransitionKey(next));
    }
    const next = structuredClone(state);
    next.currentSongState.activeMusic.playback.positionSeconds++;
    assert.equal(snapshotTransitionKey(state), snapshotTransitionKey(next));
});

test("replay target does not confuse an unrelated error or incomplete setup with reproduction", async () => {
    const base = directory(),
        spec = makeTrial(game, config(), 0);
    try {
        for (const incomplete of [false, true]) {
            const result = await runCampaign(
                config({ trials: 1, replaySpec: spec, replayTargetSignature: "original" }),
                new Reporter(join(base, String(incomplete)), resolve(".")),
                async () => ({ ...good(spec), incomplete, issues: [{ category: "OTHER" }] })
            );
            assert.equal(result.replayTarget.outcome, incomplete ? "inconclusive" : "not-observed");
            assert.equal(result.replayTarget.otherFindings.length, 1);
        }
    } finally {
        rmSync(base, { recursive: true, force: true });
    }
});

test("incremental finding buffers reset per document and retain raw occurrences plus uncertain variants", async () => {
    const { FindingBuffer } = await import("./persistence-fuzz/findings.mjs");
    const first = new FindingBuffer();
    const issue = { category: "SAVE_REJECTED", ruleCode: "explicit-enum", path: "$.things[1].fields.state", ownerType: "Boat" };
    first.add(issue);
    first.add({ ...issue, tick: 8 });
    const rows = first.drain();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].occurrences, 2);
    assert.equal(rows[0].sequence, 1);
    assert.deepEqual(first.drain(), []);
    first.add(issue);
    assert.equal(first.drain()[0].sequence, 2);
    const next = new FindingBuffer();
    next.add(issue);
    assert.equal(next.drain()[0].sequence, 1, "worker document identity disambiguates local reset");
    const coarse = new FindingBuffer();
    coarse.add({ category: "SAVE_REJECTED", ruleCode: "structure-and-graph", snapshot: { mainFields: { a: -1 } } });
    coarse.add({ category: "SAVE_REJECTED", ruleCode: "structure-and-graph", snapshot: { mainFields: { b: -1 } } });
    assert.equal(coarse.drain().length, 2);
});

test("checkpoint identity binds exact bytes and current context without rewriting origin", async () => {
    const { sealCheckpoint, assertCheckpoint } = await import("./persistence-fuzz/checkpoint.mjs");
    const identity = { digest: "source", engineDigest: "resources" };
    for (const context of [
        { stage: 1, world: 0, hard: false, mode: "game" },
        { stage: 8, world: 3, hard: false, mode: "ending" },
        { stage: 2, world: 0, hard: true, mode: 3, segment: 2, region: 1 }
    ]) {
        const checkpoint = sealCheckpoint(
            {
                formatVersion: 2,
                text: JSON.stringify({ mainFields: { stageIndex: context.stage } }),
                clock: 1000000,
                origin: { requestedPlacement: { stage: 0 } },
                captureContext: context
            },
            identity
        );
        assert.doesNotThrow(() => assertCheckpoint(checkpoint, identity));
        assert.equal(checkpoint.origin.requestedPlacement.stage, 0);
        assert.throws(() => assertCheckpoint({ ...checkpoint, text: checkpoint.text + " " }, identity));
        assert.throws(() => assertCheckpoint(checkpoint, { ...identity, digest: "new" }));
        assert.doesNotThrow(() => assertCheckpoint(checkpoint, { ...identity, digest: "new" }, true));
    }
});

test("semantic floor rejects missing boundaries, wrong commands and stale source", async () => {
    const { readSemanticFloor, semanticDirectory, semanticCommands } = await import("./persistence-fuzz/semantic-floor.mjs");
    const base = directory(),
        repo = join(base, "checkout"),
        identity = { digest: "exact-source", engineDigest: "engine" };
    mkdirSync(repo);
    writeFileSync(join(repo, "package.json"), JSON.stringify({ name: game }));
    try {
        assert.deepEqual(readSemanticFloor(repo, identity).missing, Object.keys(semanticCommands[game]));
        const dir = semanticDirectory(repo, identity);
        mkdirSync(dir, { recursive: true });
        const groups = Object.keys(semanticCommands[game]);
        for (const group of groups) {
            writeFileSync(
                join(dir, `${group}.json`),
                JSON.stringify({
                    formatVersion: 2,
                    exitCode: 0,
                    sourceDigest: identity.digest,
                    engineDigest: identity.engineDigest,
                    group,
                    command: semanticCommands[game][group]
                })
            );
        }
        assert.deepEqual(readSemanticFloor(repo, identity).missing, []);
        const boundary = groups.at(-1),
            file = join(dir, `${boundary}.json`),
            receipt = JSON.parse(readFileSync(file));
        for (const corrupt of [
            { ...receipt, sourceDigest: "stale" },
            { ...receipt, engineDigest: "stale" },
            { ...receipt, exitCode: 2 },
            { ...receipt, command: ["skipped"] }
        ]) {
            writeFileSync(file, JSON.stringify(corrupt));
            assert.deepEqual(readSemanticFloor(repo, identity).missing, [boundary]);
        }
    } finally {
        rmSync(base, { recursive: true, force: true });
    }
});

test("actual actor no-op cannot satisfy production-call instrumentation", async () => {
    const { createObservation } = await import("./persistence-fuzz/observation.mjs");
    class Player {
        update() {
            return true;
        }
    }
    const player = new Player(),
        observer = createObservation();
    observer.actor(player, true);
    observer.begin();
    player.update();
    observer.end();
    assert.equal(observer.metrics.gameplayUpdates, 1);
    Object.defineProperty(player, "update", { value: () => true });
    observer.actor(player, true);
    observer.begin();
    player.update();
    observer.end();
    assert.equal(observer.metrics.gameplayUpdates, 1);
});

test("acknowledged repeated deliveries persist exact occurrence counts", () => {
    const base = directory(),
        reporter = new Reporter(join(base, "run"), resolve("."));
    try {
        const issue = { category: "SAVE_REJECTED", ruleCode: "explicit-enum", path: "$.state", ownerType: "Boat" };
        reporter.finding({ ...issue, evidenceId: "trial:doc:1", occurrences: 3 }, {});
        reporter.finding({ ...issue, evidenceId: "trial:doc:2", occurrences: 2 }, {});
        reporter.finding({ ...issue, evidenceId: "trial:doc:2", occurrences: 2 }, {});
        const events = readFileSync(join(base, "run/events.jsonl"), "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
        assert.deepEqual(
            events.map((event) => event.occurrences),
            [3, 5]
        );
        assert.equal(events.at(-1).evidenceId, "trial:doc:2");
    } finally {
        reporter.close();
        rmSync(base, { recursive: true, force: true });
    }
});

test("game-owned transition projection uses its actual audio and root schema without cursor churn", async () => {
    const { transitionProjection: project, captureContext } = await import("./persistence-fuzz/transitions.mjs");
    const music = { id: "theme", playback: { transport: "playing", positionSeconds: 1 } },
        sound = { id: "cue", playback: { activeVoiceIndex: 0, voices: [] } };
    let snapshot, musicOf, soundsOf, complete;
    if (game === "jackal-js") {
        snapshot = {
            kind: "game",
            mainFields: { stageIndex: 0, hardMode: false },
            playerFields: { respawning: 4 },
            gameMode: { fields: { stageCompletedFlag: false, stageCompletedDelay: 20 }, entities: [], elements: [], indexes: {} },
            currentSongState: { id: "stage", activeMusic: music },
            audioState: { sounds: [sound] }
        };
        musicOf = (s) => s.currentSongState.activeMusic;
        soundsOf = (s) => s.audioState.sounds;
        complete = (s) => {
            s.gameMode.fields.stageCompletedFlag = true;
        };
    } else if (game === "stickvania-js") {
        snapshot = {
            mode: 1,
            mainFields: { stageIndex: 0, difficulty: 0, beatStageFlag: false },
            stage: { currentSegmentIndex: 0, segments: [{ regionIndex: 0 }], simon: 1 },
            things: [{ id: 1, type: "Simon", fields: { dead: 2 } }],
            audio: { currentMusic: music, songs: [], sounds: [sound] }
        };
        musicOf = (s) => s.audio.currentMusic;
        soundsOf = (s) => s.audio.sounds;
        complete = (s) => {
            s.mainFields.beatStageFlag = true;
        };
    } else {
        snapshot = {
            mainFields: { stageIndex: 0, worldIndex: 0 },
            mode: { id: "playing", fields: { finished: false, readyTimer: 0 }, mspacman: { fields: { speedBoost: false } }, ghosts: [] },
            music,
            soundEffects: [sound]
        };
        musicOf = (s) => s.music;
        soundsOf = (s) => s.soundEffects;
        complete = (s) => {
            s.mode.fields.finished = true;
        };
    }
    const key = (s) => JSON.stringify(project(s)),
        initial = key(snapshot);
    for (const change of [
        (s) => {
            musicOf(s).playback.transport = "paused";
        },
        (s) => {
            soundsOf(s)[0].playback.voices.push({ looped: false, playbackRate: 1 });
        },
        complete,
        (s) => {
            s.mainFields.stageIndex++;
        }
    ]) {
        const next = structuredClone(snapshot);
        change(next);
        assert.notEqual(key(next), initial);
    }
    const next = structuredClone(snapshot);
    musicOf(next).playback.positionSeconds++;
    if (game === "jackal-js") {
        next.playerFields.respawning--;
        next.gameMode.fields.stageCompletedDelay--;
    }
    if (game === "stickvania-js") next.things[0].fields.dead++;
    if (game === "ms-pac-man-2010-js") next.mode.fields.readyTimer++;
    assert.equal(key(next), initial);
    assert.equal(captureContext(snapshot).stage, 0);
});

test("ordinary gameplay recipes never emit an unpaired Pause or NES Start edge", () => {
    for (const name of ["jackal-js", "stickvania-js", "ms-pac-man-2010-js"])
        for (let index = 0; index < casePlan(name).length; index++) {
            const spec = makeTrial(name, { seed: 0x20261004, profile: "qualification" }, index);
            assert.equal(spec.generatorVersion, 3);
            assert.ok(
                [...spec.frames, ...spec.continuation].every((frame) => (frame.mask & (64 | 128)) === 0),
                `${name}:${index}`
            );
        }
});
