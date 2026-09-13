/* global document, navigator, window, HTMLElement */
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

let browser = null;
try {
    browser = await chromium.launch({ headless: false, args: ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
    const context = await browser.newContext();
    context.setDefaultTimeout(60_000);
    await installReentrantFullscreenHarness(context);
    const errors = [];
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);

    await page.locator("#fullscreen-switch-button").waitFor({ state: "visible" });
    await page.locator("#newGameButton").click();
    await page.waitForFunction(() => document.fullscreenElement?.id === "game-shell");
    const retainedCanvas = await page.locator("canvas").elementHandle();
    assert.ok(retainedCanvas);
    await page.evaluate(() => document.exitFullscreen());
    await page.locator("#continueButton").waitFor({ state: "visible" });

    await page.evaluate(() => globalThis.__reentrantFullscreenHarness.setMode("blur-pending"));
    await page.locator("#continueButton").click({ noWaitAfter: true });
    await page.waitForFunction(() => globalThis.__reentrantFullscreenHarness.requestCount() === 2);
    await page.locator("#continueButton").waitFor({ state: "visible" });
    assert.equal(await page.locator("canvas").count(), 1);
    assert.equal(await page.evaluate(() => document.fullscreenElement), null);

    await page.locator("#continueButton").click();
    await waitForWindowedRunning(page);
    assert.equal(await page.evaluate(() => globalThis.__reentrantFullscreenHarness.requestCount()), 2, "reentry stacked another native request");
    assert.equal(await retainedCanvas.evaluate((canvas) => canvas.isConnected), true);

    await page.evaluate(() => globalThis.__reentrantFullscreenHarness.resolvePending());
    await page.waitForFunction(() => document.fullscreenElement === null && document.querySelector("#app")?.style.visibility !== "hidden", undefined, {
        timeout: 5_000
    });
    await waitForWindowedRunning(page);
    assert.equal(await page.locator("#continueButton").count(), 0, "late reentrant success returned gameplay to MENU");

    await page.locator("#menuButton").click();
    await page.locator("#continueButton").waitFor({ state: "visible" });
    await page.evaluate(() => globalThis.__reentrantFullscreenHarness.setMode("success"));
    await page.locator("#continueButton").click();
    await page.waitForFunction(() => document.fullscreenElement?.id === "game-shell");
    assert.equal(await page.evaluate(() => globalThis.__reentrantFullscreenHarness.requestCount()), 3);
    assert.equal(await retainedCanvas.evaluate((canvas) => canvas.isConnected), true);
    assert.deepEqual(errors, []);
    console.log("Ms. Pac-Man synchronous fullscreen reentry qualification passed.");
    await context.close();
} finally {
    if (browser !== null) {
        await browser.close();
    }
    await new Promise((resolveClose) => server.close(resolveClose));
}

async function waitForWindowedRunning(page) {
    await page.locator("canvas").waitFor({ state: "visible" });
    await page.locator("#menuButton:not([hidden])").waitFor({ state: "visible" });
    assert.equal(await page.evaluate(() => document.fullscreenElement), null);
}

async function installReentrantFullscreenHarness(context) {
    await context.addInitScript(() => {
        let mode = "success";
        let fullscreenElement = null;
        let requestCount = 0;
        let pendingResolve = null;
        Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 0 });
        Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
        Object.defineProperty(document, "webkitFullscreenEnabled", { configurable: true, value: true });
        Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreenElement });
        Object.defineProperty(document, "exitFullscreen", {
            configurable: true,
            value: async () => {
                if (fullscreenElement !== null) {
                    fullscreenElement = null;
                    document.dispatchEvent(new Event("fullscreenchange"));
                }
            }
        });
        Object.defineProperty(HTMLElement.prototype, "webkitRequestFullscreen", { configurable: true, value: undefined });
        Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
            configurable: true,
            value: function () {
                requestCount++;
                if (mode === "blur-pending") {
                    window.dispatchEvent(new Event("blur"));
                    return new Promise((resolvePending) => {
                        pendingResolve = () => {
                            fullscreenElement = this;
                            document.dispatchEvent(new Event("fullscreenchange"));
                            resolvePending();
                            pendingResolve = null;
                        };
                    });
                }
                fullscreenElement = this;
                document.dispatchEvent(new Event("fullscreenchange"));
                return Promise.resolve();
            }
        });
        Object.defineProperty(globalThis, "__reentrantFullscreenHarness", {
            configurable: true,
            value: {
                requestCount: () => requestCount,
                resolvePending: () => pendingResolve?.(),
                setMode: (nextMode) => {
                    mode = nextMode;
                }
            }
        });
    });
}
