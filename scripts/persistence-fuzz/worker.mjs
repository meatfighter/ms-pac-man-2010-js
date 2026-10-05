/* global window */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { persistenceFuzzPlugin, controlledAudioSource } from "./plugin.mjs";
import { normalizeSnapshot, firstDifference, snapshotCoverage } from "./compare.mjs";
import { sealCheckpoint, assertCheckpoint } from "./checkpoint.mjs";
import { randomUUID } from "node:crypto";
import { stratumId } from "./profiles.mjs";

let server = null,
    browser = null,
    context = null,
    cleanupPromise = null,
    stopping = false;
let activeResult = null,
    activeDrain = async () => {};
const acknowledgements = new Map();
let evidenceSequence = 0;
function transfer(packet) {
    if (!process.send) return Promise.resolve();
    const sequence = ++evidenceSequence;
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            acknowledgements.delete(sequence);
            reject(new Error("Evidence acknowledgement timeout"));
        }, 3000);
        acknowledgements.set(sequence, () => {
            clearTimeout(timeout);
            resolve();
        });
        process.send({ type: "evidence", sequence, packet });
    });
}
function cleanup() {
    return (cleanupPromise ??= (async () => {
        await context?.close().catch(() => {});
        await browser?.close().catch(() => {});
        await server?.close().catch(() => {});
    })());
}
process.on("message", (message) => {
    if (message.type === "evidence-ack") {
        acknowledgements.get(message.sequence)?.();
        acknowledgements.delete(message.sequence);
        return;
    }
    if (message.type !== "stop") return;
    stopping = true;
    void activeDrain()
        .catch(() => {})
        .finally(() => cleanup())
        .finally(() => process.send?.({ type: "result", result: { ...activeResult, interrupted: true } }, () => process.exit(130)));
});
process.once("SIGTERM", () => {
    void cleanup().finally(() => process.exit(143));
});
process.once("SIGINT", () => {
    void cleanup().finally(() => process.exit(130));
});
const errorDetails = (error) => ({ name: error?.name ?? "Error", message: String(error?.message ?? error), stack: String(error?.stack ?? "").slice(0, 12000) });
function sendProgress(phase, detail = {}) {
    process.send?.({ type: "progress", phase, ...detail });
}

export async function executeTrial(request) {
    const { repo, spec, browserEngine = "chromium", executablePath } = request;
    const result = (activeResult = {
        issues: [],
        coverage: [],
        metrics: {
            validations: 0,
            gameplayUpdates: 0,
            autonomousUpdates: 0,
            inputActionsObserved: 0,
            captures: 0,
            writes: 0,
            restores: 0,
            callbacks: 0,
            renders: 0,
            progress: 0,
            saveMs: 0,
            saveMaxMs: 0,
            maxSnapshotChars: 0
        },
        setupComplete: false,
        actualPlacement: null,
        nativeAudio: spec.audio === "native"
    });
    const trialIdentity = randomUUID();
    let documentGeneration = 0,
        workerSequence = 0,
        streamOffset = 0;
    const deliveries = new Set(),
        coverage = new Set();
    const add = (issue) => {
        issue = { ...issue, evidenceId: issue.evidenceId ?? `${trialIdentity}:worker:${++workerSequence}` };
        if (deliveries.has(issue.evidenceId)) return;
        deliveries.add(issue.evidenceId);
        result.issues.push(issue);
        if (issue.category === "FINDING_EVIDENCE_LIMIT") result.incomplete = true;
    };
    const transferPending = async () => {
        const end = result.issues.length;
        await transfer({ ...result, acceptedCheckpoint: undefined, issues: result.issues.slice(streamOffset), coverage: [...coverage] });
        streamOffset = end;
    };
    let page = null,
        collected = false;
    const collect = async (page) => {
        const data = await page.evaluate(() => window.__persistenceFuzz?.drain()).catch(() => null);
        if (data) {
            for (const issue of data.issues) add({ ...issue, evidenceId: `${trialIdentity}:${documentGeneration}:${issue.sequence}` });
            for (const marker of data.coverage) coverage.add(marker);
            for (const name of Object.keys(result.metrics)) {
                if (["saveMaxMs", "maxSnapshotChars"].includes(name)) result.metrics[name] = Math.max(result.metrics[name], data.metrics[name] ?? 0);
                else result.metrics[name] += data.metrics[name] ?? 0;
            }
        }
        await transferPending();
    };
    activeDrain = () => (page ? collect(page) : transferPending());
    const load = async (options) => {
        if (documentGeneration) await collect(page);
        documentGeneration++;
        collected = false;
        await page.goto(`${origin}/__persistence_fuzz__/index.html`, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => Boolean(window.__persistenceFuzz), null, { timeout: 30000 });
        await page.evaluate((value) => window.__persistenceFuzz.configure(value), { spec, mutant: request.mutant, ...options });
        await page.click("#start");
        await page.waitForFunction(() => ["running", "failed"].includes(window.__persistenceFuzz.state().status), null, { timeout: 60000 });
        const state = await page.evaluate(() => window.__persistenceFuzz.state());
        if (state.status === "failed")
            throw Object.assign(new Error(state.failure?.message ?? "Fixture initialization failed"), { fixtureFailure: state.failure });
    };
    const normalized = (snapshot) => normalizeSnapshot(snapshot, { nativeAudio: spec.audio === "native" });
    let origin;
    try {
        sendProgress("prepare");
        // Installed dev dependencies are required. No downloading, lock rewriting,
        // rebuilding production assets, or auto-installation is performed here.
        const [{ createServer }, playwright] = await Promise.all([import("vite"), import("playwright")]);
        const version = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version;
        server = await createServer({
            configFile: join(repo, "pwa/vite.config.ts"),
            mode: "development",
            clearScreen: false,
            plugins: [persistenceFuzzPlugin()],
            define: { "import.meta.env.VITE_FUZZ_APP_VERSION": JSON.stringify(version) },
            server: { host: "127.0.0.1", port: 0, strictPort: false, open: false, hmr: false, fs: { allow: [repo] } }
        });
        await server.listen();
        const address = server.httpServer?.address();
        if (!address || typeof address === "string") throw new Error("Loopback test server did not bind");
        origin = `http://127.0.0.1:${address.port}`;
        const browserType = playwright[browserEngine];
        if (!browserType?.launch) throw new Error(`Unsupported browser engine: ${browserEngine}`);
        browser = await browserType.launch({
            headless: true,
            ...(executablePath ? { executablePath } : {}),
            ...(browserEngine === "chromium"
                ? { args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] }
                : {})
        });
        result.browserVersion = browser.version();
        context = await browser.newContext({ viewport: { width: 900, height: 900 }, serviceWorkers: "block" });
        await context.route("**/*", (route) => {
            const request = route.request(),
                url = new URL(request.url());
            // Only the isolated server can receive requests; even same-origin API
            // calls and writes are forbidden. Never contact a score server.
            if (url.origin === origin && ["GET", "HEAD"].includes(request.method()) && !url.pathname.startsWith("/api/")) return route.continue();
            return route.abort("blockedbyclient");
        });
        if (spec.audio !== "native") await context.addInitScript({ content: controlledAudioSource() });
        page = await context.newPage();
        const pageErrors = [];
        page.on("pageerror", (error) => {
            if (pageErrors.length < 16) pageErrors.push(errorDetails(error));
        });
        page.setDefaultTimeout(30000);
        try {
            if (spec.initialCheckpoint) assertCheckpoint(spec.initialCheckpoint, request.sourceIdentity, request.allowSourceDrift);
            await load(
                spec.initialCheckpoint
                    ? {
                          restore: true,
                          savedText: spec.initialCheckpoint.text,
                          actualPlacement: spec.initialCheckpoint.origin?.observedStart,
                          captureContext: spec.initialCheckpoint.captureContext,
                          clock: spec.initialCheckpoint.clock
                      }
                    : { restore: false }
            );
        } catch (error) {
            add({ category: "SETUP_FAILED", error: errorDetails(error), pageErrors });
            return result;
        }
        result.setupComplete = true;
        result.observedStartContext = await page.evaluate(() => window.__persistenceFuzz.context());
        result.explorationCallbacks = 0;
        result.actualPlacement = await page.evaluate(() => window.__persistenceFuzz.state().actualPlacement);
        coverage.add(stratumId(result.actualPlacement.stratum));
        coverage.add(`strategy:${spec.strategy}`);
        const exploration = spec.frames;
        for (let offset = 0; offset < exploration.length; offset += 8) {
            sendProgress("exploration", { offset });
            const data = await page.evaluate(({ frames, offset }) => window.__persistenceFuzz.run(frames, { offset }), {
                frames: exploration.slice(offset, offset + 8),
                offset
            });
            result.explorationCallbacks += data.executed;
            await collect(page);
            if (data.issues.some((issue) => issue.category === "RUNTIME_EXCEPTION")) break;
        }
        result.explorationMetrics = { ...result.metrics };
        sendProgress("checkpoint");
        if (!request.mutant && spec.index === 0) result.saveBenchmark = await page.evaluate(() => window.__persistenceFuzz.benchmark());
        const rawCheckpoint = await page.evaluate(() => window.__persistenceFuzz.checkpoint());
        const checkpoint = rawCheckpoint ? sealCheckpoint(rawCheckpoint, request.sourceIdentity) : null;
        if (checkpoint) await transfer({ checkpoint });
        await collect(page);
        if (!checkpoint) return result; // Other trials still run, and evidence is collected in finally.
        // Reference is the ORIGINAL live runtime, not a second restoration.
        await page.evaluate(() => window.__persistenceFuzz.resumeBoundary());
        const reference = await page.evaluate((frames) => window.__persistenceFuzz.run(frames, { trace: true, write: false }), spec.continuation);
        await collect(page);
        collected = true;
        // Cold document: clears static Main/mode state and module singletons.
        sendProgress("cold-restore");
        try {
            await load({
                restore: true,
                savedText: checkpoint.text,
                actualPlacement: checkpoint.origin?.observedStart,
                captureContext: checkpoint.captureContext,
                clock: checkpoint.clock
            });
        } catch (error) {
            add({ category: "SAVE_SUCCEEDED_RESTORE_REJECTED", snapshot: checkpoint.snapshot, error: errorDetails(error), pageErrors });
            return result;
        }
        const recaptured = await page.evaluate(() => window.__persistenceFuzz.capture());
        const difference = firstDifference(normalized(checkpoint.snapshot), normalized(recaptured));
        if (difference) add({ category: "IMMEDIATE_RECAPTURE_MISMATCH", difference, snapshot: recaptured, previousSnapshot: checkpoint.snapshot });
        else for (const marker of snapshotCoverage(recaptured)) coverage.add(`roundTripped:${marker.replace(/^present:/, "")}`);
        await page.evaluate(() => window.__persistenceFuzz.resumeBoundary());
        const restored = await page.evaluate((frames) => window.__persistenceFuzz.run(frames, { trace: true, write: false }), spec.continuation);
        result.comparedContinuationSteps = Math.min(reference.trace.length, restored.trace.length);
        if (result.comparedContinuationSteps !== spec.continuation.length) result.incomplete = true;
        const drift = firstDifference(reference.trace, restored.trace);
        if (drift)
            add({
                category: "CONTINUATION_DIVERGENCE",
                difference: drift,
                snapshot: restored.trace[Number(drift.path.match(/^\$\[(\d+)\]/)?.[1] ?? 0)],
                previousSnapshot: reference.trace[Number(drift.path.match(/^\$\[(\d+)\]/)?.[1] ?? 0)]
            });
        if (spec.observerControl && spec.audio !== "native") {
            // Same restored baseline and schedule, but no per-callback captures,
            // validation or writes. Compare only at the end to detect observers
            // that alter the execution they are supposed to measure.
            await collect(page);
            await load({
                restore: true,
                savedText: checkpoint.text,
                actualPlacement: checkpoint.origin?.observedStart,
                captureContext: checkpoint.captureContext,
                clock: checkpoint.clock
            });
            await page.evaluate(() => window.__persistenceFuzz.resumeBoundary());
            await page.evaluate((frames) => window.__persistenceFuzz.run(frames, { write: true, forceWrite: true }), spec.continuation);
            const observedFinal = await page.evaluate(() => window.__persistenceFuzz.capture());
            const observedEffects = await page.evaluate(() => window.__persistenceFuzz.effects());
            await collect(page);
            collected = true;
            sendProgress("observer-control");
            await load({
                restore: true,
                savedText: checkpoint.text,
                actualPlacement: checkpoint.origin?.observedStart,
                captureContext: checkpoint.captureContext,
                clock: checkpoint.clock
            });
            await page.evaluate(() => window.__persistenceFuzz.resumeBoundary());
            await page.evaluate((frames) => window.__persistenceFuzz.run(frames, { observe: false, write: false }), spec.continuation);
            const controlFinal = await page.evaluate(() => window.__persistenceFuzz.capture());
            const controlEffects = await page.evaluate(() => window.__persistenceFuzz.effects());
            const observationDifference =
                firstDifference(normalized(observedFinal), normalized(controlFinal)) ?? firstDifference(observedEffects, controlEffects, "$.effects");
            if (observationDifference)
                add({
                    category: "OBSERVATION_CHANGED_RUNTIME",
                    observedEffects,
                    controlEffects,
                    difference: observationDifference,
                    snapshot: controlFinal,
                    previousSnapshot: observedFinal
                });
        }
        if (spec.lifecycle) {
            sendProgress("pagehide-reload");
            const departure = await page.evaluate(() => window.__persistenceFuzz.armDeparture());
            await collect(page);
            collected = true;
            await page.reload({ waitUntil: "domcontentloaded" });
            await page.waitForFunction(() => Boolean(window.__persistenceFuzz));
            const receipt = await page.evaluate(() => window.__persistenceFuzz.departureReceipt());
            let outcome;
            try {
                outcome = JSON.parse(receipt);
            } catch {
                outcome = null;
            }
            if (!outcome?.saved) add({ category: "DEPARTURE_SAVE_FAILED", snapshot: departure.snapshot, receipt: outcome });
            for (const issue of outcome?.issues ?? []) add(issue);
            // Do not prime storage here: this must consume the actual departure write.
            collected = false;
            documentGeneration++;
            await page.evaluate((value) => window.__persistenceFuzz.configure(value), {
                spec,
                restore: true,
                actualPlacement: checkpoint.origin?.observedStart,
                captureContext: departure.captureContext,
                clock: departure.clock
            });
            await page.click("#start");
            await page.waitForFunction(() => ["running", "failed"].includes(window.__persistenceFuzz.state().status), null, { timeout: 60000 });
            const state = await page.evaluate(() => window.__persistenceFuzz.state());
            if (state.status !== "running") add({ category: "DEPARTURE_RESTORE_FAILED", snapshot: departure.snapshot, error: state.failure });
            else {
                const after = await page.evaluate(() => window.__persistenceFuzz.capture());
                const departureDifference = firstDifference(normalized(departure.snapshot), normalized(after));
                if (departureDifference)
                    add({ category: "DEPARTURE_RECAPTURE_MISMATCH", difference: departureDifference, snapshot: after, previousSnapshot: departure.snapshot });
            }
        }
        if (result.issues.length === 0 && pageErrors.length === 0) result.acceptedCheckpoint = checkpoint;
        for (const error of pageErrors) add({ category: "BROWSER_PAGE_ERROR", error });
        return result;
    } catch (error) {
        if (!result.setupComplete) result.infrastructureFailure = errorDetails(error);
        else add({ category: "HARNESS_OR_RUNTIME_EXCEPTION", error: errorDetails(error) });
        return result;
    } finally {
        if (page && !collected) await collect(page).catch(() => {});
        result.coverage = request.mutant === "missing-coverage" ? [] : [...coverage];
        await transferPending().catch(() => {
            result.incomplete = true;
        });
        await cleanup();
    }
}
process.once("message", (request) => {
    void executeTrial(request)
        .then((result) => {
            if (!stopping) process.send?.({ type: "result", result }, () => process.exit(0));
        })
        .catch((error) => {
            process.send?.({ type: "result", result: { infrastructureFailure: errorDetails(error), issues: [], metrics: {}, coverage: [] } }, () =>
                process.exit(2)
            );
        });
});
