/* global window, document, navigator */
import assert from "node:assert/strict";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";

const root = resolve(process.env.PWA_ROOT ?? "dist/pwa");
assert(existsSync(resolve(root, "index.html")), `Missing production PWA: ${root}`);

const mime = {
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

const server = createServer((request, response) => {
    const requestUrl = new URL(request.url, "http://localhost");
    const file = resolve(root, "." + decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname));
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
        response.writeHead(404).end();
        return;
    }
    response.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    createReadStream(file).pipe(response);
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const url = `http://127.0.0.1:${server.address().port}/`;
const newGameSelector = "#new-game-button, #newGameButton";
const continueSelector = "#continue-button, #continueButton";
const menuButtonSelector = '#hamburger-button:not([hidden]), #menuButton:not([hidden]), button[aria-label*="menu" i]:not([hidden])';

let browser = null;
try {
    browser = await chromium.launch({
        headless: false,
        args: ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"]
    });
    const context = await browser.newContext();
    context.setDefaultTimeout(60_000);
    await context.addInitScript(() => {
        const NativeAudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext;
        let created = 0;
        let instrumented = false;
        if (typeof NativeAudioContext === "function") {
            try {
                const WrappedAudioContext = new Proxy(NativeAudioContext, {
                    construct(target, args) {
                        created++;
                        return Reflect.construct(target, args, target);
                    }
                });
                if (globalThis.AudioContext === NativeAudioContext) {
                    Object.defineProperty(globalThis, "AudioContext", { configurable: true, writable: true, value: WrappedAudioContext });
                }
                if (globalThis.webkitAudioContext === NativeAudioContext) {
                    Object.defineProperty(globalThis, "webkitAudioContext", { configurable: true, writable: true, value: WrappedAudioContext });
                }
                instrumented = true;
            } catch {
                // Observational only.
            }
        }
        Object.defineProperty(globalThis, "__cutoverAudioCreates", {
            configurable: true,
            value: () => ({ instrumented, created })
        });
    });

    const errors = [];
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto(url);
    await page.locator(newGameSelector).first().waitFor({ state: "visible" });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 120_000 });
    await page.reload();
    await page.locator(newGameSelector).first().waitFor({ state: "visible" });
    await page.locator(newGameSelector).first().click();
    await waitForRunning(page, "initial New Game");

    let audio = await readAudioCreates(page);

    // A foreground event cannot undo a blur-triggered departure.
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await waitForMenu(page, "blur");
    const afterBlur = await readAudioCreates(page);
    await page.evaluate(() => {
        window.dispatchEvent(new Event("focus"));
        window.dispatchEvent(new Event("pageshow"));
        document.dispatchEvent(new Event("visibilitychange"));
    });
    await assertStillMenu(page, "focus/pageshow after blur");
    assert.equal((await readAudioCreates(page)).created, afterBlur.created, "foreground events created audio without explicit activation");
    await continueGame(page, "Continue after blur");
    audio = await expectOneFreshContext(page, audio, "Continue after blur");

    // pagehide has the same one-way policy; pageshow is not a resume command.
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await waitForMenu(page, "pagehide");
    const afterPageHide = await readAudioCreates(page);
    await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    await assertStillMenu(page, "pageshow after pagehide");
    assert.equal((await readAudioCreates(page)).created, afterPageHide.created, "pageshow created audio without explicit activation");
    await continueGame(page, "Continue after pagehide");
    audio = await expectOneFreshContext(page, audio, "Continue after pagehide");

    // Drive the actual AppGameContainer WebGL event handlers. Restoration may prepare rendering,
    // but the shell must remain in MENU until explicit Continue.
    const graphicsCanvas = await page.locator("canvas").elementHandle();
    assert.ok(graphicsCanvas, "missing canvas before graphics-loss test");
    const beforeLoss = await readAudioCreates(page);
    await graphicsCanvas.evaluate((canvas) => canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true })));
    await waitForMenu(page, "graphics context loss");
    assert.equal((await readAudioCreates(page)).created, beforeLoss.created, "graphics loss created replacement audio");
    await graphicsCanvas.evaluate((canvas) => canvas.dispatchEvent(new Event("webglcontextrestored")));
    await assertStillMenu(page, "graphics context restoration");
    assert.equal((await readAudioCreates(page)).created, beforeLoss.created, "graphics restoration created/resumed audio automatically");
    await continueGame(page, "Continue after graphics restoration");
    audio = await expectOneFreshContext(page, audio, "Continue after graphics restoration");

    // A canvas retired by New Game must no longer have authority to route lifecycle events.
    const staleCanvas = await page.locator("canvas").elementHandle();
    assert.ok(staleCanvas, "missing canvas before replacement test");
    await openLiveMenu(page, "before New Game replacement");
    await page.locator(newGameSelector).first().click();
    await page.locator(newGameSelector).first().waitFor({ state: "hidden" });
    await waitForRunning(page, "replacement New Game");
    audio = await expectOneFreshContext(page, audio, "replacement New Game");
    assert.equal(await staleCanvas.evaluate((canvas) => canvas.isConnected), false, "old game canvas remained connected after New Game");
    await staleCanvas.evaluate((canvas) => {
        canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
        canvas.dispatchEvent(new Event("webglcontextrestored"));
    });
    await page.waitForTimeout(50);
    await waitForRunning(page, "stale canvas events");
    assert.equal((await readAudioCreates(page)).created, audio.created, "stale canvas events affected current playback generation");

    assert.deepEqual(errors, [], "lifecycle-event qualification produced uncaught browser errors");
    console.log("Lifecycle-event qualification passed: foreground signals do not resume; graphics restore is inert until Continue; stale canvas events are fenced.");
    await context.close();
} finally {
    if (browser !== null) {
        await browser.close();
    }
    await new Promise((resolveClose) => server.close(resolveClose));
}

async function openLiveMenu(page, label) {
    const menu = page.locator(menuButtonSelector).first();
    await menu.waitFor({ state: "visible" });
    await menu.click();
    await waitForMenu(page, label);
}

async function waitForMenu(page, label) {
    await page.locator(continueSelector).first().waitFor({ state: "visible" });
    assert.equal(await page.locator("canvas").count(), 1, `${label}: expected retained game canvas`);
    assert.equal(await page.locator(menuButtonSelector).count(), 0, `${label}: gameplay menu control remained active`);
}

async function assertStillMenu(page, label) {
    await page.waitForTimeout(50);
    await page.locator(continueSelector).first().waitFor({ state: "visible" });
    assert.equal(await page.locator(menuButtonSelector).count(), 0, `${label}: gameplay resumed without explicit activation`);
}

async function continueGame(page, label) {
    const button = page.locator(continueSelector).first();
    assert.equal(await button.isEnabled(), true, `${label}: Continue is disabled`);
    await button.click();
    await button.waitFor({ state: "hidden" });
    await waitForRunning(page, label);
}

async function waitForRunning(page, label) {
    await page.locator("canvas").waitFor({ state: "visible" });
    await page.locator(menuButtonSelector).first().waitFor({ state: "visible" });
    assert.equal(await page.locator("canvas").count(), 1, `${label}: expected exactly one canvas`);
    assert.equal(await page.locator(menuButtonSelector).count(), 1, `${label}: expected exactly one active gameplay menu control`);
}

async function readAudioCreates(page) {
    return page.evaluate(() => globalThis.__cutoverAudioCreates?.() ?? { instrumented: false, created: 0 });
}

async function expectOneFreshContext(page, before, label) {
    const after = await readAudioCreates(page);
    if (before.instrumented && before.created > 0) {
        assert.equal(after.created, before.created + 1, `${label}: explicit activation did not create exactly one fresh AudioContext`);
    }
    return after;
}
