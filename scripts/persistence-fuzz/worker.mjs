/* global window */
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadDocument } from "./document-loader.mjs";
import { Diagnostics } from "./diagnostics.mjs";
import { protocolVersion, errorDetails, classifyFailure, eligibleFinding } from "./failure-protocol.mjs";
import { persistenceFuzzPlugin, controlledAudioSource } from "./plugin.mjs";
import { normalizeSnapshot, firstDifference, snapshotCoverage } from "./compare.mjs";
import { sealCheckpoint, assertCheckpoint } from "./checkpoint.mjs";
import { randomUUID } from "node:crypto";
import { stratumId } from "./profiles.mjs";

let server = null,
    browser = null,
    browserServer = null,
    cacheDir = null,
    context = null,
    cleanupPromise = null,
    stopping = false;
let activeDrain = async () => {};
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
        if (!process.connected) {
            clearTimeout(timeout);
            acknowledgements.delete(sequence);
            reject(new Error("Evidence IPC disconnected"));
            return;
        }
        process.send({ type: "evidence", sequence, packet }, (error) => {
            if (error) {
                clearTimeout(timeout);
                acknowledgements.delete(sequence);
                reject(error);
            }
        });
    });
}
function bounded(promise, ms, message) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(message)), ms);
        })
    ]).finally(() => clearTimeout(timer));
}
function cleanup() {
    return (cleanupPromise ??= (async () => {
        const errors = [];
        for (const [name, resource] of [
            ["context", context],
            ["browser", browser],
            ["browser-server", browserServer],
            ["vite", server]
        ]) {
            try {
                await bounded(resource?.close(), 3000, `Cleanup ${name} timed out`);
            } catch (error) {
                errors.push({ name, error: errorDetails(error) });
            }
        }
        if (cacheDir && errors.length === 0) {
            try {
                rmSync(cacheDir, { recursive: true });
            } catch (error) {
                errors.push({ name: "private-cache", error: errorDetails(error) });
            }
        }
        return { complete: errors.length === 0, errors };
    })());
}
process.on("message", (message) => {
    if (message.type === "evidence-ack") {
        acknowledgements.get(message.sequence)?.();
        acknowledgements.delete(message.sequence);
    }
    if (message.type === "stop") stopping = true;
});
process.once("SIGTERM", () => {
    stopping = true;
});
process.once("SIGINT", () => {
    stopping = true;
});
function sendProgress(phase, detail = {}) {
    process.send?.({ type: "progress", phase, ...detail });
}

export async function executeTrial(request) {
    const { repo, spec, browserEngine = "chromium", executablePath } = request;
    const result = {
        protocolVersion,
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
    };
    const trialIdentity = randomUUID();
    let diagnostics,
        documentContext = { operation: "initial-entry", stage: "runtime-prepare", trialId: trialIdentity },
        candidateCheckpoint = null;
    const recordFailure = (error, stage) => {
        const record = error.record ?? classifyFailure(error, { ...documentContext, ...(stage ? { stage } : {}) });
        record.evidenceId ??= `${trialIdentity}:worker:${++workerSequence}`;
        if (error && typeof error === "object") error.record ??= record;
        add(record);
        result.incomplete = true;
        if (!eligibleFinding(record)) result.infrastructureFailure ??= record;
    };
    let documentGeneration = 0,
        workerSequence = 0,
        streamOffset = 0;
    const deliveries = new Set(),
        coverage = new Set();
    const add = (issue) => {
        issue = {
            protocolVersion,
            domain: issue.category === "RUNTIME_EXCEPTION" ? "runtime" : "persistence",
            operation: documentContext.operation,
            stage: documentContext.stage,
            documentId: documentContext.documentId,
            ...issue,
            evidenceId: issue.evidenceId ?? `${trialIdentity}:worker:${++workerSequence}`
        };
        if (deliveries.has(issue.evidenceId)) return;
        deliveries.add(issue.evidenceId);
        result.issues.push(issue);
        if (issue.category === "FINDING_EVIDENCE_LIMIT") {
            issue.domain = "evidence";
            result.incomplete = true;
        }
    };
    const transferPending = async () => {
        const end = result.issues.length;
        await transfer({
            ...result,
            context: diagnostics?.snapshot(),
            trialIndex: spec.index,
            acceptedCheckpoint: undefined,
            issues: result.issues.slice(streamOffset),
            coverage: [...coverage]
        });
        streamOffset = end;
    };
    let page = null,
        documentReady = false,
        drainSequence = 0,
        queue = Promise.resolve();
    let drainFailure;
    const mergedBatches = new Set();
    const collect = (page) => {
        const work = async () => {
            if (!documentReady) {
                await transferPending();
                return;
            }
            const batchId = `${trialIdentity}:${documentGeneration}:${++drainSequence}`;
            let data;
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    data ??= await bounded(
                        page.evaluate((id) => window.__persistenceFuzz.prepareDrain(id), batchId),
                        3000,
                        "Browser drain timed out"
                    );
                    if (!data || data.protocolVersion !== protocolVersion || data.documentId !== documentContext.documentId || data.batchId !== batchId)
                        throw new Error("Evidence document/protocol mismatch");
                    if (!mergedBatches.has(batchId)) {
                        for (const issue of data.issues) add({ ...issue, evidenceId: `${trialIdentity}:${data.documentId}:${issue.sequence}` });
                        for (const marker of data.coverage) coverage.add(marker);
                        for (const name of Object.keys(result.metrics)) {
                            if (["saveMaxMs", "maxSnapshotChars"].includes(name))
                                result.metrics[name] = Math.max(result.metrics[name], data.metrics[name] ?? 0);
                            else result.metrics[name] += data.metrics[name] ?? 0;
                        }
                        mergedBatches.add(batchId);
                    }
                    await transferPending();
                    await bounded(
                        page.evaluate((id) => window.__persistenceFuzz.ackDrain(id), batchId),
                        3000,
                        "Browser ACK timed out"
                    );
                    mergedBatches.delete(batchId);
                    return;
                } catch (error) {
                    if (attempt === 1) {
                        recordFailure(error, "evidence-drain");
                        drainFailure = error;
                        throw error;
                    }
                }
            }
        };
        const next = queue.then(work);
        queue = next.catch(() => {});
        return next;
    };
    activeDrain = () => (drainFailure ? Promise.reject(drainFailure) : page ? collect(page) : transferPending());
    const load = async (options, operation = options.restore ? "cold-restore" : "initial-entry", departure) => {
        if (documentReady) await collect(page);
        documentReady = false;
        documentGeneration++;
        documentContext = { operation, trialId: trialIdentity, stage: "navigation" };
        documentContext = await loadDocument(page, {
            origin,
            operation,
            trialId: trialIdentity,
            options: {
                spec,
                mutant: request.mutant,
                fault: request.fixtureFault,
                ...options,
                ...(request.fixtureFault === "restore-false" && options.restore ? { savedText: "{}" } : {})
            },
            diagnostics,
            departure,
            onStage: async (value) => {
                documentContext = value;
                await transferPending();
            },
            onReady: (value) => {
                documentReady = true;
                documentContext = value;
            }
        });
    };
    const runFrames = async (frames, options = {}) => {
        const trace = [];
        let executed = 0,
            traceBytes = 0;
        documentContext.stage = "continuation";
        for (let offset = 0; offset < frames.length; offset += 8) {
            if (stopping) throw new Error("Trial interrupted");
            const data = await page.evaluate(({ frames, options }) => window.__persistenceFuzz.run(frames, options), {
                frames: frames.slice(offset, offset + 8),
                options: { ...options, offset }
            });
            trace.push(...data.trace);
            executed += data.executed;
            traceBytes += JSON.stringify(data.trace).length;
            if (traceBytes > 64 * 1024 * 1024) throw new Error("Continuation trace budget exceeded");
            await collect(page);
            if (data.executed !== Math.min(8, frames.length - offset)) break;
        }
        return { trace, executed };
    };
    const normalized = (snapshot) => normalizeSnapshot(snapshot, { nativeAudio: spec.audio === "native" });
    let origin;
    try {
        sendProgress("prepare");
        // Installed dev dependencies are required. No downloading, lock rewriting,
        // rebuilding production assets, or auto-installation is performed here.
        const [{ createServer }, playwright] = await Promise.all([import("vite"), import("playwright")]);
        const version = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version;
        cacheDir = mkdtempSync(join(tmpdir(), "persistence-fuzz-cache-"));
        await transfer({ ownedCachePath: cacheDir });
        server = await createServer({
            cacheDir,
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
        browserServer = await browserType.launchServer({
            headless: true,
            ...(executablePath ? { executablePath } : {}),
            ...(browserEngine === "chromium"
                ? { args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] }
                : {})
        });
        await transfer({ ownedBrowserPid: browserServer.process().pid });
        browser = await browserType.connect(browserServer.wsEndpoint());
        result.browserVersion = browser.version();
        diagnostics = new Diagnostics(origin);
        diagnostics.add("optimizer", {
            nodeVersion: process.version,
            viteVersion: JSON.parse(readFileSync(join(repo, "node_modules/vite/package.json"), "utf8")).version,
            cacheDir,
            entries: server.config.optimizeDeps.entries,
            include: server.config.optimizeDeps.include,
            exclude: server.config.optimizeDeps.exclude,
            noDiscovery: server.config.optimizeDeps.noDiscovery
        });
        for (const method of ["warn", "error"]) {
            const log = server.config.logger[method].bind(server.config.logger);
            server.config.logger[method] = (...args) => {
                diagnostics.add(`vite-${method}`, { message: String(args[0]) });
                return log(...args);
            };
        }
        context = await browser.newContext({ viewport: { width: 900, height: 900 }, serviceWorkers: "block" });
        const requestFixtureFault = request.fixtureFault;
        await context.route("**/*", (route) => {
            const request = route.request(),
                url = new URL(request.url());
            // Only the isolated server can receive requests; even same-origin API
            // calls and writes are forbidden. Never contact a score server.
            if (requestFixtureFault && url.origin === origin) {
                if (requestFixtureFault === "html-500" && url.pathname.endsWith("index.html"))
                    return route.fulfill({ status: 500, contentType: "text/html", body: "injected fixture failure" });
                if (requestFixtureFault === "module-missing" && url.pathname.endsWith("browser.mjs"))
                    return route.fulfill({ status: 404, contentType: "text/javascript", body: "missing" });
            }
            if (url.origin === origin && ["GET", "HEAD"].includes(request.method()) && !url.pathname.startsWith("/api/")) return route.continue();
            return route.abort("blockedbyclient");
        });
        if (spec.audio !== "native") await context.addInitScript({ content: controlledAudioSource() });
        page = await context.newPage();
        diagnostics.attach(page, browser);
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
                    : { restore: false },
                spec.initialCheckpoint ? "corpus-restore" : "initial-entry"
            );
        } catch (error) {
            recordFailure(error);
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
            if (stopping) throw new Error("Trial interrupted");
            documentContext.stage = "continuation";
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
        if (checkpoint) await transfer({ checkpoint, checkpointStatus: "recovery-only" });
        await collect(page);
        if (!checkpoint) return result; // Other trials still run, and evidence is collected in finally.
        // Reference is the ORIGINAL live runtime, not a second restoration.
        await page.evaluate(() => window.__persistenceFuzz.resumeBoundary());
        const reference = await runFrames(spec.continuation, { trace: true, write: false });
        await collect(page);
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
            recordFailure(error);
            return result;
        }
        const recaptured = await page.evaluate(() => window.__persistenceFuzz.capture());
        const difference = firstDifference(normalized(checkpoint.snapshot), normalized(recaptured));
        if (difference) add({ category: "IMMEDIATE_RECAPTURE_MISMATCH", difference, snapshot: recaptured, previousSnapshot: checkpoint.snapshot });
        else for (const marker of snapshotCoverage(recaptured)) coverage.add(`roundTripped:${marker.replace(/^present:/, "")}`);
        await page.evaluate(() => window.__persistenceFuzz.resumeBoundary());
        const restored = await runFrames(spec.continuation, { trace: true, write: false });
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
            await load(
                {
                    restore: true,
                    savedText: checkpoint.text,
                    actualPlacement: checkpoint.origin?.observedStart,
                    captureContext: checkpoint.captureContext,
                    clock: checkpoint.clock
                },
                "observer-writes"
            );
            await page.evaluate(() => window.__persistenceFuzz.resumeBoundary());
            await runFrames(spec.continuation, { write: true, forceWrite: true });
            const observedFinal = await page.evaluate(() => window.__persistenceFuzz.capture());
            const observedEffects = await page.evaluate(() => window.__persistenceFuzz.effects());
            await collect(page);
            sendProgress("observer-control");
            await load(
                {
                    restore: true,
                    savedText: checkpoint.text,
                    actualPlacement: checkpoint.origin?.observedStart,
                    captureContext: checkpoint.captureContext,
                    clock: checkpoint.clock
                },
                "observer-control"
            );
            await page.evaluate(() => window.__persistenceFuzz.resumeBoundary());
            await runFrames(spec.continuation, { observe: false, write: false });
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
            const departedDocument = documentContext.documentId;
            await load(
                { restore: true, actualPlacement: checkpoint.origin?.observedStart, captureContext: departure.captureContext, clock: departure.clock },
                "departure-reload",
                async (receipt) => {
                    let outcome;
                    try {
                        outcome = JSON.parse(receipt);
                    } catch {
                        outcome = null;
                    }
                    if (
                        !outcome?.saved ||
                        outcome.protocolVersion !== protocolVersion ||
                        outcome.documentId !== departedDocument ||
                        outcome.trialId !== trialIdentity
                    )
                        throw new Error("Missing or mismatched departure receipt");
                    for (const issue of outcome.issues ?? []) add({ ...issue, evidenceId: `${trialIdentity}:${departedDocument}:${issue.sequence}` });
                    const slot = await page.evaluate(() => window.__persistenceFuzz.storedText());
                    if (slot !== outcome.text) throw new Error("Departure slot does not match its receipt");
                }
            );
            const after = await page.evaluate(() => window.__persistenceFuzz.capture());
            const difference = firstDifference(normalized(departure.snapshot), normalized(after));
            if (difference) add({ category: "DEPARTURE_RECAPTURE_MISMATCH", difference, snapshot: after, previousSnapshot: departure.snapshot });
        }
        if (result.issues.length === 0 && pageErrors.length === 0) candidateCheckpoint = checkpoint;
        for (const error of pageErrors) add({ category: "BROWSER_PAGE_ERROR", domain: "runtime", error });
        return result;
    } catch (error) {
        recordFailure(error);
        return result;
    } finally {
        result.interrupted = stopping;
        if (request.fixtureFault === "final-drain-missing" && documentReady) {
            await page.evaluate(() => {
                delete window.__persistenceFuzz;
            });
        }
        try {
            await activeDrain();
            result.evidenceComplete = true;
        } catch (error) {
            result.evidenceComplete = false;
            recordFailure(error, "evidence-drain");
        }
        result.coverage = request.mutant === "missing-coverage" ? [] : [...coverage];
        if (diagnostics?.unexpectedFailures && !result.infrastructureFailure)
            recordFailure(new Error("Unresolved browser or module diagnostics"), "evidence-drain");
        if (diagnostics) diagnostics.cleaning = true;
        result.cleanup = await cleanup();
        if (!result.cleanup.complete) recordFailure(new Error(JSON.stringify(result.cleanup.errors)), "cleanup");
        try {
            await transferPending();
        } catch (error) {
            result.incomplete = true;
            result.evidenceComplete = false;
            result.infrastructureFailure ??= errorDetails(error);
        }
        if (
            candidateCheckpoint &&
            !result.issues.length &&
            !result.incomplete &&
            !result.infrastructureFailure &&
            !stopping &&
            result.evidenceComplete &&
            result.cleanup.complete &&
            result.comparedContinuationSteps === spec.continuation.length
        )
            result.acceptedCheckpoint = candidateCheckpoint;
    }
}
process.once("message", (request) => {
    void executeTrial(request)
        .then((result) => {
            process.send?.({ type: "result", result }, (error) => process.exit(error ? 2 : stopping ? 130 : 0));
        })
        .catch((error) => {
            process.send?.(
                { type: "result", result: { incomplete: true, infrastructureFailure: errorDetails(error), issues: [], metrics: {}, coverage: [] } },
                () => process.exit(2)
            );
        });
});
