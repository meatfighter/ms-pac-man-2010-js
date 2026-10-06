/* global window */
import { randomUUID } from "node:crypto";
import { ProtocolFailure, protocolVersion, restoreWitness } from "./failure-protocol.mjs";
/** Every new fixture document, including departure, crosses this single boundary. */
export async function loadDocument(page, { origin, operation, trialId, options, diagnostics, onStage = async () => {}, onReady = () => {}, departure }) {
    const token = randomUUID();
    const context = {
        operation,
        trialId,
        documentId: null,
        stage: "navigation",
        restoreWitness: restoreWitness(),
        diagnosticsRef: `trials/${options.spec.index}/context.json`
    };
    const stage = async (value) => {
        context.stage = value;
        diagnostics.begin(context);
        await onStage(context);
    };
    let probeTimer;
    try {
        await stage("navigation");
        const response = await page.goto(`${origin}/__persistence_fuzz__/index.html?document=${token}`, { waitUntil: "domcontentloaded", timeout: 30000 });
        const type = response?.headers()["content-type"] ?? "";
        diagnostics.add("navigation", { status: response?.status(), type, path: new URL(page.url()).pathname });
        if (
            !response?.ok() ||
            !type.includes("text/html") ||
            new URL(page.url()).origin !== origin ||
            new URL(page.url()).pathname !== "/__persistence_fuzz__/index.html"
        )
            throw new Error("Invalid fixture navigation response");
        await stage("bridge-import");
        const ready = await page.waitForFunction(
            (expected) => {
                const boot = window.__persistenceFuzzBoot;
                return boot?.documentToken === expected && ["bridge-ready", "bridge-failed"].includes(boot.stage);
            },
            token,
            { timeout: 30000, polling: 50 }
        );
        await ready.dispose();
        const boot = await page.evaluate(() => window.__persistenceFuzzBoot);
        context.documentId = boot.documentId;
        if (boot.protocolVersion !== protocolVersion || boot.documentToken !== token || boot.stage !== "bridge-ready")
            throw new Error(boot.error?.message ?? "Wrong fixture protocol/document");
        onReady(context);
        if (departure) {
            const receipt = await page.evaluate(() => window.__persistenceFuzz.departureReceipt());
            await departure(receipt);
        }
        await stage("configure");
        await page.evaluate((value) => window.__persistenceFuzz.configure(value), { ...options, operation, trialId });
        await stage("start");
        await page.click("#start");
        const running = await page.waitForFunction(() => ["running", "failed"].includes(window.__persistenceFuzz.state().status), null, {
            timeout: 60000,
            polling: 50
        });
        await running.dispose();
        const state = await page.evaluate(() => window.__persistenceFuzz.state());
        if (state.documentId !== context.documentId || state.protocolVersion !== protocolVersion || new URL(page.url()).searchParams.get("document") !== token)
            throw new Error("Fixture document changed during preparation");
        Object.assign(context, state.probe);
        if (state.status !== "running") throw Object.assign(new Error(state.failure?.message ?? "Fixture failed"), { cause: state.failure });
        if (options.restore && state.writes !== 0) throw new Error("Restored boot performed an outgoing save before comparison");
        await stage("restore-recapture");
        return context;
    } catch (error) {
        try {
            const probe = await Promise.race([
                page.evaluate(() => ({ boot: window.__persistenceFuzzBoot, state: window.__persistenceFuzz?.state() })),
                new Promise((_, reject) => {
                    probeTimer = setTimeout(() => reject(new Error("Final probe timed out")), 1000);
                })
            ]);
            diagnostics.add("failure-probe", probe);
            if (probe.boot?.documentToken === token && (!context.documentId || probe.boot.documentId === context.documentId)) {
                context.documentId = probe.boot.documentId;
                if (probe.state?.probe) Object.assign(context, probe.state.probe);
            }
        } catch (probeError) {
            diagnostics.add("probe-unavailable", { message: String(probeError) });
        }
        clearTimeout(probeTimer);
        throw new ProtocolFailure(error, context);
    }
}
