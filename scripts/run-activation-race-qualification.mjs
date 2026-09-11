/* global window, navigator */
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
    browser = await chromium.launch({ headless: false, args: ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
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
        Object.defineProperty(globalThis, "__cutoverAudioCreates", { configurable: true, value: () => ({ instrumented, created }) });
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

    // Two trusted Continue clicks while STARTING must still publish one accepted attempt.
    await openLiveMenu(page, "double Continue");
    let before = await readAudioCreates(page);
    await page.locator(continueSelector).first().dblclick({ delay: 0 });
    await page.locator(continueSelector).first().waitFor({ state: "hidden" });
    await waitForRunning(page, "double Continue");
    let after = await expectOneFreshContext(page, before, "double Continue");

    // Multiple departure signals in one task are one effective departure.
    await page.evaluate(() => {
        window.dispatchEvent(new Event("blur"));
        window.dispatchEvent(new Event("pagehide"));
    });
    await waitForMenu(page, "blur then pagehide");
    assert.equal((await readAudioCreates(page)).created, after.created, "departure signals created audio");
    await page.locator(continueSelector).first().click();
    await page.locator(continueSelector).first().waitFor({ state: "hidden" });
    await waitForRunning(page, "Continue after blur/pagehide");
    after = await expectOneFreshContext(page, after, "Continue after blur/pagehide");

    await page.evaluate(() => {
        window.dispatchEvent(new Event("pagehide"));
        window.dispatchEvent(new Event("blur"));
    });
    await waitForMenu(page, "pagehide then blur");
    assert.equal((await readAudioCreates(page)).created, after.created, "reversed departure signals created audio");
    await page.locator(continueSelector).first().click();
    await page.locator(continueSelector).first().waitFor({ state: "hidden" });
    await waitForRunning(page, "Continue after pagehide/blur");
    after = await expectOneFreshContext(page, after, "Continue after pagehide/blur");

    // Two trusted New Game clicks from a retained live menu must destroy/replace once and accept one new start.
    await openLiveMenu(page, "double New Game");
    before = await readAudioCreates(page);
    await page.locator(newGameSelector).first().dblclick({ delay: 0 });
    await page.locator(newGameSelector).first().waitFor({ state: "hidden" });
    await waitForRunning(page, "double New Game");
    await expectOneFreshContext(page, before, "double New Game");

    assert.deepEqual(errors, [], "activation-race qualification produced uncaught browser errors");
    console.log("Activation-race qualification passed: double starts accept one fresh generation and duplicate departure signals are idempotent.");
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
    assert.equal(await page.locator("canvas").count(), 1, `${label}: expected one retained canvas`);
    assert.equal(await page.locator(menuButtonSelector).count(), 0, `${label}: gameplay menu control remained active`);
}

async function waitForRunning(page, label) {
    await page.locator("canvas").waitFor({ state: "visible" });
    await page.locator(menuButtonSelector).first().waitFor({ state: "visible" });
    assert.equal(await page.locator("canvas").count(), 1, `${label}: expected exactly one current canvas`);
    assert.equal(await page.locator(menuButtonSelector).count(), 1, `${label}: expected exactly one current gameplay menu control`);
}

async function readAudioCreates(page) {
    return page.evaluate(() => globalThis.__cutoverAudioCreates?.() ?? { instrumented: false, created: 0 });
}

async function expectOneFreshContext(page, before, label) {
    const after = await readAudioCreates(page);
    if (before.instrumented && before.created > 0) {
        assert.equal(after.created, before.created + 1, `${label}: expected exactly one fresh AudioContext`);
    }
    return after;
}
