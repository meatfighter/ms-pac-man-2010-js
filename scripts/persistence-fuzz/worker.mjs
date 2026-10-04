/* global window */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { persistenceFuzzPlugin, controlledAudioSource } from "./plugin.mjs";
import { normalizeSnapshot, firstDifference, issueSignature } from "./compare.mjs";
import { stratumId } from "./profiles.mjs";

let server = null,
    browser = null,
    context = null,
    closing = false;
async function cleanup() {
    if (closing) return;
    closing = true;
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
}
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
    const result = {
        issues: [],
        coverage: [],
        metrics: { captures: 0, writes: 0, restores: 0, callbacks: 0, renders: 0, progress: 0, saveMs: 0, saveMaxMs: 0, maxSnapshotChars: 0 },
        setupComplete: false,
        actualPlacement: null,
        nativeAudio: spec.audio === "native"
    };
    const signatures = new Set(),
        coverage = new Set();
    const add = (issue) => {
        const signature = issueSignature(issue);
        if (signatures.has(signature)) return;
        signatures.add(signature);
        result.issues.push(issue);
    };
    const collect = async (page) => {
        const data = await page.evaluate(() => window.__persistenceFuzz?.result()).catch(() => null);
        if (!data) return;
        for (const issue of data.issues) add(issue);
        for (const marker of data.coverage) coverage.add(marker);
        for (const name of Object.keys(result.metrics)) {
            if (["saveMaxMs", "maxSnapshotChars"].includes(name)) result.metrics[name] = Math.max(result.metrics[name], data.metrics[name] ?? 0);
            else result.metrics[name] += data.metrics[name] ?? 0;
        }
    };
    let page = null,
        collected = false;
    const load = async (options) => {
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
            await load(
                spec.initialCheckpoint
                    ? {
                          restore: true,
                          savedText: spec.initialCheckpoint.text,
                          actualPlacement: { ...spec.initialCheckpoint.actualPlacement, strategy: "accepted-corpus-branch", parent: spec.corpusParent },
                          clock: spec.initialCheckpoint.clock
                      }
                    : { restore: false }
            );
        } catch (error) {
            add({ category: "SETUP_FAILED", error: errorDetails(error), pageErrors });
            return result;
        }
        result.setupComplete = true;
        result.actualPlacement = await page.evaluate(() => window.__persistenceFuzz.state().actualPlacement);
        coverage.add(stratumId(result.actualPlacement.stratum));
        coverage.add(`lane:${spec.lane}`);
        const exploration = spec.frames;
        for (let offset = 0; offset < exploration.length; offset += 64) {
            sendProgress("exploration", { offset });
            const data = await page.evaluate(({ frames, offset }) => window.__persistenceFuzz.run(frames, { offset }), {
                frames: exploration.slice(offset, offset + 64),
                offset
            });
            if (data.issues.some((issue) => issue.category === "RUNTIME_EXCEPTION")) break;
        }
        sendProgress("checkpoint");
        if (!request.mutant && spec.index === 0) result.saveBenchmark = await page.evaluate(() => window.__persistenceFuzz.benchmark());
        const checkpoint = await page.evaluate(() => window.__persistenceFuzz.checkpoint());
        if (!checkpoint) return result; // Other trials still run, and evidence is collected in finally.
        // Reference is the ORIGINAL live runtime, not a second restoration.
        await page.evaluate(() => window.__persistenceFuzz.resumeBoundary());
        const reference = await page.evaluate((frames) => window.__persistenceFuzz.run(frames, { trace: true, write: false }), spec.continuation);
        await collect(page);
        collected = true;
        // Cold document: clears static Main/mode state and module singletons.
        sendProgress("cold-restore");
        try {
            await load({ restore: true, savedText: checkpoint.text, actualPlacement: checkpoint.actualPlacement, clock: checkpoint.clock });
        } catch (error) {
            add({ category: "SAVE_SUCCEEDED_RESTORE_REJECTED", snapshot: checkpoint.snapshot, error: errorDetails(error), pageErrors });
            return result;
        }
        const recaptured = await page.evaluate(() => window.__persistenceFuzz.capture());
        const difference = firstDifference(normalized(checkpoint.snapshot), normalized(recaptured));
        if (difference) add({ category: "IMMEDIATE_RECAPTURE_MISMATCH", difference, snapshot: recaptured, previousSnapshot: checkpoint.snapshot });
        await page.evaluate(() => window.__persistenceFuzz.resumeBoundary());
        const restored = await page.evaluate((frames) => window.__persistenceFuzz.run(frames, { trace: true, write: false }), spec.continuation);
        const drift = firstDifference(reference.trace, restored.trace);
        if (drift) add({ category: "CONTINUATION_DIVERGENCE", difference: drift, snapshot: restored.trace.at(-1), previousSnapshot: reference.trace.at(-1) });
        if (spec.observerControl && spec.audio !== "native") {
            // Same restored baseline and schedule, but no per-callback captures,
            // validation or writes. Compare only at the end to detect observers
            // that alter the execution they are supposed to measure.
            const observedFinal = await page.evaluate(() => window.__persistenceFuzz.capture());
            await collect(page);
            collected = true;
            sendProgress("observer-control");
            await load({ restore: true, savedText: checkpoint.text, actualPlacement: checkpoint.actualPlacement, clock: checkpoint.clock });
            await page.evaluate(() => window.__persistenceFuzz.resumeBoundary());
            await page.evaluate((frames) => window.__persistenceFuzz.run(frames, { observe: false, write: false }), spec.continuation);
            const controlFinal = await page.evaluate(() => window.__persistenceFuzz.capture());
            const observationDifference = firstDifference(normalized(observedFinal), normalized(controlFinal));
            if (observationDifference)
                add({ category: "OBSERVATION_CHANGED_RUNTIME", difference: observationDifference, snapshot: controlFinal, previousSnapshot: observedFinal });
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
            await page.evaluate((value) => window.__persistenceFuzz.configure(value), {
                spec,
                restore: true,
                actualPlacement: checkpoint.actualPlacement,
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
        await cleanup();
    }
}
process.once("message", (request) => {
    void executeTrial(request)
        .then((result) => {
            process.send?.({ type: "result", result }, () => process.exit(0));
        })
        .catch((error) => {
            process.send?.({ type: "result", result: { infrastructureFailure: errorDetails(error), issues: [], metrics: {}, coverage: [] } }, () =>
                process.exit(2)
            );
        });
});
