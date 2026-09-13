/* global document, HTMLElement */
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
    const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
    context.setDefaultTimeout(120_000);
    await installFullscreenAndWakeLockHarness(context);

    const errors = [];
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);

    await waitForMenu(page);
    await verifyResponsiveSettingsRow(page);
    await selectScaling(page, "pixel-perfect", "Pixel Perfect");
    await assertWakeAccounting(page, 0, "initial menu");

    await page.locator("#newGameButton").click();
    await waitForFullscreenRunning(page);
    const retainedCanvas = await page.locator("canvas").elementHandle();
    assert.ok(retainedCanvas, "missing initial game canvas");
    await assertWakeAccounting(page, 1, "New Game fullscreen");

    await page.locator("#menuButton").click();
    await waitForLiveMenu(page);
    await assertScaling(page, "pixel-perfect", "Pixel Perfect");
    await assertWakeAccounting(page, 0, "first live menu");

    await selectScaling(page, "smooth", "Smooth");
    await page.locator("#continueButton").click();
    await waitForFullscreenRunning(page);
    assert.equal(await retainedCanvas.evaluate((canvas) => canvas.isConnected), true, "retained Continue replaced the game canvas");
    await assertWakeAccounting(page, 1, "retained Continue fullscreen");

    await page.locator("#menuButton").click();
    await waitForLiveMenu(page);
    await assertScaling(page, "smooth", "Smooth");
    await assertWakeAccounting(page, 0, "second live menu");

    assert.equal(
        await page.evaluate(() => globalThis.__msPacManSettingsHarness.requestCount()),
        2,
        "New Game + retained Continue should make exactly two fullscreen requests"
    );
    assert.deepEqual(errors, [], "Ms. Pac-Man fullscreen settings qualification produced uncaught browser errors");
    console.log(
        "Ms. Pac-Man fullscreen settings qualification passed: responsive Fullscreen/Scaling layout, Scaling persistence/application, retained canvas, and wake-lock accounting survive fullscreen MENU/Continue cycles."
    );
    await context.close();
} finally {
    if (browser !== null) {
        await browser.close();
    }
    await new Promise((resolveClose) => server.close(resolveClose));
}

async function waitForMenu(page) {
    await page.locator("#newGameButton").waitFor({ state: "visible" });
    await page.locator("#fullscreen-switch-button").waitFor({ state: "visible" });
    await page.locator("#scaling-button").waitFor({ state: "visible" });
}

async function verifyResponsiveSettingsRow(page) {
    const fullscreenRow = page.locator(".setting-fullscreen-row").first();
    const scalingRow = page.locator(".setting-scaling-row").first();
    const scalingPicker = page.locator("#scaling-picker").first();
    const settingsRow = page.locator(".settings-fullscreen-scaling-row").first();
    await settingsRow.waitFor({ state: "visible" });

    const wide = await readSettingsGeometry(fullscreenRow, scalingRow, scalingPicker);
    assert.ok(
        Math.abs(wide.fullscreen.y + wide.fullscreen.height / 2 - (wide.scaling.y + wide.scaling.height / 2)) <= 1,
        "Fullscreen and Scaling should share a row when the menu is wide enough"
    );

    await page.setViewportSize({ width: 360, height: 640 });
    await page.waitForTimeout(50);
    const narrow = await readSettingsGeometry(fullscreenRow, scalingRow, scalingPicker);
    assert.ok(
        narrow.scaling.y >= narrow.fullscreen.y + narrow.fullscreen.height + 1,
        "Fullscreen and Scaling should wrap onto separate rows when they do not fit"
    );
    assert.ok(Math.abs(narrow.picker.width - wide.picker.width) <= 1, "Scaling picker should not be compressed when the settings row wraps");
    const viewport = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth
    }));
    assert.ok(viewport.scrollWidth <= viewport.clientWidth + 1, "responsive settings row causes horizontal page overflow");

    await page.setViewportSize({ width: 800, height: 600 });
    await page.waitForTimeout(50);
}

async function readSettingsGeometry(fullscreenRow, scalingRow, scalingPicker) {
    const fullscreen = await fullscreenRow.boundingBox();
    const scaling = await scalingRow.boundingBox();
    const picker = await scalingPicker.boundingBox();
    assert.ok(fullscreen !== null, "Fullscreen row must have layout geometry");
    assert.ok(scaling !== null, "Scaling row must have layout geometry");
    assert.ok(picker !== null, "Scaling picker must have layout geometry");
    return { fullscreen, scaling, picker };
}

async function selectScaling(page, value, label) {
    await page.locator("#scaling-button").click();
    const option = page.locator(`[data-scaling-mode="${value}"]`).first();
    await option.waitFor({ state: "visible" });
    await option.click();
    await assertScaling(page, value, label);
}

async function assertScaling(page, value, label) {
    assert.equal(await page.locator("#scaling-button .scaling-picker-label").textContent(), label, `Scaling label should remain ${label}`);
    assert.equal(await page.locator(`[data-scaling-mode="${value}"]`).getAttribute("aria-selected"), "true", `Scaling ${value} should remain selected`);
    assert.equal(await storedPreference(page, "scaling"), value, `Stored Scaling should remain ${value}`);
}

async function storedPreference(page, keyFragment) {
    return page.evaluate((fragment) => Object.entries(localStorage).find(([key]) => key.includes(fragment))?.[1] ?? null, keyFragment);
}

async function waitForFullscreenRunning(page) {
    await page.locator("canvas").waitFor({ state: "visible" });
    await page.waitForFunction(() => document.fullscreenElement?.id === "game-shell");
    await page.locator("#menuButton:not([hidden])").waitFor({ state: "visible" });
}

async function waitForLiveMenu(page) {
    await page.locator("#continueButton").waitFor({ state: "visible" });
    await page.waitForFunction(() => document.fullscreenElement === null);
    assert.equal(await page.locator("canvas").count(), 1, "live menu should retain exactly one canvas");
}

async function assertWakeAccounting(page, expectedLive, label) {
    await page.waitForFunction((expected) => globalThis.__msPacManSettingsHarness?.wakeStats().live === expected, expectedLive, { timeout: 5_000 });
    const stats = await page.evaluate(() => globalThis.__msPacManSettingsHarness.wakeStats());
    assert.equal(stats.live, expectedLive, `${label}: unexpected live wake-lock count`);
    assert.equal(stats.acquired - stats.released, stats.live, `${label}: wake-lock acquisitions/releases are not balanced`);
    assert.ok(stats.released <= stats.acquired, `${label}: wake-lock release count exceeded acquisitions`);
}

async function installFullscreenAndWakeLockHarness(context) {
    await context.addInitScript(() => {
        let fullscreenElement = null;
        const setSyntheticFullscreenElement = (element) => {
            fullscreenElement = element;
        };
        let fullscreenRequests = 0;
        let wakeAcquired = 0;
        let wakeReleased = 0;
        const wakeLive = new Set();

        class SyntheticWakeLockSentinel extends EventTarget {
            released = false;

            async release() {
                if (this.released) {
                    return;
                }
                this.released = true;
                if (wakeLive.delete(this)) {
                    wakeReleased++;
                }
                this.dispatchEvent(new Event("release"));
            }
        }

        Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 1 });
        Object.defineProperty(navigator, "wakeLock", {
            configurable: true,
            value: {
                request: async (type) => {
                    if (type !== "screen") {
                        throw new TypeError(`Unexpected wake-lock type: ${String(type)}`);
                    }
                    const sentinel = new SyntheticWakeLockSentinel();
                    wakeAcquired++;
                    wakeLive.add(sentinel);
                    return sentinel;
                }
            }
        });
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
                fullscreenRequests++;
                setSyntheticFullscreenElement(this);
                document.dispatchEvent(new Event("fullscreenchange"));
                return Promise.resolve();
            }
        });
        Object.defineProperty(globalThis, "__msPacManSettingsHarness", {
            configurable: true,
            value: {
                requestCount: () => fullscreenRequests,
                wakeStats: () => ({ acquired: wakeAcquired, released: wakeReleased, live: wakeLive.size })
            }
        });
    });
}
