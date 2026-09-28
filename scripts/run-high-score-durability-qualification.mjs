/* global window */
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, firefox } from "playwright";
import { createServer as createViteServer } from "vite";
import { createReleasePreviewServer } from "./preview-release.mjs";
import { readSelectedHmacKey } from "./hmac-config.mjs";
import { disableFullscreenPreference } from "./fullscreen-test-utils.mjs";
const serverRoot = resolve("../ms-pac-man-2010-server"),
    distRoot = process.env.PWA_ROOT ? dirname(resolve(process.env.PWA_ROOT)) : resolve("dist");
// Import the qualified server modules, never substitute an in-driver scoring algorithm.
const { ScoreStore } = await import(pathToFileURL(join(serverRoot, "dist/persistence.js")));
const { createApp } = await import(pathToFileURL(join(serverRoot, "dist/app.js")));
const { parseHmacKeyHex } = await import(pathToFileURL(join(serverRoot, "dist/checksum.js")));
const { serializeStorageDocument, validateStorageDocument, parseJsonDocument } = await import(pathToFileURL(join(serverRoot, "dist/validation.js")));
assert.equal(typeof ScoreStore, "function");
assert.equal(typeof createApp, "function");
const keyHex = readSelectedHmacKey("active");
parseHmacKeyHex(keyHex); // Never printed, persisted, or included in evidence.
const directory = await mkdtemp(join(tmpdir(), "pac-browser-durability-"));
await writeFile(join(directory, "scores.dat"), serializeStorageDocument([]));
const evidence = {
    cases: [],
    responses: [],
    seed: "initialized production serializer; deterministic Enter Initials boundary, not natural playthrough",
    processKills: [],
    platform: process.platform
};
let child = null,
    apiPort = 0,
    mode = "normal",
    posts = 0,
    held = null,
    barriers = [],
    origin = "";
const mounts = ["/durable-a/", "/durable-b/"];
const previews = mounts.map((basePath) => createReleasePreviewServer({ basePath, distRoot, host: "127.0.0.1" }).listeners("request")[0]);
const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, "http://127.0.0.1");
        if (url.pathname !== "/api/ms-pac-man-2010/scores") {
            const i = mounts.findIndex((p) => url.pathname.startsWith(p));
            if (i < 0) {
                res.writeHead(404).end();
                return;
            }
            previews[i](req, res);
            return;
        }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const post = req.method === "POST";
        if (post) posts++;
        if (post && mode === "before-route") {
            held = { phase: "before-route", res };
            return;
        }
        if (post && mode === "refuse") {
            res.writeHead(503, { "Retry-After": "0" }).end();
            return;
        }
        const upstream = httpRequest(
            { host: "127.0.0.1", port: apiPort, path: "/scores", method: req.method, headers: { ...req.headers, host: "127.0.0.1:" + apiPort } },
            (reply) => {
                const data = [];
                reply.on("data", (chunk) => data.push(chunk));
                reply.on("end", () => {
                    const headers = { ...reply.headers };
                    if (post && mode === "old-server") delete headers["mspacman-score-durable"];
                    if (post) evidence.responses.push({ status: reply.statusCode, durable: headers["mspacman-score-durable"] ?? null });
                    if (post && mode === "after-commit" && reply.statusCode === 200) {
                        held = { phase: "after-commit", res };
                        return;
                    }
                    if (!res.destroyed) {
                        res.writeHead(reply.statusCode, headers);
                        res.end(Buffer.concat(data));
                    }
                });
            }
        );
        upstream.on("error", () => {
            if (!res.destroyed) res.writeHead(503).end();
        });
        upstream.end(body);
    } catch (error) {
        if (!res.destroyed) res.writeHead(500).end();
        console.error("Local score router failed", error);
    }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
origin = "http://127.0.0.1:" + server.address().port;
async function until(predicate, label, timeout = 20000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
        if (await predicate()) return;
        await delay(20);
    }
    throw new Error("Timed out: " + label);
}
async function stopApi() {
    if (!child) return;
    const old = child;
    child = null;
    const gone = new Promise((r) => old.once("exit", r));
    old.kill("SIGKILL");
    await gone;
}
async function startApi(phase = "none") {
    barriers = [];
    const worker = fork(join(serverRoot, "test/durability-process-worker.mjs"), [], { cwd: serverRoot, stdio: ["ignore", "ignore", "pipe", "ipc"] });
    child = worker;
    let ready = false,
        error = null;
    worker.on("message", (m) => {
        if (m.kind === "ready") {
            apiPort = m.port;
            ready = true;
        }
        if (m.kind === "barrier") barriers.push(m.phase);
        if (m.kind === "error") error = m.message;
    });
    worker.send({ kind: "start", dataDir: directory, keyHex, origins: [origin], phase });
    await until(() => {
        if (error) throw new Error(error);
        return ready;
    }, "isolated server startup");
}
const vite = await createViteServer({ configFile: resolve("pwa/vite.config.ts"), server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
await vite.listen();
const seedUrl = "http://127.0.0.1:" + vite.httpServer.address().port + "/browser-verify.html?suite=high-score-seed";
const slot = (path, name) => `ms-pac-man-2010:${encodeURIComponent(path + "pwa/")}:${name}`;
const queue = async (page, path = mounts[0]) =>
    page.evaluate(
        (k) => {
            const text = localStorage.getItem(k);
            return text === null ? null : JSON.parse(text);
        },
        slot(path, "high-score-outbox")
    );
const disk = async () => validateStorageDocument(parseJsonDocument(await readFile(join(directory, "scores.dat"), "utf8"))).scores;
let candidateScore = 123450;
try {
    await startApi();
    for (const [name, type] of [
        ["chromium", chromium],
        ["firefox", firefox]
    ]) {
        const browser = await type.launch({
            headless: true,
            ...(name === "chromium" ? { args: ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] } : {})
        });
        try {
            const seedPage = await browser.newPage();
            await seedPage.goto(seedUrl);
            await seedPage.waitForFunction(() => window.scoreDurabilitySeed !== undefined, null, { timeout: 60000 });
            const template = JSON.parse(await seedPage.evaluate(() => window.scoreDurabilitySeed));
            assert.equal(template.version, 11);
            await seedPage.close();
            async function context() {
                const c = await browser.newContext();
                c.setDefaultTimeout(30000);
                await c.route("**/*", (route) => {
                    const host = new URL(route.request().url()).hostname;
                    if (host !== "127.0.0.1" && host !== "localhost") throw new Error("Non-loopback request forbidden: " + host);
                    return route.continue();
                });
                return c;
            }
            async function open(c, path = mounts[0], seed = null) {
                const p = await c.newPage();
                await p.clock.install({ time: Date.now() });
                if (seed)
                    await p.addInitScript(
                        ({ key, bytes }) => {
                            if (localStorage.getItem(key) === null) localStorage.setItem(key, bytes);
                        },
                        { key: slot(path, "game-state"), bytes: JSON.stringify(seed) }
                    );
                await p.goto(origin + path + "pwa/");
                await p.locator("#newGameButton").waitFor();
                await disableFullscreenPreference(p);
                return p;
            }
            function seed() {
                const s = structuredClone(template);
                candidateScore += 10;
                s.mainFields.score = candidateScore;
                s.mode.fields.initials = "DUR";
                return s;
            }
            async function submit(p, path = mounts[0]) {
                await p.locator("#continueButton").click();
                await p.locator("canvas").waitFor();
                await p.locator("canvas").focus();
                await p.keyboard.press("Enter");
                await until(async () => Boolean((await queue(p, path))?.pending.length), "actual Start writes outbox");
            }
            async function menu(p) {
                const button = p.locator("#game-menu-button");
                if (await button.count()) await button.click();
                else await p.evaluate(() => window.dispatchEvent(new Event("blur")));
                await p.locator("#newGameButton").waitFor();
            }
            async function drain(p, path = mounts[0]) {
                const q = await queue(p, path);
                assert.ok(q);
                await p.clock.fastForward(Math.max(0, q.notBefore - Date.now()) + 1000);
                await until(async () => (await queue(p, path))?.pending.length === 0, "durable replay drains", 30000);
            }
            for (const loss of ["before-route", "after-commit", "refuse", "old-server"]) {
                const c = await context();
                try {
                    const s = seed();
                    mode = loss;
                    held = null;
                    const initialPosts = posts;
                    let p = await open(c, mounts[0], s);
                    await submit(p);
                    await until(() => posts > initialPosts, "first real POST");
                    if (loss === "before-route" || loss === "after-commit") await until(() => held !== null, "loss barrier");
                    else await until(async () => (await queue(p))?.failures > 0, "failed response retained");
                    assert.equal((await queue(p)).pending[0].score, s.mainFields.score);
                    if (loss === "before-route")
                        assert.equal(
                            (await disk()).some((t) => t.score === s.mainFields.score),
                            false
                        );
                    if (loss === "after-commit") assert.equal((await disk()).filter((t) => t.score === s.mainFields.score).length, 1);
                    if (loss === "refuse") {
                        await menu(p);
                        await p.locator("#newGameButton").click();
                        await p.locator("canvas").waitFor();
                        await menu(p);
                        assert.equal((await queue(p)).pending.length, 1);
                    }
                    await p.close();
                    held?.res.destroy();
                    held = null;
                    mode = "normal";
                    p = await open(c);
                    const beforeReplay = posts;
                    await delay(150);
                    assert.equal(posts, beforeReplay, "fresh document respects persisted reservation");
                    await drain(p);
                    assert.equal((await disk()).filter((t) => t.score === s.mainFields.score).length, 1);
                    evidence.cases.push(name + ":" + loss + ":fresh-replay");
                } finally {
                    mode = "normal";
                    held?.res.destroy();
                    held = null;
                    await c.close();
                }
            }
            for (const phase of ["rename", "directory", "response"]) {
                const c = await context();
                try {
                    await stopApi();
                    await startApi(phase);
                    const s = seed();
                    let p = await open(c, mounts[0], s);
                    await submit(p);
                    await until(() => barriers.includes(phase), "server " + phase + " barrier");
                    await stopApi();
                    await p.close();
                    await startApi();
                    p = await open(c);
                    await drain(p);
                    assert.equal((await disk()).filter((t) => t.score === s.mainFields.score).length, 1);
                    evidence.processKills.push(name + ":" + phase);
                } finally {
                    await c.close();
                }
            }
            // A pending independent outbox survives schema rejection, New Game, and path isolation.
            {
                const c = await context();
                try {
                    mode = "refuse";
                    const s = seed();
                    let p = await open(c, mounts[0], s);
                    await submit(p);
                    await until(async () => (await queue(p))?.failures > 0, "retained failure");
                    const before = await queue(p);
                    await p.evaluate(
                        (k) => {
                            const s = JSON.parse(localStorage.getItem(k));
                            s.version = 10;
                            localStorage.setItem(k, JSON.stringify(s));
                        },
                        slot(mounts[0], "game-state")
                    );
                    await p.close();
                    mode = "normal";
                    p = await open(c);
                    assert.equal(await p.locator("#continueButton").isDisabled(), true);
                    assert.deepEqual((await queue(p)).pending, before.pending);
                    await drain(p);
                    await p.close();
                    const other = await open(c, mounts[1]);
                    assert.equal(await queue(other, mounts[1]), null);
                    evidence.cases.push(name + ":schema10-rejection-independent-queue-and-two-paths");
                } finally {
                    mode = "normal";
                    await c.close();
                }
            }
            // Native Web Locks takeover and explicit Reset retire the old application before removal.
            {
                const c = await context();
                try {
                    mode = "after-commit";
                    held = null;
                    const s = seed();
                    const first = await open(c, mounts[0], s);
                    await submit(first);
                    await until(() => held !== null, "old-owner response held");
                    const second = await c.newPage();
                    await second.goto(origin + mounts[0] + "pwa/");
                    await second.getByRole("button", { name: "Continue Here" }).click();
                    await second.locator("#resetButton").waitFor();
                    await second.locator("#resetButton").click();
                    await until(async () => (await queue(second)) === null, "Reset clears queue");
                    mode = "normal";
                    held.res.destroy();
                    held = null;
                    await delay(150);
                    assert.equal(await queue(second), null);
                    assert.equal((await disk()).filter((t) => t.score === s.mainFields.score).length, 1, "Reset is not server rollback");
                    evidence.cases.push(name + ":native-takeover-reset-stale-response");
                } finally {
                    mode = "normal";
                    held?.res.destroy();
                    held = null;
                    await c.close();
                }
            }
            console.log(name + ": packaged durable-score loss/reload/retry/kill/ownership/schema/path scenarios passed");
        } finally {
            await browser.close();
        }
    }
    const required = ["before-route", "after-commit", "refuse", "old-server"].flatMap((kind) =>
        ["chromium", "firefox"].map((n) => n + ":" + kind + ":fresh-replay")
    );
    for (const entry of required) assert.ok(evidence.cases.includes(entry));
    assert.equal(evidence.processKills.length, 6);
    if (process.env.QUALIFICATION_EVIDENCE_DIR)
        await writeFile(join(process.env.QUALIFICATION_EVIDENCE_DIR, "high-score-durability-browser.json"), JSON.stringify(evidence, null, 2) + "\n");
} finally {
    held?.res.destroy();
    await stopApi();
    await vite.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await rm(directory, { recursive: true, force: true });
}
