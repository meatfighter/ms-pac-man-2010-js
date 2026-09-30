/* global window */
import assert from "node:assert/strict";
import { createServer } from "vite";
import { resolve } from "node:path";
import { departureShellPlugin } from "./departure-shell-plugin.mjs";
/** Compare native positions at their measured samples; retain logical transport and voice checks. */
export async function qualifyDepartureAudio(browser, game, seeds) {
    const server = await createServer({
        configFile: resolve("pwa/vite.config.ts"),
        server: { host: "127.0.0.1", port: 0, watch: null, hmr: false },
        plugins: [departureShellPlugin(game)],
        logLevel: "warn"
    });
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    const key = game === "jackal" ? "jackal.game-state:%2F" : `${game === "stickvania" ? game : "ms-pac-man-2010"}:%2F:game-state`;
    const results = [];
    try {
        for (const seed of seeds) {
            const context = await browser.newContext();
            try {
                await context.route("**/*", (route) => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
                await context.addInitScript(() => {
                    window.departureBoundary = (_, action) => action();
                });
                const page = await context.newPage();
                page.setDefaultTimeout(120000);
                await page.goto(origin);
                await page.waitForFunction(() => window.__gameResourcesPrepared === true);
                const full = page.locator("#fullscreen-switch-button");
                if ((await full.isEnabled()) && (await full.getAttribute("aria-pressed")) === "true") await full.click();
                await page.evaluate(({ key, bytes }) => window.localStorage.setItem(key, bytes), { key, bytes: seed.bytes });
                await page.reload();
                await page.waitForFunction(() => window.__gameResourcesPrepared === true);
                await page.locator("#continue-button, #continueButton").first().click();
                await page.locator('button[aria-label*="menu" i]:not([hidden])').first().waitFor();
                const result = await page.evaluate(
                    ({ key, label }) => {
                        const a = window.departureTestAccess;
                        if (label === "audio-ended-pending") a.game.currentSong?.getLoopForState()?.stop();
                        if (label === "audio-pending-song") a.game.requestSong(a.game.stage_1_1 === a.game.currentSong ? a.game.stage_1_2 : a.game.stage_1_1);
                        if (label === "audio-silent-policy") a.soundStore.setMusicOn(false);
                        const selectAudio = (snapshot) => Object.fromEntries(Object.entries(snapshot).filter(([key]) => /audio|song|music|sound/i.test(key)));
                        let before, after, started, finished, atWrite;
                        const events = [],
                            storage = window.localStorage,
                            nativeSet = window.Storage.prototype.setItem;
                        window.Storage.prototype.setItem = function (k, bytes) {
                            const result = nativeSet.call(this, k, bytes);
                            if (k === key && this === storage) {
                                events.push("write");
                                atWrite = selectAudio(JSON.parse(bytes));
                            }
                            return result;
                        };
                        window.departureBoundary = (label, action) => {
                            events.push(label);
                            if (label === "game") {
                                after = selectAudio(a.capture());
                                finished = performance.now();
                            }
                            const result = action();
                            if (label === "freeze") {
                                started = performance.now();
                                before = selectAudio(a.capture());
                            }
                            return result;
                        };
                        try {
                            if (!a.suspend("audio-interval")) throw Error("Unexpected resource failure");
                        } finally {
                            window.Storage.prototype.setItem = nativeSet;
                        }
                        if (!atWrite) throw Error("Actual seeded runtime did not save");
                        return { before, atWrite, after, started, finished, events };
                    },
                    { key, label: seed.label }
                );
                assert(result.events.indexOf("write") < result.events.indexOf("game"));
                assert(result.events.indexOf("write") < result.events.indexOf("audio"));
                const intervalSeconds = (result.finished - result.started) / 1000;
                assert(intervalSeconds >= 0 && intervalSeconds < 10, "Bounded measured capture interval");
                let positions = 0;
                function compare(before, stored, after, path = "audio") {
                    if (typeof stored === "number" && /remainingMs$/.test(path)) {
                        assert(stored <= before + 1 && stored >= after - 1, `${seed.label}/${path}: cooldown lies between active-clock samples`);
                        assert(before - after <= intervalSeconds * 1000 + 1, `${seed.label}/${path}: cooldown ages only by measured capture interval`);
                        return;
                    }
                    if (typeof stored === "number" && /positionSeconds$/.test(path)) {
                        positions++;
                        // Native contexts advance in render quanta. Compare all three
                        // sampled offsets and allow one 128-frame quantum at 44.1 kHz.
                        const tolerance = intervalSeconds + 128 / 44100;
                        assert(
                            stored >= Math.min(before, after) - tolerance && stored <= Math.max(before, after) + tolerance,
                            `${seed.label}/${path}: offset within measured sample interval`
                        );
                        return;
                    }
                    if (stored && typeof stored === "object") {
                        assert.deepEqual(Object.keys(stored), Object.keys(before), `${seed.label}/${path}: logical voices/ownership before`);
                        assert.deepEqual(Object.keys(stored), Object.keys(after), `${seed.label}/${path}: logical voices/ownership after`);
                        for (const key of Object.keys(stored)) compare(before[key], stored[key], after[key], path + "." + key);
                    } else {
                        assert.deepEqual(stored, before, `${seed.label}/${path}: logical capture before native cleanup`);
                        assert.deepEqual(stored, after, `${seed.label}/${path}: logical state retained through write`);
                    }
                }
                compare(result.before, result.atWrite, result.after);
                results.push({ label: seed.label, intervalSeconds, positions, ...result });
                console.log(`${game}: early attached audio ${seed.label}, ${positions} native offsets checked`);
            } finally {
                await context.close();
            }
        }
    } finally {
        await server.close();
    }
    return results;
}
