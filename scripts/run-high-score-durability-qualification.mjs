/* global window, document */
import assert from "node:assert/strict";
import sharp from "sharp";
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
import { withTimeout } from "./browser-test-utils.mjs";
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
        if (url.pathname === "/__durability-setup") {
            res.writeHead(200, { "Content-Type": "text/html" }).end("<!doctype html><title>Test setup</title>");
            return;
        }
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
                    if (post)
                        evidence.responses.push({
                            status: reply.statusCode,
                            durable: headers["mspacman-score-durable"] ?? null,
                            body: reply.statusCode === 200 ? JSON.parse(Buffer.concat(data).toString("utf8")) : null
                        });
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
    if (child.exitCode !== null || child.signalCode !== null) {
        child = null;
        return;
    }
    const old = child;
    child = null;
    const gone = new Promise((r) => old.once("exit", r));
    old.kill("SIGKILL");
    await withTimeout(gone, 5000, "Isolated server did not exit after kill");
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
            console.log(name + ": creating real initialized seed");
            const seedPage = await browser.newPage();
            await seedPage.goto(seedUrl);
            await seedPage.waitForFunction(() => window.scoreDurabilitySeed !== undefined, null, { timeout: 60000 });
            const template = JSON.parse(await seedPage.evaluate(() => window.scoreDurabilitySeed));
            const hallTemplate = JSON.parse(await seedPage.evaluate(() => window.scoreHallSeed));
            assert.equal(template.version, 12);
            await seedPage.close();
            async function guardRequests(c) {
                await c.route("**/*", (route) => {
                    const host = new URL(route.request().url()).hostname;
                    if (host !== "127.0.0.1" && host !== "localhost") throw new Error("Non-loopback request forbidden: " + host);
                    return route.continue();
                });
            }
            async function context() {
                const c = await browser.newContext();
                c.setDefaultTimeout(30000);
                await guardRequests(c);
                return c;
            }
            async function open(c, path = mounts[0], seed = null, wallTime = Date.now()) {
                const p = await c.newPage();
                await p.clock.install({ time: wallTime });
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
                await p.locator("#continueButton").waitFor({ state: "hidden" });
                await p.locator("canvas").waitFor();
                await p.locator("canvas").focus();
                await p.clock.runFor(100);
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
                console.log(name + ": loss scenario " + loss);
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
            // A real submitted tuple survives anomalous persisted timing, independent wall jumps,
            // and whole-document replacement, then receives a real local-server durable acknowledgement.
            {
                console.log(name + ": monotonic deadline and new-document clock recovery");
                const c = await context();
                try {
                    mode = "refuse";
                    const submitted = seed();
                    let p = await open(c, mounts[0], submitted);
                    await submit(p);
                    await until(async () => (await queue(p))?.failures > 0, "initial retained queue");
                    const original = await queue(p);
                    await p.close();
                    p = await c.newPage();
                    await p.goto(origin + "/__durability-setup");
                    await p.evaluate(
                        (k) => {
                            const q = JSON.parse(localStorage.getItem(k));
                            q.notBefore = Number.MAX_SAFE_INTEGER;
                            localStorage.setItem(k, JSON.stringify(q));
                        },
                        slot(mounts[0], "high-score-outbox")
                    );
                    await p.close();
                    mode = "normal";
                    const priorPosts = posts;
                    p = await open(c);
                    await until(async () => (await queue(p))?.notBefore < Number.MAX_SAFE_INTEGER, "authorized timing repair");
                    let q = await queue(p);
                    assert.deepEqual(q.pending, original.pending);
                    assert.equal(q.failures, original.failures);
                    const initialWall = await p.evaluate(() => Date.now());
                    assert.ok(q.notBefore - initialWall <= 3600000 && q.notBefore > initialWall);
                    await p.clock.setSystemTime(initialWall - 86400000);
                    await p.evaluate(() => window.dispatchEvent(new Event("online")));
                    await until(async () => (await queue(p)).notBefore < initialWall, "rollback realignment");
                    q = await queue(p);
                    assert.deepEqual(q.pending, original.pending);
                    assert.equal(posts, priorPosts);
                    await p.clock.fastForward(30000);
                    const reloadWall = await p.evaluate(() => Date.now());
                    const remainingBefore = q.notBefore - reloadWall;
                    await p.close();
                    p = await open(c, mounts[0], null, reloadWall);
                    const afterReload = await queue(p);
                    assert.equal(afterReload.notBefore, q.notBefore, "reload does not restart an hour");
                    assert.deepEqual(afterReload.pending, original.pending);
                    assert.equal(posts, priorPosts);
                    await p.clock.fastForward(Math.max(1, remainingBefore - 1000));
                    assert.equal(posts, priorPosts, "no early POST after elapsed recovery");
                    await p.clock.fastForward(2000);
                    await until(async () => (await queue(p)).pending.length === 0, "real durable acknowledgement after deadline");
                    assert.equal(posts, priorPosts + 1);
                    assert.equal((await disk()).filter((t) => t.score === submitted.mainFields.score).length, 1);
                    evidence.cases.push(name + ":clock-recovery-new-document-durable-ack");
                } finally {
                    mode = "normal";
                    await c.close();
                }
            }
            for (const phase of ["rename", "directory", "response"]) {
                console.log(name + ": server kill " + phase);
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
            // Real storage failures must remain editable; partial Reset stays dormant.
            {
                console.log(name + ": enqueue failure and partial Reset");
                const c = await context();
                try {
                    const p = await open(c, mounts[0], seed());
                    await p.evaluate(
                        (key) => {
                            const write = Storage.prototype.setItem;
                            window.restoreScoreStorage = () => {
                                Storage.prototype.setItem = write;
                            };
                            Storage.prototype.setItem = function (k, v) {
                                if (k === key) throw new Error("injected quota");
                                return write.call(this, k, v);
                            };
                        },
                        slot(mounts[0], "high-score-outbox")
                    );
                    const initialPosts = posts;
                    await p.locator("#continueButton").click();
                    await p.locator("#continueButton").waitFor({ state: "hidden" });
                    await p.locator("canvas").focus();
                    await p.clock.runFor(100);
                    await p.keyboard.press("Enter");
                    await p.clock.fastForward(500);
                    assert.equal(await queue(p), null);
                    assert.equal(posts, initialPosts);
                    await menu(p);
                    const saved = await p.evaluate((k) => JSON.parse(localStorage.getItem(k)), slot(mounts[0], "game-state"));
                    assert.equal(saved.mode.fields.submissionFailed, true);
                    assert.equal(saved.mode.fields.enterPressed, false);
                    await p.evaluate(() => window.restoreScoreStorage());
                    mode = "refuse";
                    await submit(p);
                    await until(async () => (await queue(p))?.failures > 0, "fresh input retries enqueue");
                    await menu(p);
                    const before = await queue(p);
                    await p.evaluate(
                        (key) => {
                            const remove = Storage.prototype.removeItem;
                            Storage.prototype.removeItem = function (k) {
                                if (k === key) throw new Error("injected remove failure");
                                return remove.call(this, k);
                            };
                        },
                        slot(mounts[0], "high-score-outbox")
                    );
                    await p.locator("#resetButton").click();
                    await p.getByText("Some settings could not be reset.").waitFor();
                    const afterResetPosts = posts;
                    mode = "normal";
                    await p.clock.fastForward(3601000);
                    await p.evaluate(() => {
                        window.dispatchEvent(new Event("online"));
                        document.dispatchEvent(new Event("visibilitychange"));
                    });
                    await delay(150);
                    assert.equal(posts, afterResetPosts);
                    assert.deepEqual(await queue(p), before);
                    evidence.cases.push(name + ":enqueue-failure-fresh-retry-partial-reset-dormant");
                } finally {
                    mode = "normal";
                    await c.close();
                }
            }
            {
                console.log(name + ": offline retained and reload Continue");
                const c = await context();
                try {
                    mode = "refuse";
                    const s = seed();
                    let p = await open(c, mounts[0], s);
                    await submit(p);
                    await until(async () => (await queue(p))?.failures > 0, "offline setup pending");
                    await menu(p);
                    await p.waitForFunction(() => navigator.serviceWorker.controller !== null);
                    await p.waitForFunction(() => window.__gameResourcesPrepared === true);
                    // Firefox interception bypasses offline service-worker navigation. Remove it
                    // only while the entire context is offline; reinstate before networking returns.
                    await c.setOffline(true);
                    await c.unroute("**/*");
                    await p.locator("#continueButton").click();
                    await p.locator("#continueButton").waitFor({ state: "hidden" });
                    await p.locator("canvas").waitFor();
                    await menu(p);
                    assert.equal((await queue(p)).pending.length, 1);
                    await p.reload();
                    await p.locator("#newGameButton").waitFor();
                    assert.equal(await p.locator("#continueButton").isDisabled(), false);
                    await p.locator("#continueButton").click();
                    await p.locator("#continueButton").waitFor({ state: "hidden" });
                    await p.locator("canvas").waitFor();
                    assert.equal((await queue(p)).pending.length, 1);
                    mode = "normal";
                    await guardRequests(c);
                    await c.setOffline(false);
                    await drain(p);
                    assert.equal((await disk()).filter((t) => t.score === s.mainFields.score).length, 1);
                    evidence.cases.push(name + ":offline-retained-and-reload-continue-online-recovery");
                } finally {
                    mode = "normal";
                    await c.close();
                }
            }
            // A pending independent outbox survives schema rejection, New Game, and path isolation.
            {
                console.log(name + ": schema and path isolation");
                const c = await context();
                try {
                    mode = "refuse";
                    const s = seed();
                    let p = await open(c, mounts[0], s);
                    await submit(p);
                    await until(async () => (await queue(p))?.failures > 0, "retained failure");
                    const before = await queue(p);
                    await p.close();
                    p = await c.newPage();
                    await p.goto(origin + "/__durability-setup");
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
            {
                console.log(name + ": takeover with new enqueue");
                const c = await context();
                try {
                    mode = "after-commit";
                    held = null;
                    const a = seed(),
                        b = seed();
                    const first = await open(c, mounts[0], a);
                    await submit(first);
                    await until(() => held !== null, "A committed before takeover");
                    const second = await c.newPage();
                    await second.clock.install({ time: Date.now() });
                    await second.goto(origin + mounts[0] + "pwa/");
                    await second.getByRole("button", { name: "Continue Here" }).click();
                    await second.locator("#newGameButton").waitFor();
                    await disableFullscreenPreference(second);
                    await second.evaluate(({ k, s }) => localStorage.setItem(k, JSON.stringify(s)), { k: slot(mounts[0], "game-state"), s: b });
                    await submit(second);
                    await until(async () => (await queue(second)).pending.length === 2, "B explicitly enqueued by new owner");
                    const both = await queue(second);
                    assert.deepEqual(
                        both.pending.map((t) => t.score),
                        [a.mainFields.score, b.mainFields.score]
                    );
                    mode = "normal";
                    held.res.destroy();
                    held = null;
                    await delay(150);
                    assert.deepEqual((await queue(second)).pending, both.pending, "retired A callback cannot erase B");
                    await second.clock.fastForward(Math.max(0, both.notBefore - Date.now()) + 1000);
                    await until(async () => (await queue(second)).pending.length === 1, "A acknowledgement preserves B");
                    assert.equal((await queue(second)).pending[0].score, b.mainFields.score);
                    await second.clock.fastForward(8000);
                    await until(async () => (await queue(second)).pending.length === 0, "B durably drains");
                    for (const s of [a, b]) assert.equal((await disk()).filter((t) => t.score === s.mainFields.score).length, 1);
                    evidence.cases.push(name + ":native-takeover-old-response-new-enqueue");
                } finally {
                    mode = "normal";
                    held?.res.destroy();
                    held = null;
                    await c.close();
                }
            }
            // Native Web Locks takeover and explicit Reset retire the old application before removal.
            {
                console.log(name + ": takeover and Reset");
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
            {
                console.log(name + ": canonical Hall of Fame pixels");
                const c = await context();
                try {
                    const p = await open(c, mounts[0], hallTemplate);
                    await p.locator("#continueButton").click();
                    await p.locator("#continueButton").waitFor({ state: "hidden" });
                    await p.locator("canvas").waitFor();
                    await delay(500);
                    const shot = await p.locator("canvas").screenshot();
                    const { data: pixels } = await sharp(shot)
                        .resize(800, 600, { kernel: "nearest" })
                        .removeAlpha()
                        .raw()
                        .toBuffer({ resolveWithObject: true });
                    const atlasRoot = join(distRoot, "pwa/images");
                    const definitions = await readFile(join(atlasRoot, "pack_2.def"), "utf8");
                    const table = await disk();
                    let checked = 0;
                    for (let world = 0; world < 4; world++) {
                        const rows = table.filter((t) => t.world === world);
                        for (let row = 0; row < 5; row++) {
                            const entry = rows[row] ?? { score: 0, initials: "AAA" };
                            for (const [text, x] of [
                                [String(entry.score).padStart(10, " "), 384],
                                [entry.initials, 576]
                            ]) {
                                for (let i = 0; i < text.length; i++) {
                                    const char = text[i];
                                    if (char === " ") continue;
                                    const glyph = definitions.match(
                                        new RegExp("white_symbol_" + char.toLowerCase() + "\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)")
                                    );
                                    assert.ok(glyph, "atlas glyph " + char);
                                    const glyphPixels = await sharp(join(atlasRoot, "pack_2.png"))
                                        .extract({ left: +glyph[1], top: +glyph[2], width: 16, height: 16 })
                                        .flatten({ background: "black" })
                                        .removeAlpha()
                                        .raw()
                                        .toBuffer();
                                    let mismatches = 0,
                                        lit = 0;
                                    for (let dy = 0; dy < 16; dy++)
                                        for (let dx = 0; dx < 16; dx++) {
                                            const expected = glyphPixels[(dy * 16 + dx) * 3] > 127;
                                            const at = ((18 * (6 + world * 6 + row) + dy) * 800 + x + i * 16 + dx) * 3;
                                            const actual = pixels[at] > 127 && pixels[at + 1] > 127 && pixels[at + 2] > 127;
                                            if (expected) lit++;
                                            if (expected !== actual) mismatches++;
                                        }
                                    assert.ok(lit > 10);
                                    assert.ok(mismatches <= 24, `${name} canonical displayed glyph ${world}/${row}/${char}: ${mismatches} mismatched pixels`);
                                    checked++;
                                }
                            }
                        }
                    }
                    assert.ok(checked >= 80);
                    if (process.env.QUALIFICATION_EVIDENCE_DIR)
                        await writeFile(join(process.env.QUALIFICATION_EVIDENCE_DIR, name + "-canonical-hall.png"), shot);
                    evidence.cases.push(name + ":canonical-hall-pixels:" + checked);
                } finally {
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
