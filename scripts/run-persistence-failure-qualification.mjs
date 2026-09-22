import assert from "node:assert/strict";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";
const GAME = "pac";
const root = resolve(process.env.PWA_ROOT ?? "dist/pwa");
assert(existsSync(resolve(root, "index.html")), `Missing built PWA: ${root}`);
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
    ".xml": "application/xml",
    ".dat": "application/octet-stream"
};
const server = createServer((req, res) => {
    try {
        const url = new URL(req.url, "http://localhost");
        const file = resolve(root, "." + decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
        if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
            res.writeHead(404).end();
            return;
        }
        res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
        createReadStream(file).pipe(res);
    } catch {
        res.writeHead(400).end();
    }
});
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const url = `http://127.0.0.1:${server.address().port}/`;
const encoded = encodeURIComponent(new URL(".", url).pathname);
const key = GAME === "jackal" ? `jackal.game-state:${encoded}` : `${GAME === "stickvania" ? "stickvania" : "ms-pac-man-2010"}:${encoded}:game-state`;
const newSelector = "#new-game-button, #newGameButton";
const continueSelector = "#continue-button, #continueButton";
const menuSelector = '#hamburger-button:not([hidden]), #menuButton:not([hidden]), button[aria-label*="menu" i]:not([hidden])';
let browser;
try {
    browser = await chromium.launch({ headless: process.env.HEADLESS === "1", args: ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
    const context = await browser.newContext();
    context.setDefaultTimeout(60_000);
    // Qualification never sends scores or contacts production services.
    await context.route("**/*", (route) => {
        const req = route.request();
        if (new URL(req.url()).origin !== new URL(url).origin || req.method() !== "GET") return route.abort();
        return route.continue();
    });
    let page = await context.newPage();
    const errors = [];
    const attach = (page) => page.on("pageerror", (error) => errors.push(error.message));
    attach(page);
    await page.goto(url);
    await menuReady(page);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 120_000 });
    await page.reload();
    await menuReady(page);
    await disableFullscreen(page);
    await page.locator(newSelector).first().click();
    await running(page);
    await page.locator(menuSelector).first().click();
    await menuReady(page);
    const validText = await raw(page);
    assert.ok(validText, "real runtime must produce a valid current save");
    const version = JSON.parse(validText).version;
    assert.ok(Number.isInteger(version));
    const retainedCanvas = await page.locator("canvas").elementHandle();
    assert.ok(retainedCanvas);
    const badValues = [
        "",
        "{",
        "null",
        "true",
        "42",
        '"text"',
        "[]",
        "{}",
        JSON.stringify({ version: version - 1, obsolete: true }),
        JSON.stringify({ version: version + 1, future: true }),
        JSON.stringify({ version, missingFields: true }),
        "x".repeat(2_000_001)
    ];
    for (const bad of badValues) {
        await page.locator(continueSelector).first().click();
        await running(page);
        await page.evaluate(({ key, bad }) => localStorage.setItem(key, bad), { key, bad });
        await arm(page, { read: true });
        await page.locator(menuSelector).first().click();
        await menuReady(page);
        await quiet(page);
        const info = await faultInfo(page);
        assert.equal(info.get, 0, "live-menu save must not read the existing game slot");
        assert.equal(info.set, 1, "one save at this departure boundary");
        assert.equal(info.remove, 0);
        assert.equal(JSON.parse(info.raw).version, version);
        assert.equal(await page.locator(continueSelector).first().isEnabled(), true);
        assert.equal(await retainedCanvas.evaluate((canvas) => canvas.isConnected), true);
        await disarm(page);
    }
    // A failed write leaves the current live object/canvas in place and does not enqueue UI.
    await page.locator(continueSelector).first().click();
    await running(page);
    const previous = await raw(page);
    await arm(page, { write: true });
    await page.locator(menuSelector).first().click();
    await menuReady(page);
    await quiet(page);
    assert.equal((await faultInfo(page)).raw, previous);
    await page.locator(continueSelector).first().click();
    await running(page);
    assert.equal(await retainedCanvas.evaluate((canvas) => canvas.isConnected), true);
    await quiet(page);
    // Keep failure installed through pagehide, otherwise a successful final save
    // would legitimately replace `previous` and invalidate the test premise.
    await page.reload();
    await menuReady(page);
    assert.equal(await raw(page), previous);
    assert.equal(await page.locator(continueSelector).first().isEnabled(), true);
    await page.locator(continueSelector).first().click();
    await running(page);
    await page.locator(menuSelector).first().click();
    await menuReady(page);
    assert.ok(await raw(page));

    // Use a fresh menu-only lifetime for cold-read cases: seeding while a live
    // runtime exists would be overwritten legitimately by its final pagehide save.
    await page.close();
    page = await context.newPage();
    attach(page);
    await page.goto(url);
    await menuReady(page);
    for (const bad of badValues) {
        await page.evaluate(({ key, bad }) => localStorage.setItem(key, bad), { key, bad });
        await page.reload();
        await menuReady(page);
        await quiet(page);
        assert.equal(await page.locator(continueSelector).first().isEnabled(), false);
        assert.equal(await raw(page), bad, "cold inspection never rewrites or deletes rejected bytes");
    }
    // Ordinary settings failure remains in-session and does not show a banner.
    await arm(page, { writeAll: true });
    const fullscreen = page.locator("#fullscreen-switch-button").first();
    if (await fullscreen.isEnabled()) {
        const before = await fullscreen.getAttribute("aria-pressed");
        await fullscreen.click();
        assert.notEqual(await fullscreen.getAttribute("aria-pressed"), before);
    }
    await quiet(page);
    await disarm(page);
    await disableFullscreen(page);

    // Reset is an explicit operation: one result notice, no resurrected Continue,
    // and no reload of failed-to-remove values into the new runtime.
    await page.evaluate(({ key, validText }) => localStorage.setItem(key, validText), { key, validText });
    await arm(page, { remove: true });
    await page.locator("#reset-button, #resetButton").first().click();
    await menuReady(page);
    assert.equal(await page.getByText("Some settings could not be reset.", { exact: true }).count(), 1);
    assert.equal(await page.locator(continueSelector).first().isEnabled(), false);
    assert.equal((await faultInfo(page)).raw, validText);
    await disarm(page);
    await disableFullscreen(page);
    const retiredControl = await page.locator("#fullscreen-switch-button").first().elementHandle();
    await page.locator(newSelector).first().click();
    await running(page);
    // Events dispatched at a detached old menu must not write settings.
    await arm(page, {});
    if (retiredControl) await retiredControl.evaluate((el) => el.dispatchEvent(new globalThis.MouseEvent("click", { bubbles: true, cancelable: true })));
    assert.deepEqual((await faultInfo(page)).otherWrites, []);
    await disarm(page);
    await page.locator(menuSelector).first().click();
    await menuReady(page);
    await quiet(page);
    assert.equal(await page.getByText("Some settings could not be reset.", { exact: true }).count(), 0);
    assert.deepEqual(errors, [], "no uncaught browser errors from tolerant persistence");
    await context.close();
    console.log(`${GAME}: real-runtime no-read overwrite, tolerant cold loads, quota/live/reload continuation, settings and Reset contracts passed.`);
} finally {
    if (browser) await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
}
async function menuReady(page) {
    await page.locator(newSelector).first().waitFor({ state: "visible" });
    await page.bringToFront();
}
async function running(page) {
    await page.locator("canvas").waitFor({ state: "visible" });
    await page.locator(menuSelector).first().waitFor({ state: "visible" });
    assert.equal(await page.locator("canvas").count(), 1);
}
async function disableFullscreen(page) {
    const control = page.locator("#fullscreen-switch-button").first();
    if ((await control.isEnabled()) && (await control.getAttribute("aria-pressed")) === "true") await control.click();
}
async function quiet(page) {
    assert.equal(await page.getByText(/Progress could not be saved|Unable to restore the saved game|Unable to save settings in this browser/).count(), 0);
    assert.equal(await page.locator(".persistence-warning, .warning-message").count(), 0);
}
async function raw(page) {
    return page.evaluate((key) => localStorage.getItem(key), key);
}
async function arm(page, faults) {
    await page.evaluate(
        ({ key, faults }) => {
            const storage = localStorage;
            const get = Storage.prototype.getItem,
                set = Storage.prototype.setItem,
                remove = Storage.prototype.removeItem;
            const state = {
                get: 0,
                set: 0,
                remove: 0,
                otherWrites: [],
                raw: () => get.call(storage, key),
                restore() {
                    Storage.prototype.getItem = get;
                    Storage.prototype.setItem = set;
                    Storage.prototype.removeItem = remove;
                }
            };
            globalThis.__persistenceFault = state;
            Storage.prototype.getItem = function (k) {
                if (this === storage && k === key) {
                    state.get++;
                    if (faults.read) throw new DOMException("Injected read denial", "SecurityError");
                }
                return get.call(this, k);
            };
            Storage.prototype.setItem = function (k, v) {
                if (this === storage) {
                    if (k === key) state.set++;
                    else state.otherWrites.push(k);
                    if (faults.writeAll || (k === key && faults.write)) throw new DOMException("Injected quota failure", "QuotaExceededError");
                }
                return set.call(this, k, v);
            };
            Storage.prototype.removeItem = function (k) {
                if (this === storage && k === key) {
                    state.remove++;
                    if (faults.remove) throw new DOMException("Injected removal failure", "SecurityError");
                }
                return remove.call(this, k);
            };
        },
        { key, faults }
    );
}
async function faultInfo(page) {
    return page.evaluate(() => {
        const s = globalThis.__persistenceFault;
        return { get: s.get, set: s.set, remove: s.remove, otherWrites: s.otherWrites, raw: s.raw() };
    });
}
async function disarm(page) {
    await page.evaluate(() => {
        globalThis.__persistenceFault?.restore();
        delete globalThis.__persistenceFault;
    });
}
