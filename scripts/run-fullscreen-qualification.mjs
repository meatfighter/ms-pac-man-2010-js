/* global document, window, HTMLElement */
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
    await qualifySupportedTouchFullscreenAndContinue(browser, url);
    await qualifyDelayedVoidFullscreen(browser, url);
    await qualifyDesktopFullscreenExit(browser, url);
    await qualifyPreferenceOffAndReset(browser, url);
    await qualifyRejectedFullscreen(browser, url);
    await qualifyExplicitUnavailableFullscreen(browser, url);
    await qualifyMissingFullscreenMethod(browser, url);
    await qualifyUnknownFullscreenCapability(browser, url);
    await qualifyPendingColdStartDeparture(browser, url);
    await qualifyPendingRetainedContinueDeparture(browser, url);
    await qualifyHangingExitRequiresActualFullscreenExit(browser, url);
    console.log(
        "Ms. Pac-Man fullscreen qualification passed: entry/Continue, exit, persistence, rejected/unavailable/missing/unknown fallback, stale request fencing, and actual-state exit barriers are correct."
    );
} finally {
    if (browser !== null) {
        await browser.close();
    }
    await new Promise((resolveClose) => server.close(resolveClose));
}

async function qualifySupportedTouchFullscreenAndContinue(browser, url) {
    const { context, errors, page } = await createHarnessPage(browser, url, "success", true);
    try {
        const fullscreenSwitch = await waitForMenu(page);
        assert.equal(await fullscreenSwitch.isEnabled(), true);
        assert.equal(await fullscreenSwitch.getAttribute("aria-pressed"), "true");
        await page.locator("#newGameButton").click();
        await waitForFullscreenRunning(page, true);
        const originalCanvas = await page.locator("canvas").elementHandle();
        assert.ok(originalCanvas, "missing initial game canvas");
        assert.equal(await page.evaluate(() => document.fullscreenElement?.id), "game-shell");
        assert.equal(await page.locator("#game-shell .menu-screen").count(), 0, "PWA menu is inside the fullscreen shell");
        await page.locator("#menuButton").click();
        await waitForLiveMenu(page);
        assert.equal(await fullscreenSwitchState(page), "true");
        await page.locator("#continueButton").click();
        await waitForFullscreenRunning(page, true);
        assert.equal(await originalCanvas.evaluate((canvas) => canvas.isConnected), true, "Continue replaced the retained canvas");
        assert.equal(await page.evaluate(() => globalThis.__fullscreenHarness.requestCount()), 2);
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
}

async function qualifyDelayedVoidFullscreen(browser, url) {
    const { context, errors, page } = await createHarnessPage(browser, url, "delayed-void", true);
    try {
        await waitForMenu(page);
        await page.locator("#newGameButton").click();
        await waitForFullscreenRunning(page, true);
        assert.equal(await page.evaluate(() => globalThis.__fullscreenHarness.requestCount()), 1);
        assert.equal(await fullscreenSwitchStateFromStorage(page), null);
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
}

async function qualifyDesktopFullscreenExit(browser, url) {
    const { context, errors, page } = await createHarnessPage(browser, url, "success", false);
    try {
        await waitForMenu(page);
        await page.locator("#newGameButton").click();
        await waitForFullscreenRunning(page, false);
        assert.equal(await page.locator("#menuButton").isHidden(), true);
        await page.evaluate(() => globalThis.__fullscreenHarness.forceExit());
        await page.locator("#continueButton").waitFor({ state: "visible" });
        await page.waitForFunction(() => document.fullscreenElement === null);
        assert.equal(await fullscreenSwitchState(page), "true");
        assert.equal(await page.locator("canvas").count(), 1);
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
}

async function qualifyPreferenceOffAndReset(browser, url) {
    const { context, errors, page } = await createHarnessPage(browser, url, "success", false);
    try {
        let fullscreenSwitch = await waitForMenu(page);
        await fullscreenSwitch.click();
        assert.equal(await fullscreenSwitchState(page), "false");
        await page.reload();
        fullscreenSwitch = await waitForMenu(page);
        assert.equal(await fullscreenSwitchState(page), "false", "Fullscreen OFF did not persist");
        await page.locator("#resetButton").click();
        fullscreenSwitch = await waitForMenu(page);
        assert.equal(await fullscreenSwitchState(page), "true", "Reset did not restore Fullscreen ON");
        await fullscreenSwitch.click();
        await page.locator("#newGameButton").click();
        await waitForWindowedRunning(page);
        assert.equal(await page.evaluate(() => globalThis.__fullscreenHarness.requestCount()), 0);
        await page.keyboard.press("Escape");
        await page.locator("#continueButton").waitFor({ state: "visible" });
        assert.equal(await fullscreenSwitchState(page), "false");
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
}

async function qualifyRejectedFullscreen(browser, url) {
    const { context, errors, page } = await createHarnessPage(browser, url, "reject", false);
    try {
        const fullscreenSwitch = await waitForMenu(page);
        assert.equal(await fullscreenSwitch.isEnabled(), true);
        await page.locator("#newGameButton").click();
        await waitForWindowedRunning(page);
        assert.equal(await page.evaluate(() => globalThis.__fullscreenHarness.requestCount()), 1);
        assert.equal(await page.evaluate(() => document.fullscreenElement), null);
        await page.locator("#menuButton").click();
        await page.locator("#continueButton").waitFor({ state: "visible" });
        assert.equal(await fullscreenSwitchState(page), "true");
        assert.equal(await page.locator(".error-text").count(), 0);
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
}

async function qualifyExplicitUnavailableFullscreen(browser, url) {
    const { context, errors, page } = await createHarnessPage(browser, url, "unavailable", false);
    try {
        const fullscreenSwitch = await waitForMenu(page);
        assert.equal(await fullscreenSwitch.isEnabled(), false);
        assert.equal(await fullscreenSwitch.getAttribute("aria-pressed"), "false");
        assert.equal(await fullscreenSwitch.getAttribute("data-enabled"), "false");
        assert.equal(await fullscreenSwitchStateFromStorage(page), null, "unavailable UI rewrote the stored default preference");
        await page.locator("#newGameButton").click();
        await waitForWindowedRunning(page);
        assert.equal(await page.evaluate(() => globalThis.__fullscreenHarness.requestCount()), 0);
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
}

async function qualifyMissingFullscreenMethod(browser, url) {
    const { context, errors, page } = await createHarnessPage(browser, url, "missing", false);
    try {
        const fullscreenSwitch = await waitForMenu(page);
        assert.equal(await fullscreenSwitch.isEnabled(), false);
        assert.equal(await fullscreenSwitch.getAttribute("aria-pressed"), "false");
        assert.equal(await fullscreenSwitch.getAttribute("data-enabled"), "false");
        await page.locator("#newGameButton").click();
        await waitForWindowedRunning(page);
        assert.equal(await page.evaluate(() => globalThis.__fullscreenHarness.requestCount()), 0);
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
}

async function qualifyUnknownFullscreenCapability(browser, url) {
    const { context, errors, page } = await createHarnessPage(browser, url, "unknown", false);
    try {
        const fullscreenSwitch = await waitForMenu(page);
        assert.equal(await fullscreenSwitch.isEnabled(), true);
        assert.equal(await fullscreenSwitch.getAttribute("aria-pressed"), "true");
        await page.locator("#newGameButton").click();
        await waitForWindowedRunning(page);
        assert.equal(await page.evaluate(() => globalThis.__fullscreenHarness.requestCount()), 1);
        assert.equal(await fullscreenSwitchStateFromStorage(page), null);
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
}

async function qualifyPendingColdStartDeparture(browser, url) {
    const { context, errors, page } = await createHarnessPage(browser, url, "pending-blur", false);
    try {
        await waitForMenu(page);
        await page.locator("#newGameButton").click({ noWaitAfter: true });
        await page.waitForFunction(() => globalThis.__fullscreenHarness.requestCount() === 1);
        await page.locator("#newGameButton").waitFor({ state: "visible" });
        assert.equal(await page.locator("canvas").count(), 0);
        assert.equal(await page.evaluate(() => document.fullscreenElement), null);
        await page.evaluate(() => globalThis.__fullscreenHarness.resolvePending());
        await page.waitForFunction(() => document.fullscreenElement === null && document.querySelector("#app")?.style.visibility !== "hidden");
        await page.locator("#newGameButton").waitFor({ state: "visible" });
        assert.equal(await page.locator("canvas").count(), 0);
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
}

async function qualifyPendingRetainedContinueDeparture(browser, url) {
    const { context, errors, page } = await createHarnessPage(browser, url, "success", true);
    try {
        await waitForMenu(page);
        await page.locator("#newGameButton").click();
        await waitForFullscreenRunning(page, true);
        const retainedCanvas = await page.locator("canvas").elementHandle();
        assert.ok(retainedCanvas);
        await page.locator("#menuButton").click();
        await waitForLiveMenu(page);
        await page.evaluate(() => globalThis.__fullscreenHarness.setMode("pending"));
        await page.locator("#continueButton").click({ noWaitAfter: true });
        await page.waitForFunction(() => globalThis.__fullscreenHarness.requestCount() === 2);
        await page.evaluate(() => window.dispatchEvent(new Event("blur")));
        await page.evaluate(() => globalThis.__fullscreenHarness.resolvePending());
        await page.locator("#continueButton").waitFor({ state: "visible" });
        await page.waitForFunction(() => document.fullscreenElement === null);
        assert.equal(await retainedCanvas.evaluate((canvas) => canvas.isConnected), true);
        assert.equal(await page.locator("canvas").count(), 1);
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
}

async function qualifyHangingExitRequiresActualFullscreenExit(browser, url) {
    const { context, errors, page } = await createHarnessPage(browser, url, "success", true);
    try {
        await waitForMenu(page);
        await page.locator("#newGameButton").click();
        await waitForFullscreenRunning(page, true);
        await page.evaluate(() => globalThis.__fullscreenHarness.setExitMode("pending"));
        await page.locator("#menuButton").click({ noWaitAfter: true });
        await page.waitForTimeout(150);
        assert.equal(await page.evaluate(() => document.fullscreenElement?.id), "game-shell");
        assert.equal(await page.locator("#continueButton").count(), 0, "menu appeared before actual fullscreen exit");
        await page.evaluate(() => globalThis.__fullscreenHarness.forceExit());
        await waitForLiveMenu(page);
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
}

async function createHarnessPage(browser, url, mode, touch) {
    const context = await browser.newContext();
    context.setDefaultTimeout(60_000);
    await installFullscreenHarness(context, mode, touch);
    const errors = [];
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    return { context, errors, page };
}

async function waitForMenu(page) {
    const fullscreenSwitch = page.locator("#fullscreen-switch-button").first();
    await fullscreenSwitch.waitFor({ state: "visible" });
    await page.locator("#newGameButton").waitFor({ state: "visible" });
    return fullscreenSwitch;
}

async function waitForLiveMenu(page) {
    await page.locator("#continueButton").waitFor({ state: "visible" });
    await page.waitForFunction(() => document.fullscreenElement === null);
    assert.equal(await page.locator("canvas").count(), 1);
}

async function waitForFullscreenRunning(page, expectHamburger) {
    await page.locator("canvas").waitFor({ state: "visible" });
    await page.waitForFunction(() => document.fullscreenElement?.id === "game-shell");
    if (expectHamburger) {
        await page.locator("#menuButton:not([hidden])").waitFor({ state: "visible" });
    } else {
        await page.waitForFunction(() => document.querySelector("#menuButton")?.hidden === true);
    }
}

async function waitForWindowedRunning(page) {
    await page.locator("canvas").waitFor({ state: "visible" });
    await page.locator("#menuButton:not([hidden])").waitFor({ state: "visible" });
    assert.equal(await page.evaluate(() => document.fullscreenElement), null);
}

async function fullscreenSwitchState(page) {
    return page.locator("#fullscreen-switch-button").first().getAttribute("aria-pressed");
}

async function fullscreenSwitchStateFromStorage(page) {
    return page.evaluate(() => {
        const entry = Object.entries(localStorage).find(([key]) => key.endsWith(":fullscreen"));
        return entry?.[1] ?? null;
    });
}

async function installFullscreenHarness(context, initialMode, touch) {
    await context.addInitScript(
        ({ initialMode, touch }) => {
            let mode = initialMode;
            let exitMode = "success";
            let fullscreenElement = null;
            const setSyntheticFullscreenElement = (element) => {
                fullscreenElement = element;
            };
            let requestCount = 0;
            let pendingResolve = null;
            Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: touch ? 1 : 0 });
            Object.defineProperty(document, "fullscreenEnabled", {
                configurable: true,
                get: () => (mode === "missing" || mode === "unknown" ? undefined : mode !== "unavailable")
            });
            Object.defineProperty(document, "webkitFullscreenEnabled", {
                configurable: true,
                get: () => (mode === "missing" || mode === "unknown" ? undefined : mode !== "unavailable")
            });
            Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreenElement });
            Object.defineProperty(document, "exitFullscreen", {
                configurable: true,
                value: () => {
                    if (exitMode === "pending") {
                        return new Promise(() => undefined);
                    }
                    if (fullscreenElement !== null) {
                        fullscreenElement = null;
                        document.dispatchEvent(new Event("fullscreenchange"));
                    }
                    return Promise.resolve();
                }
            });
            Object.defineProperty(HTMLElement.prototype, "webkitRequestFullscreen", { configurable: true, value: undefined });
            Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
                configurable: true,
                value: function () {
                    requestCount++;
                    if (mode === "unknown" || mode === "reject") {
                        return Promise.reject(new DOMException("Synthetic fullscreen denial", "NotAllowedError"));
                    }
                    if (mode === "pending" || mode === "pending-blur") {
                        if (mode === "pending-blur") {
                            window.dispatchEvent(new Event("blur"));
                        }
                        return new Promise((resolvePending) => {
                            pendingResolve = () => {
                                setSyntheticFullscreenElement(this);
                                document.dispatchEvent(new Event("fullscreenchange"));
                                resolvePending();
                                pendingResolve = null;
                            };
                        });
                    }
                    if (mode === "delayed-void") {
                        window.setTimeout(() => {
                            setSyntheticFullscreenElement(this);
                            document.dispatchEvent(new Event("fullscreenchange"));
                        }, 25);
                        return undefined;
                    }
                    setSyntheticFullscreenElement(this);
                    document.dispatchEvent(new Event("fullscreenchange"));
                    return Promise.resolve();
                }
            });
            if (initialMode === "missing") {
                Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { configurable: true, value: undefined });
            }
            Object.defineProperty(globalThis, "__fullscreenHarness", {
                configurable: true,
                value: {
                    requestCount: () => requestCount,
                    resolvePending: () => pendingResolve?.(),
                    setMode: (nextMode) => {
                        mode = nextMode;
                    },
                    setExitMode: (nextMode) => {
                        exitMode = nextMode;
                    },
                    forceExit: () => {
                        if (fullscreenElement !== null) {
                            fullscreenElement = null;
                            document.dispatchEvent(new Event("fullscreenchange"));
                        }
                    }
                }
            });
        },
        { initialMode, touch }
    );
}
