/* global window, document */
import assert from "node:assert/strict";
import { departureWorld } from "./departure-world.mjs";
import { qualifyDepartureAudio } from "./qualify-departure-audio.mjs";
import { loadDepartureSeeds } from "./departure-seeds.mjs";
import { qualifyDepartureShell } from "./qualify-departure-shell.mjs";
import { createReadStream, existsSync, statSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep, join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { chromium, firefox } from "playwright";
const GAME = "mspacman";
const root = resolve(process.env.PWA_ROOT ?? "dist/pwa");
const total = Number(process.env.DEPARTURE_SAVE_CYCLES ?? 100);
assert(
    Number.isInteger(total) && total >= 100,
    "Departure qualification requires at least 100 reload cycles; increase DEPARTURE_SAVE_CYCLES for investigation"
);
assert(existsSync(join(root, "index.html")), "Build the PWA before qualifying departure saves");
const evidence = resolve(process.env.QUALIFICATION_EVIDENCE_DIR ?? join(tmpdir(), GAME + "-departure-save"));
assert(evidence !== root && !evidence.startsWith(root + sep), "Evidence must remain outside the PWA");
mkdirSync(evidence, { recursive: true });
const sha = (text) => createHash("sha256").update(text).digest("hex");
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const inventory = () => Object.fromEntries(walk(root).map((path) => [path.slice(root.length + 1), sha(readFileSync(path))]));
const before = inventory();
for (const path of walk(root).filter((p) => /\.(js|html)$/.test(p)))
    assert(!readFileSync(path, "utf8").includes("departureTestAccess"), "No test-only shell access in release");
const types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ogg": "audio/ogg",
    ".txt": "text/plain",
    ".xml": "application/xml"
};
const server = createServer((req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    const file = resolve(root, "." + decodeURIComponent(path === "/" ? "/index.html" : path));
    if (req.method !== "GET" || !file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) return void res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    createReadStream(file).pipe(res);
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}/`;
const scope = encodeURIComponent(new URL(".", url).pathname);
const key = GAME === "jackal" ? `jackal.game-state:${scope}` : `${GAME === "stickvania" ? GAME : "ms-pac-man-2010"}:${scope}:game-state`;
const newButton = "#new-game-button, #newGameButton";
const continueButton = "#continue-button, #continueButton";
// Exclude wall clocks, metadata, audio clocks and next-frame baselines. A pass
// requires changed gameplay/presentation state, never a timestamp-only rewrite.
function material(bytes) {
    const snapshot = JSON.parse(bytes);
    return departureWorld(snapshot);
}
const read = (page) => page.evaluate((key) => localStorage.getItem(key), key);
async function menu(page) {
    await page.locator(newButton).first().waitFor({ state: "visible" });
    await page.waitForFunction(() => window.__gameResourcesPrepared === true, null, { timeout: 120000 });
    await page.bringToFront();
}
async function running(page) {
    await page.locator(newButton).first().waitFor({ state: "hidden" });
    await page.locator("canvas").waitFor({ state: "visible" });
    await page.waitForFunction(
        () => document.fullscreenElement !== null || [...document.querySelectorAll('button[aria-label*="menu" i]')].some((button) => !button.hidden)
    );
}
async function openMenu(page) {
    // Desktop fullscreen intentionally hides the hamburger; Escape is the
    // supported user exit in both fullscreen and windowed presentation.
    await page.keyboard.press("Escape");
    await menu(page);
}
try {
    await qualifyDepartureShell(GAME);
    for (const [index, [name, type]] of Object.entries({ chromium, firefox }).entries()) {
        const browser = await type.launch({
            headless: true,
            ...(name === "chromium" ? { args: ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] } : {})
        });
        const records = [],
            errors = [],
            writes = [];
        const result = {
            game: GAME,
            browser: name,
            version: browser.version(),
            key,
            requestedCycles: total,
            higherCount: total > 100,
            root,
            inventory: before,
            records,
            errors
        };
        try {
            const seeds = await loadDepartureSeeds(browser, GAME);
            result.audioIntervals = await qualifyDepartureAudio(browser, GAME, seeds);
            result.producerSeeds = seeds.map(({ label, bytes }) => ({ label, sha256: sha(bytes) }));
            const context = await browser.newContext();
            context.setDefaultTimeout(90000);
            // No production traffic, including high-score submissions. Local fake
            // score responses are deterministic and never forwarded to a network.
            await context.route("**/*", (route) => {
                const request = route.request();
                if (new URL(request.url()).origin !== new URL(url).origin || request.method() !== "GET") {
                    if (GAME === "mspacman")
                        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ protocolVersion: 1, scores: [] }) });
                    return route.abort();
                }
                return route.continue();
            });
            await context.exposeBinding("recordDepartureWrite", (_, value) => writes.push(value));
            await context.addInitScript(
                ({ key }) => {
                    const set = Storage.prototype.setItem;
                    Storage.prototype.setItem = function (candidate, text) {
                        const result = set.call(this, candidate, text);
                        if (this === localStorage && candidate === key) void window.recordDepartureWrite({ bytes: text, time: performance.now() });
                        return result;
                    };
                },
                { key }
            );
            let page = await context.newPage();
            page.on("pageerror", (e) => errors.push(e.message));
            await page.goto(url);
            await menu(page);
            await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 120000 });
            const fullscreen = page.locator("#fullscreen-switch-button");
            if ((await fullscreen.isEnabled()) && (await fullscreen.getAttribute("aria-pressed")) === "true") await fullscreen.click();
            await page.locator(newButton).first().click();
            await running(page);
            await page.keyboard.press("Enter");
            await page.waitForTimeout(600);
            await openMenu(page);
            const count = Math.floor(total / 2) + (index === 0 ? total % 2 : 0);
            let cdp = name === "chromium" ? await context.newCDPSession(page) : null;
            for (let cycle = 0; cycle < count; cycle++) {
                const seed = seeds[cycle];
                if (seed) {
                    await page.close();
                    page = await context.newPage();
                    page.on("pageerror", (e) => errors.push(e.message));
                    await page.goto(url);
                    await menu(page);
                    await page.evaluate(({ key, bytes }) => localStorage.setItem(key, bytes), { key, bytes: seed.bytes });
                    await page.reload();
                    await menu(page);
                    cdp = name === "chromium" ? await context.newCDPSession(page) : null;
                }
                const baseline = await read(page);
                assert(baseline, "Actual producer saved an older valid baseline");
                const writeStart = writes.length;
                const requestedFullscreen = cycle % 6 === 5;
                const fullscreenControl = page.locator("#fullscreen-switch-button");
                if ((await fullscreenControl.isEnabled()) && ((await fullscreenControl.getAttribute("aria-pressed")) === "true") !== requestedFullscreen)
                    await fullscreenControl.click();
                await page.locator(continueButton).first().click();
                await running(page);
                const actualFullscreen = await page.evaluate(() => document.fullscreenElement !== null);
                // Ordinary gameplay controls advance the actual producer. No save
                // payload or game field is edited to manufacture newer progress.
                if (GAME === "jackal" && JSON.parse(baseline).gameMode?.fields.paused) await page.keyboard.press("Enter");
                await page.keyboard.down(cycle % 2 ? "ArrowLeft" : "ArrowRight");
                await page.waitForTimeout(450 + (cycle % 3) * 80);
                await page.keyboard.up(cycle % 2 ? "ArrowLeft" : "ArrowRight");
                const kind = cycle % 6;
                const interruptedContinue = kind === 1 && cycle % 12 === 7;
                if (kind === 1) {
                    await openMenu(page);
                    if (interruptedContinue) {
                        await page.evaluate(() => {
                            document.querySelector("#continue-button, #continueButton").click();
                            window.dispatchEvent(new Event("blur"));
                        });
                        await menu(page);
                    } else {
                        await page.locator(continueButton).first().click();
                        await running(page);
                        await page.waitForTimeout(180);
                    }
                }
                if (kind === 2) {
                    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
                    await menu(page);
                }
                if (kind === 3) {
                    await page.evaluate(() => document.dispatchEvent(new Event("freeze")));
                }
                if (kind === 4) {
                    await context.setOffline(true);
                    if (name === "firefox") {
                        await page.waitForTimeout(150);
                        await context.setOffline(false);
                    }
                }
                const noCache = Boolean(cdp && cycle % 2 === 1);
                if (cdp) await cdp.send("Network.setCacheDisabled", { cacheDisabled: noCache });
                await page.reload({ waitUntil: "domcontentloaded" });
                await menu(page);
                const current = await read(page);
                if (kind === 4) await context.setOffline(false);
                assert(current, "Exact scoped current slot survives real reload");
                assert.notEqual(material(current), material(baseline), `${name} cycle ${cycle}: gameplay must advance; savedAt alone cannot pass`);
                assert.equal(JSON.parse(current).version, JSON.parse(baseline).version, "Current schema only");
                assert(await page.locator(continueButton).first().isEnabled(), "Cold Continue accepts the saved producer state");
                records.push({
                    cycle,
                    seed: seed?.label ?? "continued-runtime",
                    route: ["reload", "retained-continue", "blur", "freeze", "offline", "reload"][kind],
                    noCache,
                    requestedFullscreen,
                    actualFullscreen,
                    interruptedContinue,
                    offlineNavigation: kind === 4 && name === "chromium",
                    baselineSha256: sha(baseline),
                    currentSha256: sha(current),
                    baselineMaterialSha256: sha(material(baseline)),
                    currentMaterialSha256: sha(material(current)),
                    savedAt: JSON.parse(current).savedAt,
                    completedWrites: writes.slice(writeStart).map((w) => ({ sha256: sha(w.bytes), time: w.time }))
                });
                // Actually restore in a fresh runtime, then establish the next
                // older baseline using the real shell writer.
                await page.locator(continueButton).first().click();
                await running(page);
                await openMenu(page);
                writeFileSync(join(evidence, `${GAME}-${name}-departure-save.json`), JSON.stringify(result, null, 2));
                if ((cycle + 1) % 10 === 0) console.log(`${GAME} ${name}: ${cycle + 1}/${count} real reload/cold Continue cycles`);
            }
            assert.deepEqual(errors, [], "No uncaught page errors");
            await context.close();
        } finally {
            writeFileSync(join(evidence, `${GAME}-${name}-departure-save.json`), JSON.stringify(result, null, 2));
            await browser.close();
        }
    }
    assert.deepEqual(inventory(), before, "Qualification never mutates built artifacts");
} finally {
    await new Promise((done) => server.close(done));
}
