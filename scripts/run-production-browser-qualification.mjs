/* global window, document, caches */
import assert from "node:assert/strict";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { chromium, firefox, webkit } from "playwright";

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
let generation = "A";
let originUnavailable = false;
const workerSource = readFileSync(resolve(root, "sw.js"), "utf8");
// Exercise two real cache generations of this candidate with identical game assets.
// This deliberately changes the worker's cache identity, not the saved-game schema.
const versionMatch = workerSource.match(/const (VERSION|BUILD_STAMP) = ("[^"]*"|'[^']*');/);
assert(versionMatch !== null, "Could not locate the production worker cache version");
const originalVersion = versionMatch[2].slice(1, -1);
function qualifyText(source) {
    const version = originalVersion + "-qualification-" + generation;
    const encoded = encodeURIComponent(originalVersion);
    const text = source.replaceAll(encoded, encodeURIComponent(version));
    return encoded === originalVersion ? text : text.replaceAll(originalVersion, version);
}

const server = createServer((request, response) => {
    if (originUnavailable) {
        request.socket.destroy();
        return;
    }
    const url = new URL(request.url, "http://localhost");
    const path = resolve(root, "." + decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
    if (!path.startsWith(root + sep) || !existsSync(path) || !statSync(path).isFile()) {
        response.writeHead(404).end();
        return;
    }
    response.writeHead(200, { "Content-Type": mime[extname(path)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    if ([".html", ".js", ".css", ".json", ".webmanifest"].includes(extname(path))) {
        response.end(qualifyText(readFileSync(path, "utf8")));
    } else {
        createReadStream(path).pipe(response);
    }
});
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const url = `http://127.0.0.1:${server.address().port}/`;
const newGame = "#new-game-button, #newGameButton";
const continueGame = "#continue-button, #continueButton";
const prepared = (page) => page.waitForFunction(() => window.__gameResourcesPrepared === true, undefined, { timeout: 120_000 });
const saveEntry = (page) => page.evaluate(() => Object.entries(localStorage).find(([key]) => /game-state/.test(key)) ?? null);
const browserTypes = process.platform === "darwin" ? { chromium, firefox, webkit } : { chromium, firefox };
if (process.platform !== "darwin") {
    console.warn("webkit: skipping media-dependent production qualification on non-macOS; validate Safari/WebKit on an Apple device.");
}

try {
    for (const [name, browserType] of Object.entries(browserTypes)) {
        generation = "A";
        const browser = await browserType.launch({
            headless: false,
            ...(name === "chromium" ? { args: ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] } : {})
        });
        const context = await browser.newContext();
        context.setDefaultTimeout(60_000);
        const setOffline = async (value) => {
            // WebKit's emulated offline mode prevents service-worker navigation:
            // https://github.com/microsoft/playwright/issues/34402
            // Drop real origin connections instead; no network bytes can satisfy the PWA.
            if (name === "webkit") originUnavailable = value;
            else await context.setOffline(value);
        };
        const errors = [];
        try {
            console.log(name + ": starting production qualification");
            const first = await context.newPage();
            context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
            first.on("pageerror", (error) => errors.push(error.message));
            await first.goto(url);
            await first.locator(newGame).waitFor();
            await first.waitForFunction(() => navigator.serviceWorker.controller !== null);
            await prepared(first);
            await first.reload();
            await prepared(first);
            await first.locator(newGame).click();
            await first.locator("canvas").waitFor();
            // The shell hides the menu button until Main has completed initialization.
            await first.waitForFunction(() =>
                [...document.querySelectorAll("button")].some((button) => /menu/i.test(button.getAttribute("aria-label") ?? "") && !button.hidden)
            );
            const second = await context.newPage();
            await second.goto(url);
            await second.getByRole("button", { name: "Continue Here", exact: true }).click();
            await second.locator(continueGame).waitFor();
            assert.equal(await second.locator(continueGame).isEnabled(), true, `${name}: takeover did not save a resumable game`);
            const saved = await saveEntry(second);
            assert(saved !== null, `${name}: no save after takeover`);
            await first.getByText("Your game moved to another tab.", { exact: true }).waitFor();
            assert.equal(await first.locator("canvas").count(), 0);
            await first.close();
            await prepared(second);
            await second.locator(continueGame).click();
            await second.locator("canvas").waitFor();
            await second.waitForFunction(() =>
                [...document.querySelectorAll("button")].some((button) => /menu/i.test(button.getAttribute("aria-label") ?? "") && !button.hidden)
            );
            // Keep an old game open while the next worker installs and waits.
            generation = "B";
            await second.evaluate(async () => {
                const registration = await navigator.serviceWorker.getRegistration();
                await registration.update();
            });
            await second.waitForFunction(async () => (await navigator.serviceWorker.getRegistration()).waiting !== null);
            await second.close(); // Graceful pagehide saves and releases the old session.
            const upgraded = await context.newPage();
            await upgraded.goto(url);
            await upgraded.waitForFunction(async () => (await caches.keys()).some((key) => key.includes("qualification-B")));
            await prepared(upgraded);
            await upgraded.reload();
            await prepared(upgraded);
            assert.equal(await upgraded.locator(continueGame).isEnabled(), true, `${name}: upgrade lost Continue`);
            console.log(name + ": takeover and upgrade passed; checking offline Continue");
            await setOffline(true);
            await upgraded.reload();
            await prepared(upgraded);
            await upgraded.locator(continueGame).click();
            await upgraded.locator("canvas").waitFor();
            await upgraded.waitForFunction(() =>
                [...document.querySelectorAll("button")].some((button) => /menu/i.test(button.getAttribute("aria-label") ?? "") && !button.hidden)
            );
            // Finish by protecting a future public save against an older client.
            await setOffline(false);
            await upgraded.reload();
            await prepared(upgraded);
            const current = await saveEntry(upgraded);
            assert(current !== null);
            const future = JSON.parse(current[1]);
            future.version += 1;
            const futureText = JSON.stringify(future);
            await upgraded.evaluate(([key, value]) => localStorage.setItem(key, value), [current[0], futureText]);
            await upgraded.reload();
            await prepared(upgraded);
            assert.equal((await saveEntry(upgraded))[1], futureText, `${name}: newer public save was modified`);
            assert.equal(await upgraded.locator(continueGame).isEnabled(), false);
            assert.deepEqual(errors, [], `${name}: uncaught browser errors`);
            console.log(`${name}: game entry, saved-session takeover, two cache generations, offline Continue, and future-save preservation passed`);
        } catch (error) {
            console.error(name + " qualification failed:", errors);
            for (const page of context.pages()) {
                console.error(
                    page.url(),
                    await page
                        .locator("body")
                        .innerText()
                        .catch(() => "page unavailable")
                );
            }
            throw error;
        } finally {
            originUnavailable = false;
            await context.close();
            await browser.close();
        }
    }
} finally {
    await new Promise((resolveClose) => server.close(resolveClose));
}
