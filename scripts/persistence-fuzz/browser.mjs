/* global window, document, location, KeyboardEvent */
// __PERSISTENCE_FUZZ_ONLY__. Served only by the dedicated loopback test plugin.
import { Sys, Music, SoundStore, ResourceLoader, Renderer, Graphics, Color } from "slick2d-ts";
import { saveFrozenGame } from "/src/app/FrozenGameSave.ts";
import { FindingBuffer } from "./findings.mjs";
import { createObservation } from "./observation.mjs";
import * as adapter from "./adapter.mjs";
import { normalizeSnapshot, firstDifference, snapshotCoverage } from "./compare.mjs";

if (!import.meta.env.DEV || !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) throw new Error("Local development fixture only.");
const observation = createObservation();
let currentMutant = null,
    observationExperiment = false,
    deferredEffect = null;
let mounted = null,
    armedDeparture = false,
    held = 0,
    clock = 1_000_000,
    spec = null;
let drainedMetrics = {};
let pending = null,
    failure = null,
    status = "ready",
    currentPhase = "prepare",
    tick = -1;
let validations = 0;
let captures = 0,
    writes = 0,
    restores = 0,
    callbackCount = 0,
    renderCount = 0;
let progress = 0,
    previousGameplay = null,
    saveMs = 0,
    saveMaxMs = 0,
    maxSnapshotChars = 0;
const benchmarkNow = performance.now.bind(performance);
let storageSetItem = null;
let previousGood = null,
    actualPlacement = null,
    previousTransition = null;
const findings = new FindingBuffer(),
    signatures = new Set(),
    coverage = new Set();
const originalTime = Sys.getTime,
    originalNow = Date.now;
const originalPerformanceNow = Object.getOwnPropertyDescriptor(performance, "now");
const version = String(import.meta.env.VITE_FUZZ_APP_VERSION ?? "persistence-fuzz");
const nativeAudio = () => spec?.audio === "native";
const normalize = (snapshot) => normalizeSnapshot(snapshot, { nativeAudio: nativeAudio() });
const errorDetails = (error) => ({ name: error?.name ?? "Error", message: String(error?.message ?? error), stack: String(error?.stack ?? "").slice(0, 12000) });
function issue(category, extra = {}) {
    findings.add({ category, phase: currentPhase, tick, ...extra });
}
function capture() {
    const value = adapter.serializer.createSnapshot(mounted.main, version);
    captures++;
    return value;
}
function applyInput(mask) {
    const keys = [
        ["ArrowUp", "ArrowUp", 38],
        ["ArrowDown", "ArrowDown", 40],
        ["ArrowLeft", "ArrowLeft", 37],
        ["ArrowRight", "ArrowRight", 39],
        ["z", "KeyZ", 90],
        ["x", "KeyX", 88],
        ["p", "KeyP", 80],
        ["Enter", "Enter", 13]
    ];
    const target = document.querySelector("canvas") ?? window;
    target.focus?.();
    for (let bit = 0; bit < keys.length; bit++) {
        if ((held & (1 << bit)) === (mask & (1 << bit))) continue;
        const [key, code, keyCode] = keys[bit];
        target.dispatchEvent(
            new KeyboardEvent(mask & (1 << bit) ? "keydown" : "keyup", { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true })
        );
    }
    held = mask;
}
function render() {
    const { container, game } = mounted;
    const graphics = container.getGraphics();
    const backend = Renderer.getBackend();
    backend.beginFrame(container.getWidth(), container.getHeight(), Color.black, container.getWidth(), container.getHeight());
    Graphics.setCurrent(graphics);
    graphics.__prepareForGameRender();
    try {
        game.render(container, graphics);
    } finally {
        graphics.resetTransform();
        backend.endFrame();
    }
    renderCount++;
}
function save(snapshot = capture()) {
    const started = benchmarkNow();
    const { main, container, store } = mounted;
    container.setLoopSuspended(true);
    let result = null;
    const accepted = saveFrozenGame({
        label: adapter.gameId,
        reason: "persistence-fuzz",
        game: main,
        container,
        sameTarget: () => mounted?.main === main && mounted?.container === container,
        accepted: () => true,
        owned: () => true,
        cleanupSafe: () => true,
        write: (authorized) => (result = store.save(main, authorized)),
        didSave: () => {}
    });
    const elapsed = benchmarkNow() - started;
    saveMs += elapsed;
    saveMaxMs = Math.max(saveMaxMs, elapsed);
    if (!accepted || result?.saved !== true) {
        let debug = null;
        try {
            debug = JSON.parse(localStorage.getItem(adapter.debugKey));
            // The current snapshot is already retained separately and compressed.
            // Keep diagnostic metadata, not a second uncompressed copy.
            if (debug && typeof debug === "object") delete debug.snapshot;
        } catch {
            /* Optional diagnostic evidence. */
        }
        issue(result?.reason === "capture-failed" ? "CAPTURE_THROW" : result?.reason === "invalid-snapshot" ? "SAVE_REJECTED" : "STORE_WRITE_FAILED", {
            stage: debug?.failedStage ?? result?.reason ?? "frozen-save",
            ruleCode: debug?.ruleCode,
            path: debug?.fieldPath,
            snapshot,
            previousSnapshot: previousGood,
            debug
        });
        return null;
    }
    const text = localStorage.getItem(adapter.key);
    if (text === null) {
        issue("SAVE_NOT_WRITTEN", { snapshot });
        return null;
    }
    maxSnapshotChars = Math.max(maxSnapshotChars, text.length);
    let written;
    try {
        written = JSON.parse(text);
    } catch (error) {
        issue("SAVE_NOT_WRITTEN", { error: errorDetails(error), snapshot });
        return null;
    }
    const difference = firstDifference(normalize(snapshot), normalize(written));
    if (difference) issue("STORED_SNAPSHOT_MISMATCH", { difference, snapshot: written, previousSnapshot: snapshot });
    // A successful write must agree with the exact same preflight used on reads.
    if (!mounted.store.hasValidSave()) issue("SAVE_SUCCEEDED_READ_REJECTED", { snapshot: written });
    const after = capture();
    const mutation = firstDifference(normalize(snapshot), normalize(after));
    if (mutation) issue("SAVE_MUTATED_RUNTIME", { difference: mutation, snapshot: after, previousSnapshot: snapshot });
    if (!difference && !mutation && mounted.store.hasValidSave()) writes++;
    previousGood = written;
    return { text, snapshot: written };
}
function observe(forceWrite = false, canWrite = true) {
    if (!mounted.main.isStateSaveReady()) {
        issue("READINESS_UNEXPECTED");
        return null;
    }
    let snapshot;
    try {
        snapshot = capture();
    } catch (error) {
        issue("CAPTURE_THROW", { error: errorDetails(error) });
        return null;
    }
    let invalid;
    try {
        invalid = adapter.validate(mounted.main, snapshot);
    } catch (error) {
        issue("VALIDATION_THROW", { snapshot, error: errorDetails(error) });
        return snapshot;
    }
    if (!invalid) validations++;
    const gameplay = normalize(snapshot);
    for (const key of ["audio", "audioState", "music", "currentSongState", "requestedSongId", "soundEffects"]) delete gameplay[key];
    const encodedGameplay = JSON.stringify(gameplay);
    if (previousGameplay !== null && previousGameplay !== encodedGameplay) progress++;
    previousGameplay = encodedGameplay;
    const transition = JSON.stringify(adapter.transitionProjection(snapshot));
    const changed = transition !== previousTransition;
    previousTransition = transition;
    let novel = false;
    for (const marker of snapshotCoverage(snapshot))
        if (!coverage.has(marker)) {
            coverage.add(marker);
            novel = true;
        }
    if (invalid) {
        // One real writer attempt obtains failure-only production diagnostics.
        const signature = `invalid:${invalid}`;
        if (!signatures.has(signature)) {
            signatures.add(signature);
            save(snapshot);
        }
        // Even if a writer unexpectedly accepts it, the oracle disagreement is a finding.
        let detail = {};
        try {
            detail = adapter.diagnose?.(mounted.main, snapshot, invalid) ?? {};
        } catch {
            /* The original snapshot still explains the failure. */
        }
        issue("VALIDATION_REJECTED", { stage: invalid, ...detail, snapshot, previousSnapshot: previousGood });
    } else if (canWrite && (forceWrite || changed || novel || callbackCount % spec.writeEvery === 0)) save(snapshot);
    return snapshot;
}
function step(frame, phase = "exploration", canWrite = true, observeState = true, forceWrite = false) {
    currentPhase = phase;
    deferredEffect?.();
    deferredEffect = null;
    adapter.instrument(mounted, observation);
    if (currentMutant === "disable-gameplay" && phase !== "setup-producer")
        for (const actor of observation.actors) {
            // Independent producer mutation: bypass the observed production methods.
            // The observer itself receives no mutant flag and does not zero counters.
            Object.defineProperty(actor, "update", { configurable: true, value: () => true });
        }
    applyInput(currentMutant === "drop-input" ? 0 : frame.mask);
    clock += frame.deltaMs;
    window.__persistenceFuzzAudio?.advance(frame.deltaMs);
    const input = mounted.container.getInput();
    input.poll(mounted.container.getWidth(), mounted.container.getHeight());
    Music.poll(frame.deltaMs);
    SoundStore.get().poll(frame.deltaMs);
    // Use the real container update wrapper and Main's actual fixed-step loop.
    if (phase !== "setup-producer") observation.begin();
    try {
        mounted.container.updateGame(frame.deltaMs);
    } finally {
        observation.end();
    }
    callbackCount++;
    for (let i = 0; i < frame.renderCount; i++) render();
    return observeState ? observe(forceWrite, canWrite) : null;
}
function resumeBoundary() {
    applyInput(0);
    const { main, container } = mounted;
    main.setBrowserSuspended(true);
    container.getInput().pause();
    container.getInput().resume();
    main.setBrowserSuspended(false);
    main.resetNextFrameTime();
    held = 0;
}
async function boot(request) {
    status = "loading";
    failure = null;
    spec = request.spec;
    currentMutant = request.mutant;
    if (!nativeAudio()) Object.defineProperty(performance, "now", { configurable: true, value: () => clock });
    Sys.getTime = () => clock;
    Date.now = () => 1_800_000_000_000 + clock;
    const activation = adapter.beginGameAudio(); // user-gesture handler, before await
    mounted = await adapter.mount(request.restore === true, version);
    // Independent test-only mutants; never imported by production entry points.
    if (request.mutant === "reject-valid") mounted.store.validateOutgoingSnapshot = () => false;
    if (request.mutant === "suppress-write") {
        storageSetItem = Object.getOwnPropertyDescriptor(Storage.prototype, "setItem");
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            if (key !== adapter.key) return original.call(this, key, value);
        };
    }
    if (request.restore && request.mutant === "restore-score") mounted.main.score++;
    if (["save-input", "save-rng", "save-deferred"].includes(request.mutant)) {
        const originalSave = mounted.store.save;
        mounted.store.save = function (...args) {
            const result = originalSave.apply(this, args);
            if (observationExperiment && result.saved) {
                if (request.mutant === "save-input") {
                    mounted.container.getInput().pause();
                    mounted.container.getInput().resume();
                }
                if (request.mutant === "save-rng") mounted.main.random.nextInt(100);
                if (request.mutant === "save-deferred") deferredEffect = () => mounted.main.score++;
            }
            return result;
        };
    }

    if (!(await activation.ready) || !(await adapter.commitGameAudio(activation))) throw new Error("Playback session was not accepted");
    mounted.container.setLoopSuspended(true);
    mounted.container.getInput().resume();
    document.querySelector("canvas")?.focus();
    Sys.getTime = () => clock;
    Date.now = () => 1_800_000_000_000 + clock;
    mounted.main.resetNextFrameTime();
    if (request.restore) {
        restores++;
        actualPlacement = request.actualPlacement ?? { strategy: "fresh-document-restore" };
    } else {
        currentPhase = "setup";
        actualPlacement = adapter.seed(mounted, spec, step);
    }
    if (!mounted.main.isStateSaveReady()) throw new Error("READINESS_UNEXPECTED: initialized runtime is not save-ready");
    actualPlacement = { ...actualPlacement, stratum: adapter.observedStratum(mounted) };
    const expectedContext = request.restore ? request.captureContext : spec;
    const observedContext = adapter.captureContext(capture());
    if (
        expectedContext &&
        (request.restore ? Object.keys(expectedContext) : ["stage", "world", "hard"]).some((key) => observedContext[key] !== expectedContext[key])
    )
        throw new Error("SETUP: observed stratum differs from requested stratum");
    currentPhase = "setup-boundary";
    const boundary = observe(true);
    if (!boundary || adapter.validate(mounted.main, boundary)) throw new Error("SETUP: completed seed boundary is invalid");
    status = "running";
    return boundary;
}
window.__persistenceFuzz = {
    configure(request) {
        if (status !== "ready") throw new Error("Fixture can be configured only once per document");
        pending = request;
        if (request.clock !== undefined) {
            if (!Number.isFinite(request.clock) || request.clock < 1_000_000) throw new Error("Invalid replay clock");
            clock = request.clock;
            const audio = window.__persistenceFuzzAudio;
            if (audio) audio.advance(clock - audio.now());
        }
        if (request.savedText !== undefined) localStorage.setItem(adapter.key, request.savedText);
    },
    state() {
        return { status, failure, actualPlacement, currentPhase, tick };
    },
    capture,
    context() {
        return adapter.captureContext(capture());
    },
    resumeBoundary,
    run(frames, options = {}) {
        observationExperiment = options.forceWrite === true;
        const trace = [];
        let traceBytes = 0,
            executed = 0;
        for (let index = 0; index < frames.length; index++) {
            tick = (options.offset ?? 0) + index;
            try {
                const snapshot = step(
                    frames[index],
                    options.trace ? "continuation" : "exploration",
                    options.write !== false,
                    options.observe !== false,
                    options.forceWrite === true
                );
                executed++;
                if (snapshot && options.trace) {
                    const normalized = normalize(snapshot);
                    traceBytes += JSON.stringify(normalized).length;
                    if (traceBytes > 64 * 1024 * 1024) throw new Error("Continuation trace budget exceeded");
                    trace.push(normalized);
                }
                if (ResourceLoader.hasPending()) throw new Error("Unexpected resource load inside a fully prepared fixed-step trial");
            } catch (error) {
                issue("RUNTIME_EXCEPTION", { error: errorDetails(error) });
                break;
            }
        }
        observationExperiment = false;
        return { ...this.result(), trace, executed };
    },
    benchmark() {
        const original = mounted.store.validateOutgoingSnapshot;
        const rows = [];
        try {
            for (const full of [false, true]) {
                mounted.store.validateOutgoingSnapshot = full ? original : (main, snapshot) => adapter.validateBaseline(main, snapshot) === null;
                const started = benchmarkNow();
                for (let index = 0; index < 32; index++) {
                    const result = mounted.store.save(mounted.main, () => true);
                    if (!result.saved) throw new Error("Benchmark requires successful current saves");
                }
                rows.push({ fullLoadedResourcePreflight: full, saves: 32, elapsedMs: benchmarkNow() - started });
            }
        } finally {
            mounted.store.validateOutgoingSnapshot = original;
        }
        return rows;
    },
    checkpoint() {
        currentPhase = "checkpoint";
        const saved = save();
        if (!saved) return null;
        return {
            formatVersion: 2,
            ...saved,
            origin: { caseId: spec.caseId, seedRecipe: { ...spec, initialCheckpoint: undefined }, observedStart: actualPlacement },
            captureContext: adapter.captureContext(saved.snapshot),
            clock
        };
    },
    armDeparture() {
        sessionStorage.removeItem("persistence-fuzz-departure");
        armedDeparture = true;
        const snapshot = capture();
        return { snapshot, captureContext: adapter.captureContext(snapshot), clock };
    },
    disarmDeparture() {
        armedDeparture = false;
    },
    result() {
        return {
            issues: findings.values(),
            actualPlacement,
            coverage: [...coverage, ...observation.markers],
            metrics: {
                ...observation.metrics,
                validations,
                captures,
                writes,
                restores,
                callbacks: callbackCount,
                renders: renderCount,
                progress,
                saveMs,
                saveMaxMs,
                maxSnapshotChars
            },
            status
        };
    },
    effects() {
        return { ...observation.metrics };
    },
    drain() {
        const value = this.result();
        const metrics = {};
        for (const [name, amount] of Object.entries(value.metrics))
            metrics[name] = ["saveMaxMs", "maxSnapshotChars"].includes(name) ? amount : amount - (drainedMetrics[name] ?? 0);
        const pendingIssues = findings.drain();
        drainedMetrics = { ...value.metrics };
        return { ...value, issues: pendingIssues, metrics };
    },
    departureReceipt() {
        return sessionStorage.getItem("persistence-fuzz-departure");
    },
    retire() {
        armedDeparture = false;
        if (storageSetItem) Object.defineProperty(Storage.prototype, "setItem", storageSetItem);
        if (mounted) {
            adapter.releaseGameAudio();
            adapter.retire(mounted);
            mounted = null;
        }
        Sys.getTime = originalTime;
        Date.now = originalNow;
        if (originalPerformanceNow) Object.defineProperty(performance, "now", originalPerformanceNow);
        else delete performance.now;
        status = "retired";
    }
};
document.querySelector("#start").addEventListener("click", () => {
    if (!pending || status !== "ready") return;
    void boot(pending).catch((error) => {
        failure = errorDetails(error);
        status = "failed";
    });
});
window.addEventListener("pagehide", () => {
    if (!armedDeparture || !mounted) return;
    // Actual navigation event, actual freeze/save helper, no audio/input cleanup
    // before the writer. Complete shell races remain in verify:departure-save.
    currentPhase = "pagehide";
    const started = performance.now();
    const saved = save();
    sessionStorage.setItem(
        "persistence-fuzz-departure",
        JSON.stringify({ saved: saved !== null, milliseconds: performance.now() - started, issues: findings.drain() })
    );
});
