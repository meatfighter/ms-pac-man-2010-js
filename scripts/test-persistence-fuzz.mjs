import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { seed32, random, framesFor, mix } from "./persistence-fuzz/prng.mjs";
import { makeTrial, strata, requiredMarkers, evaluateCampaign } from "./persistence-fuzz/profiles.mjs";
import { normalizeSnapshot, firstDifference, issueSignature, snapshotTransitionKey } from "./persistence-fuzz/compare.mjs";
import { Reporter, assertExternalPath } from "./persistence-fuzz/reporter.mjs";
import { runCampaign } from "./persistence-fuzz/campaign.mjs";
import { parseArgs } from "./persistence-fuzz/cli.mjs";
import { supervisedTrial } from "./persistence-fuzz/supervisor.mjs";
import { assertNoFuzzInRelease } from "./persistence-fuzz/guard.mjs";

const game = JSON.parse(readFileSync("package.json", "utf8")).name;
function directory() {
    return mkdtempSync(join(tmpdir(), "persistence-fuzz-tests-"));
}
function config(overrides = {}) {
    return { game, profile: "qualification", seed: 17, trials: strata(game).length, sourceIdentity: { digest: "test" }, ...overrides };
}
function good(spec) {
    return {
        issues: [],
        coverage: [requiredMarkers(game)[spec.index % strata(game).length]],
        metrics: { captures: 10, writes: 2, restores: 1, callbacks: 10, renders: 10, progress: 10 },
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
        assert.equal(visited.length, strata(game).length);
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
            config({ profile: "soak", trials: strata(game).length + 6 }),
            new Reporter(join(base, "soak"), resolve(".")),
            async (spec) => {
                visited.push(spec.index);
                if (spec.initialCheckpoint) branches.push(spec.corpusParent);
                const row = good(spec);
                if (spec.index < 2) row.issues = [{ category: "SAVE_REJECTED", ownerType: spec.index ? "GreenBoat" : "GrayBoat" }];
                else row.acceptedCheckpoint = { text: JSON.stringify({ version: 1, id: spec.index }), clock: 1000000, actualPlacement: {} };
                return row;
            }
        );
        assert.equal(result.exitCode, 1);
        assert.equal(visited.length, strata(game).length + 6);
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
