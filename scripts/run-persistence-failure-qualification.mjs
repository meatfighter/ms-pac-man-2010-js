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
const warningText = "Progress could not be saved. Continue still preserves this live game.";

let browser = null;
try {
    browser = await chromium.launch({ headless: false, args: ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
    const context = await browser.newContext();
    context.setDefaultTimeout(60_000);
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
    const originalCanvas = await page.locator("canvas").elementHandle();
    assert.ok(originalCanvas, "missing initial game canvas");

    await page.evaluate(() => {
        const original = Storage.prototype.setItem;
        Object.defineProperty(globalThis, "__cutoverRestoreStorage", {
            configurable: true,
            value: () => {
                Storage.prototype.setItem = original;
            }
        });
        Storage.prototype.setItem = function () {
            throw new DOMException("Synthetic quota exhaustion", "QuotaExceededError");
        };
    });

    const menu = page.locator(menuButtonSelector).first();
    await menu.click();
    const continueButton = page.locator(continueSelector).first();
    await continueButton.waitFor({ state: "visible" });
    await page.getByText(warningText, { exact: true }).waitFor({ state: "visible" });
    assert.equal(await continueButton.isEnabled(), true, "recoverable save failure disabled live Continue");
    assert.equal(await page.locator("canvas").count(), 1, "recoverable save failure destroyed the retained game canvas");
    assert.equal(await originalCanvas.evaluate((canvas) => canvas.isConnected), true, "recoverable save failure replaced the retained game canvas");

    await continueButton.click();
    await continueButton.waitFor({ state: "hidden" });
    await waitForRunning(page, "Continue after quota failure");
    assert.equal(await originalCanvas.evaluate((canvas) => canvas.isConnected), true, "live Continue after save failure did not retain the same game canvas");

    await page.evaluate(() => globalThis.__cutoverRestoreStorage?.());
    assert.deepEqual(errors, [], "persistence-failure qualification produced uncaught browser errors");
    console.log("Persistence-failure qualification passed: quota failure warns without poisoning resource safety or destroying the retained live game.");
    await context.close();
} finally {
    if (browser !== null) {
        await browser.close();
    }
    await new Promise((resolveClose) => server.close(resolveClose));
}

async function waitForRunning(page, label) {
    await page.locator("canvas").waitFor({ state: "visible" });
    await page.locator(menuButtonSelector).first().waitFor({ state: "visible" });
    assert.equal(await page.locator("canvas").count(), 1, `${label}: expected exactly one game canvas`);
    assert.equal(await page.locator(menuButtonSelector).count(), 1, `${label}: expected exactly one active gameplay control`);
}
