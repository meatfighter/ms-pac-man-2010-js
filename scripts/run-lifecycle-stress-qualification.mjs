/* global caches, location */
import assert from "node:assert/strict";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";

const LIVE_CONTINUE_CYCLES = 20;
const NEW_GAME_CYCLES = 5;
const EXPECTED_FRESH_ACTIVATIONS = LIVE_CONTINUE_CYCLES + NEW_GAME_CYCLES;
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
    const url = new URL(request.url, "http://localhost");
    const path = resolve(root, "." + decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
    if (!path.startsWith(root + sep) || !existsSync(path) || !statSync(path).isFile()) {
        response.writeHead(404).end();
        return;
    }
    response.writeHead(200, { "Content-Type": mime[extname(path)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    createReadStream(path).pipe(response);
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
        const state = {
            audioInstrumented: false,
            audioCreated: 0,
            audioClosed: 0,
            audioLive: new Set(),
            wakeInstrumented: false,
            wakeAcquired: 0,
            wakeReleased: 0,
            wakeLive: new Set()
        };

        const NativeAudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext;
        if (typeof NativeAudioContext === "function") {
            try {
                const WrappedAudioContext = new Proxy(NativeAudioContext, {
                    construct(target, args) {
                        const audioContext = Reflect.construct(target, args, target);
                        state.audioCreated++;
                        state.audioLive.add(audioContext);
                        const noteClosed = () => {
                            if (audioContext.state === "closed" && state.audioLive.delete(audioContext)) {
                                state.audioClosed++;
                            }
                        };
                        audioContext.addEventListener?.("statechange", noteClosed);
                        return audioContext;
                    }
                });
                if (globalThis.AudioContext === NativeAudioContext) {
                    Object.defineProperty(globalThis, "AudioContext", { configurable: true, writable: true, value: WrappedAudioContext });
                }
                if (globalThis.webkitAudioContext === NativeAudioContext) {
                    Object.defineProperty(globalThis, "webkitAudioContext", { configurable: true, writable: true, value: WrappedAudioContext });
                }
                state.audioInstrumented = true;
            } catch {
                // Instrumentation is observational only; production behavior must still run.
            }
        }

        const wakeLock = navigator.wakeLock;
        if (wakeLock && typeof wakeLock.request === "function") {
            try {
                const request = wakeLock.request.bind(wakeLock);
                Object.defineProperty(wakeLock, "request", {
                    configurable: true,
                    value: async (...args) => {
                        const sentinel = await request(...args);
                        state.wakeAcquired++;
                        state.wakeLive.add(sentinel);
                        const noteReleased = () => {
                            if (state.wakeLive.delete(sentinel)) {
                                state.wakeReleased++;
                            }
                        };
                        sentinel.addEventListener?.("release", noteReleased, { once: true });
                        if (sentinel.released) {
                            noteReleased();
                        }
                        return sentinel;
                    }
                });
                state.wakeInstrumented = true;
            } catch {
                // Wake locks are optional and the wrapper must never change app behavior.
            }
        }

        Object.defineProperty(globalThis, "__cutoverLifecycleStats", {
            configurable: true,
            value: () => ({
                audioInstrumented: state.audioInstrumented,
                audioCreated: state.audioCreated,
                audioClosed: state.audioClosed,
                audioLive: [...state.audioLive].filter((audioContext) => audioContext.state !== "closed").length,
                wakeInstrumented: state.wakeInstrumented,
                wakeAcquired: state.wakeAcquired,
                wakeReleased: state.wakeReleased,
                wakeLive: [...state.wakeLive].filter((sentinel) => !sentinel.released).length
            })
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
    await waitForRunning(page);

    const baselineCacheKeys = await page.evaluate(async () => (await caches.keys()).sort());
    const baselineLifecycle = await readLifecycleStats(page);
    const baselineResourceUrls = await page.evaluate(() =>
        performance
            .getEntriesByType("resource")
            .map((entry) => entry.name)
            .filter((name) => !new URL(name, location.href).pathname.includes("/api/"))
    );
    await page.evaluate(() => performance.clearResourceTimings());

    for (let i = 0; i < LIVE_CONTINUE_CYCLES; i++) {
        await openLiveMenu(page, `live cycle ${i + 1}`);
        const continueButton = page.locator(continueSelector).first();
        assert.equal(await continueButton.isEnabled(), true, `live cycle ${i + 1}: Continue is disabled`);
        await continueButton.click();
        await continueButton.waitFor({ state: "hidden" });
        await waitForRunning(page, `live cycle ${i + 1}`);
    }

    for (let i = 0; i < NEW_GAME_CYCLES; i++) {
        await openLiveMenu(page, `new-game cycle ${i + 1}`);
        const newGameButton = page.locator(newGameSelector).first();
        await newGameButton.waitFor({ state: "visible" });
        await newGameButton.click();
        await newGameButton.waitFor({ state: "hidden" });
        await waitForRunning(page, `new-game cycle ${i + 1}`);
    }

    await page.waitForFunction(
        () => {
            const stats = globalThis.__cutoverLifecycleStats?.();
            return stats === undefined || ((!stats.audioInstrumented || stats.audioLive <= 1) && (!stats.wakeInstrumented || stats.wakeLive <= 1));
        },
        undefined,
        { timeout: 5_000 }
    );

    const finalLifecycle = await readLifecycleStats(page);
    if (baselineLifecycle.audioInstrumented && baselineLifecycle.audioCreated > 0) {
        assert.equal(
            finalLifecycle.audioCreated - baselineLifecycle.audioCreated,
            EXPECTED_FRESH_ACTIVATIONS,
            "Each explicit Continue/New Game activation must construct exactly one fresh AudioContext."
        );
    }
    if (finalLifecycle.audioInstrumented) {
        assert.ok(finalLifecycle.audioLive <= 1, `Retired AudioContexts accumulated: ${JSON.stringify(finalLifecycle)}`);
    }
    if (finalLifecycle.wakeInstrumented) {
        assert.ok(finalLifecycle.wakeLive <= 1, `Wake-lock sentinels accumulated: ${JSON.stringify(finalLifecycle)}`);
    }

    const finalCacheKeys = await page.evaluate(async () => (await caches.keys()).sort());
    assert.deepEqual(finalCacheKeys, baselineCacheKeys, "Lifecycle cycles created or removed a cache namespace.");

    const unexpectedResources = await page.evaluate((baselineUrls) => {
        const baseline = new Set(baselineUrls);
        const observed = new Map();

        for (const entry of performance.getEntriesByType("resource")) {
            const name = entry.name;
            const resourceUrl = new URL(name, location.href);
            if (resourceUrl.pathname.includes("/api/")) {
                continue;
            }
            observed.set(name, (observed.get(name) ?? 0) + 1);
        }

        return [...observed.entries()]
            .filter(([name, count]) => baseline.has(name) || count > 1)
            .map(([name, count]) => `${name} (post-baseline requests: ${count})`);
    }, baselineResourceUrls);
    assert.deepEqual(
        unexpectedResources,
        [],
        `Lifecycle cycles refetched previously loaded assets or repeatedly fetched late resources: ${unexpectedResources.join(", ")}`
    );
    assert.deepEqual(errors, [], "Lifecycle stress produced uncaught browser errors.");

    console.log(
        `Lifecycle stress passed: ${LIVE_CONTINUE_CYCLES} live MENU/Continue cycles and ${NEW_GAME_CYCLES} repeated New Game cycles; ` +
            `caches/resources remained stable; lifecycle stats ${JSON.stringify(finalLifecycle)}.`
    );
    await context.close();
} finally {
    if (browser !== null) {
        await browser.close();
    }
    await new Promise((resolveClose) => server.close(resolveClose));
}

async function openLiveMenu(page, label = "cycle") {
    const menuButton = page.locator(menuButtonSelector).first();
    await menuButton.waitFor({ state: "visible" });
    await menuButton.click();
    const continueButton = page.locator(continueSelector).first();
    await continueButton.waitFor({ state: "visible" });
    assert.equal(await page.locator("canvas").count(), 1, `${label}: live menu did not retain exactly one game canvas`);
    assert.equal(await page.locator(menuButtonSelector).count(), 0, `${label}: gameplay menu button remained active behind the live menu`);
}

async function waitForRunning(page, label = "start") {
    await page.locator("canvas").waitFor({ state: "visible" });
    const menuButton = page.locator(menuButtonSelector).first();
    await menuButton.waitFor({ state: "visible" });
    assert.equal(await page.locator("canvas").count(), 1, `${label}: expected exactly one game canvas`);
    assert.equal(await page.locator(menuButtonSelector).count(), 1, `${label}: expected exactly one visible gameplay menu button`);
    assert.equal(await page.locator(".session-ownership-message").count(), 0, `${label}: ownership UI unexpectedly replaced the active game`);
}

async function readLifecycleStats(page) {
    return page.evaluate(
        () =>
            globalThis.__cutoverLifecycleStats?.() ?? {
                audioInstrumented: false,
                audioCreated: 0,
                audioClosed: 0,
                audioLive: 0,
                wakeInstrumented: false,
                wakeAcquired: 0,
                wakeReleased: 0,
                wakeLive: 0
            }
    );
}
