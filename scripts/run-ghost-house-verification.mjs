/* global document, window */
import assert from "node:assert/strict";
import { createServer as viteServer } from "vite";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
import { chromium, firefox } from "playwright";

const source = await viteServer({
    configFile: resolve("pwa/vite.config.ts"),
    server: { host: "127.0.0.1", port: 0, watch: null, hmr: false },
    logLevel: "warn"
});
try {
    await source.listen();
    const url = `http://127.0.0.1:${source.httpServer.address().port}/browser-verify.html?suite=ghost-house`;
    for (const [name, type] of [
        ["chromium", chromium],
        ["firefox", firefox]
    ]) {
        const browser = await type.launch({ headless: true });
        try {
            const context = await browser.newContext();
            await context.route("**/*", (route) => (new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort()));
            const page = await context.newPage();
            page.on("pageerror", (e) => console.log(e.message));
            await page.goto(url);
            await page.waitForFunction(() => ["passed", "failed"].includes(document.querySelector("#result")?.dataset.status), null, { timeout: 300000 });
            if ((await page.locator("#result").getAttribute("data-status")) === "failed" && process.env.QUALIFICATION_EVIDENCE_DIR)
                writeFileSync(
                    resolve(process.env.QUALIFICATION_EVIDENCE_DIR, name + "-failure.json"),
                    JSON.stringify(await page.evaluate(() => window.ghostHouseFailure), null, 2)
                );
            assert.equal(await page.locator("#result").getAttribute("data-status"), "passed", await page.locator("#result").textContent());
            const evidence = await page.evaluate(() => window.ghostHouseEvidence);
            const packaged = process.argv.includes("--source-only") ? [] : await packagedChecks(browser, evidence.checkpoints);
            if (process.env.QUALIFICATION_EVIDENCE_DIR) {
                mkdirSync(process.env.QUALIFICATION_EVIDENCE_DIR, { recursive: true });
                writeFileSync(resolve(process.env.QUALIFICATION_EVIDENCE_DIR, `${name}-ghost-house.json`), JSON.stringify({ ...evidence, packaged }));
            }
            console.log(
                JSON.stringify({
                    browser: name,
                    version: browser.version(),
                    checkpoints: evidence.checkpoints.length,
                    packaged,
                    demos: evidence.demos.map((d) => ({ index: d.index, frames: d.frames.length, destination: d.destination }))
                })
            );
        } finally {
            await browser.close();
        }
    }
} finally {
    await source.close();
}

async function packagedChecks(browser, checkpoints) {
    const root = resolve(process.env.PWA_ROOT ?? "dist/pwa");
    const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)]));
    for (const file of walk(root).filter((p) => /\.(js|html)$/.test(p)))
        assert(!/ghostHouseEvidence|ghostHouseFailure|GhostHouseVerification/.test(readFileSync(file, "utf8")), "test hook absent from release");
    const mime = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".ogg": "audio/ogg",
        ".dat": "application/octet-stream"
    };
    const server = createServer((req, res) => {
        const p = new URL(req.url, "http://localhost").pathname,
            file = resolve(root, "." + (p === "/" ? "/index.html" : decodeURIComponent(p)));
        if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) return void res.writeHead(404).end();
        res.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream" });
        res.end(readFileSync(file));
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const context = await browser.newContext();
    const url = `http://127.0.0.1:${server.address().port}/`,
        key = "ms-pac-man-2010:%2F:game-state",
        results = [];
    try {
        await context.route("**/*", (route) => (new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort()));
        for (const checkpoint of checkpoints.filter((c) => /-(points|entry|side-entry|regenerated)$/.test(c.label))) {
            const page = await context.newPage();
            await page.addInitScript(
                ({ key, bytes }) => {
                    if (localStorage.getItem(key) === null) localStorage.setItem(key, bytes);
                    localStorage.setItem("ms-pac-man-2010:%2F:fullscreen", "false");
                },
                { key, bytes: checkpoint.bytes }
            );
            await page.clock.install();
            await page.goto(url);
            await page.waitForFunction(() => window.__gameResourcesPrepared === true, null, { timeout: 120000 });
            await page.clock.pauseAt(Date.now() + 1000);
            await page.evaluate(() => {
                let id = 0;
                const callbacks = new Map();
                window.ghostHouseFrames = () => {
                    const ready = [...callbacks.values()];
                    callbacks.clear();
                    for (const callback of ready) callback(performance.now());
                };
                window.requestAnimationFrame = (cb) => {
                    callbacks.set(++id, cb);
                    return id;
                };
                window.cancelAnimationFrame = (id) => callbacks.delete(id);
            });
            const resume = async () => {
                await page.evaluate(() => document.getElementById("continueButton").click());
                for (let i = 0; i < 30; i++) await page.evaluate(() => window.ghostHouseFrames());
                await page.locator("canvas").waitFor();
            };
            const menu = async () => {
                await page.locator("#menuButton").waitFor();
                await page.evaluate(() => document.getElementById("menuButton").click());
                await page.locator("#continueButton").waitFor();
                return JSON.parse(await page.evaluate((key) => localStorage.getItem(key), key));
            };
            await resume();
            const first = await menu(),
                expected = JSON.parse(checkpoint.bytes);
            assert.notEqual(first.appVersion, expected.appVersion, checkpoint.label + " actual canonical overwrite");
            assert.equal(first.version, 12);
            assert.deepEqual(first.mode, expected.mode, checkpoint.label + " cold restore");
            assert.deepEqual(first.random, expected.random);
            await resume();
            const second = await menu();
            assert.deepEqual(second.mode, first.mode, checkpoint.label + " retained Continue");
            await page.reload();
            await page.waitForFunction(() => window.__gameResourcesPrepared === true, null, { timeout: 120000 });
            assert.equal(
                await page.evaluate((key) => localStorage.getItem(key), key),
                JSON.stringify(second),
                checkpoint.label + " reload preserves canonical save"
            );
            await page.evaluate(() => document.getElementById("continueButton").click());
            await page.clock.runFor(1000);
            await page.locator("canvas").waitFor();
            await page.evaluate(() => document.getElementById("menuButton").click());
            await page.locator("#continueButton").waitFor();
            const reloaded = JSON.parse(await page.evaluate((key) => localStorage.getItem(key), key));
            assert.equal(reloaded.version, 12);
            assert.equal(reloaded.mode.id, "playing");
            await page.evaluate(() => localStorage.clear());
            results.push(checkpoint.label);
            await page.close();
        }
        assert.equal(results.length, 14);
        return results;
    } finally {
        await context.close();
        await new Promise((done) => server.close(done));
    }
}
