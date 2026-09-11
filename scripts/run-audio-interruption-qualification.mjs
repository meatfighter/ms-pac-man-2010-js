/* global navigator */
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
        const contexts = [];
        let instrumented = false;
        if (typeof NativeAudioContext === "function") {
            try {
                const WrappedAudioContext = new Proxy(NativeAudioContext, {
                    construct(target, args) {
                        const audioContext = Reflect.construct(target, args, target);
                        contexts.push(audioContext);
                        return audioContext;
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
        Object.defineProperty(globalThis, "__cutoverAudioInterruption", {
            configurable: true,
            value: {
                stats: () => ({ instrumented, count: contexts.length, states: contexts.map((audioContext) => String(audioContext.state)) }),
                suspendLatest: async () => {
                    const audioContext = contexts.at(-1);
                    if (!audioContext) return false;
                    await audioContext.suspend();
                    return true;
                },
                dispatchStateChange: (index) => {
                    const audioContext = contexts[index];
                    if (!audioContext) return false;
                    audioContext.dispatchEvent(new Event("statechange"));
                    return true;
                }
            }
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

    const before = await stats(page);
    if (!before.instrumented || before.count === 0 || before.states.at(-1) !== "running") {
        console.log(`Audio interruption qualification skipped: no instrumentable running AudioContext (${JSON.stringify(before)}).`);
    } else {
        const staleIndex = before.count - 1;
        assert.equal(await page.evaluate(() => globalThis.__cutoverAudioInterruption.suspendLatest()), true);
        await waitForLiveMenu(page, "current AudioContext suspension");
        const interrupted = await stats(page);
        assert.equal(interrupted.count, before.count, "audio interruption constructed replacement hardware before explicit Continue");

        const continueButton = page.locator(continueSelector).first();
        assert.equal(await continueButton.isEnabled(), true, "Continue is disabled after audio interruption");
        await continueButton.click();
        await continueButton.waitFor({ state: "hidden" });
        await waitForRunning(page, "Continue after audio interruption");
        const replacement = await stats(page);
        assert.equal(replacement.count, before.count + 1, "Continue after interruption did not create exactly one fresh AudioContext");

        assert.equal(await page.evaluate((index) => globalThis.__cutoverAudioInterruption.dispatchStateChange(index), staleIndex), true);
        await page.waitForTimeout(50);
        await waitForRunning(page, "retired AudioContext statechange");
        assert.equal((await stats(page)).count, replacement.count, "retired AudioContext statechange affected replacement playback");
    }

    assert.deepEqual(errors, [], "audio-interruption qualification produced uncaught browser errors");
    console.log("Audio-interruption qualification passed: current interruption exits; retired statechange cannot affect replacement.");
    await context.close();
} finally {
    if (browser !== null) {
        await browser.close();
    }
    await new Promise((resolveClose) => server.close(resolveClose));
}

async function waitForLiveMenu(page, label) {
    await page.locator(continueSelector).first().waitFor({ state: "visible" });
    assert.equal(await page.locator("canvas").count(), 1, `${label}: expected retained game canvas`);
    assert.equal(await page.locator(menuButtonSelector).count(), 0, `${label}: gameplay control remained active`);
}

async function waitForRunning(page, label) {
    await page.locator("canvas").waitFor({ state: "visible" });
    await page.locator(menuButtonSelector).first().waitFor({ state: "visible" });
    assert.equal(await page.locator("canvas").count(), 1, `${label}: expected exactly one canvas`);
    assert.equal(await page.locator(menuButtonSelector).count(), 1, `${label}: expected exactly one active gameplay control`);
}

async function stats(page) {
    return page.evaluate(() => globalThis.__cutoverAudioInterruption?.stats() ?? { instrumented: false, count: 0, states: [] });
}
