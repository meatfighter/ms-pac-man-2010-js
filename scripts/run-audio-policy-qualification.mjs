import assert from "node:assert/strict";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";
import { disableFullscreenPreference } from "./fullscreen-test-utils.mjs";

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
const resetSelector = "#reset-button, #resetButton";
const menuButtonSelector = '#hamburger-button:not([hidden]), #menuButton:not([hidden]), button[aria-label*="menu" i]:not([hidden])';

let browser = null;
try {
    browser = await chromium.launch({ headless: false, args: ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
    const context = await browser.newContext();
    context.setDefaultTimeout(60_000);
    await context.addInitScript(() => {
        const NativeAudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext;
        let contextsCreated = 0;
        let bufferSourceStarts = 0;
        if (typeof NativeAudioContext === "function") {
            const WrappedAudioContext = new Proxy(NativeAudioContext, {
                construct(target, args) {
                    const audioContext = Reflect.construct(target, args, target);
                    contextsCreated++;
                    const createBufferSource = audioContext.createBufferSource.bind(audioContext);
                    Object.defineProperty(audioContext, "createBufferSource", {
                        configurable: true,
                        value: (...sourceArgs) => {
                            const source = createBufferSource(...sourceArgs);
                            const start = source.start.bind(source);
                            source.start = (...startArgs) => {
                                bufferSourceStarts++;
                                return start(...startArgs);
                            };
                            return source;
                        }
                    });
                    return audioContext;
                }
            });
            if (globalThis.AudioContext === NativeAudioContext) {
                Object.defineProperty(globalThis, "AudioContext", { configurable: true, writable: true, value: WrappedAudioContext });
            }
            if (globalThis.webkitAudioContext === NativeAudioContext) {
                Object.defineProperty(globalThis, "webkitAudioContext", { configurable: true, writable: true, value: WrappedAudioContext });
            }
        }
        Object.defineProperty(globalThis, "__msPacManAudioPolicyQualification", {
            configurable: true,
            value: {
                stats: () => ({ contextsCreated, bufferSourceStarts })
            }
        });
    });

    const errors = [];
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto(url);
    await page.locator(newGameSelector).first().waitFor({ state: "visible" });
    await disableFullscreenPreference(page);
    await page.locator(newGameSelector).first().click();
    await waitForRunning(page, "initial New Game");

    // Advance title -> world select -> intro -> active gameplay using the real
    // keyboard path. The serialized state below is the final authority that the
    // timing reached PlayingMode rather than relying only on a wall-clock delay.
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1_300);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(9_000);
    await page.keyboard.press("p");
    await page.waitForTimeout(100);

    await page.locator(menuButtonSelector).first().click();
    await page.locator(continueSelector).first().waitFor({ state: "visible" });
    const pausedSave = await readSave(page);
    assert.equal(pausedSave.snapshot.mode.id, "playing", "pause qualification did not reach active PlayingMode");
    assert.equal(pausedSave.snapshot.mainFields.paused, true, "saved gameplay is not paused");
    assert(pausedSave.snapshot.music !== null, "paused gameplay has no logical Music snapshot");
    assert.equal(pausedSave.snapshot.music.playback.transport, "paused", "gameplay Pause was not serialized as a paused Music transport");
    assert.equal("audioSettings" in pausedSave.snapshot, false, "v7 save still contains global audio policy");

    await page.reload();
    await page.locator(continueSelector).first().waitFor({ state: "visible" });
    const beforePausedContinue = await audioStats(page);
    await page.locator(continueSelector).first().click();
    await waitForRunning(page, "paused durable Continue");
    await page.waitForTimeout(100);
    const afterPausedContinue = await audioStats(page);
    assert.equal(
        afterPausedContinue.bufferSourceStarts,
        beforePausedContinue.bufferSourceStarts,
        "paused durable Continue physically started a Music/Sound source before unpause"
    );

    await page.keyboard.press("p");
    await page.waitForTimeout(150);
    const afterUnpause = await audioStats(page);
    assert(
        afterUnpause.bufferSourceStarts > afterPausedContinue.bufferSourceStarts,
        "unpause did not attach the restored Music transport to the fresh playback generation"
    );

    // Reset must repair application policy immediately in the same JavaScript page.
    await page.locator(menuButtonSelector).first().click();
    await page.locator(resetSelector).first().waitFor({ state: "visible" });
    await page.locator(resetSelector).first().click();
    await page.locator(newGameSelector).first().waitFor({ state: "visible" });
    await disableFullscreenPreference(page);
    const beforeResetNewGame = await audioStats(page);
    await page.locator(newGameSelector).first().click();
    await waitForRunning(page, "Reset -> New Game");
    await page.waitForTimeout(150);
    const afterResetNewGame = await audioStats(page);
    assert(afterResetNewGame.bufferSourceStarts > beforeResetNewGame.bufferSourceStarts, "Reset -> New Game did not start background Music in the same page");

    // Save an unpaused title session, reload, and prove durable Continue attaches
    // Music automatically without requiring an in-game unpause.
    await page.locator(menuButtonSelector).first().click();
    await page.locator(continueSelector).first().waitFor({ state: "visible" });
    const unpausedSave = await readSave(page);
    assert.equal(unpausedSave.snapshot.mainFields.paused, false, "unpaused save unexpectedly records paused gameplay");
    assert(unpausedSave.snapshot.music !== null, "unpaused save has no logical Music snapshot");
    assert.equal(unpausedSave.snapshot.music.playback.transport, "playing", "unpaused save did not capture playing Music");

    await page.reload();
    await page.locator(continueSelector).first().waitFor({ state: "visible" });
    const beforeUnpausedContinue = await audioStats(page);
    await page.locator(continueSelector).first().click();
    await waitForRunning(page, "unpaused durable Continue");
    await page.waitForTimeout(150);
    const afterUnpausedContinue = await audioStats(page);
    assert(afterUnpausedContinue.bufferSourceStarts > beforeUnpausedContinue.bufferSourceStarts, "unpaused durable Continue did not attach background Music");

    assert.deepEqual(errors, [], "audio-policy qualification produced uncaught browser errors");
    console.log(
        "Audio-policy qualification passed: paused durable Continue, unpause, Reset -> New Game, and unpaused durable Continue preserve Music ownership."
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
    assert.equal(await page.locator("canvas").count(), 1, `${label}: expected exactly one canvas`);
}

async function audioStats(page) {
    return page.evaluate(() => globalThis.__msPacManAudioPolicyQualification?.stats() ?? { contextsCreated: 0, bufferSourceStarts: 0 });
}

async function readSave(page) {
    const entry = await page.evaluate(() => Object.entries(localStorage).find(([key]) => /game-state-v7$/.test(key)) ?? null);
    assert(entry !== null, "expected a v7 saved game");
    return { key: entry[0], snapshot: JSON.parse(entry[1]) };
}
