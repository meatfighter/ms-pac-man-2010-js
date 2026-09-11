/* global window, document */
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
    const errors = [];

    const first = await context.newPage();
    first.on("pageerror", (error) => errors.push(`first tab: ${error.message}`));
    await first.goto(url);
    await first.locator(newGameSelector).first().waitFor({ state: "visible" });
    await first.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 120_000 });
    await first.reload();
    await first.locator(newGameSelector).first().waitFor({ state: "visible" });
    await first.locator(newGameSelector).first().click();
    await waitForRunning(first, "first tab initial game");

    const second = await context.newPage();
    second.on("pageerror", (error) => errors.push(`second tab: ${error.message}`));
    await second.goto(url);
    const continueHere = second.getByRole("button", { name: "Continue Here" });
    await continueHere.waitFor({ state: "visible" });
    assert.equal(await second.locator("canvas").count(), 0, "second tab started gameplay without writer ownership");

    // The takeover request must cause the old tab's synchronous relinquish callback to save
    // and fully dispose before the native writer lock is transferred.
    await continueHere.click();
    const coldContinue = second.locator(continueSelector).first();
    await coldContinue.waitFor({ state: "visible" });
    assert.equal(await coldContinue.isEnabled(), true, "second tab did not receive the final saved game from the first owner");
    assert.equal(await second.locator("canvas").count(), 0, "second tab resumed gameplay automatically after ownership transfer");

    await first.waitForFunction(() => document.querySelectorAll("canvas").length === 0);
    assert.equal(await first.locator(menuButtonSelector).count(), 0, "first tab retained active gameplay controls after ownership transfer");
    await first.locator(".session-ownership-message").waitFor({ state: "visible" });

    // Explicit cold Continue in the new owner is the only path back to RUNNING.
    await coldContinue.click();
    await coldContinue.waitFor({ state: "hidden" });
    await waitForRunning(second, "second tab after takeover Continue");

    // A stale wake signal in the old tab may retry acquisition, but it cannot steal the held lock
    // or restart its disposed game while the new owner is running.
    await first.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    await first.waitForTimeout(100);
    assert.equal(await first.locator("canvas").count(), 0, "old tab restarted gameplay after stale pageshow");
    await waitForRunning(second, "second tab after stale first-tab pageshow");

    assert.deepEqual(errors, [], "ownership-transfer qualification produced uncaught browser errors");
    console.log(
        "Ownership-transfer qualification passed: final save/disposal precedes lock transfer, new owner cold-continues explicitly, stale old-tab wake cannot reclaim gameplay."
    );
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
    assert.equal(await page.locator("canvas").count(), 1, `${label}: expected exactly one current canvas`);
    assert.equal(await page.locator(menuButtonSelector).count(), 1, `${label}: expected exactly one active gameplay control`);
}
