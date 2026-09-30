/* global window, document */
import assert from "node:assert/strict";
import { createServer } from "vite";
import { resolve } from "node:path";
/** Production constructors/dispatchers and current validators generate every seed. */
export async function loadDepartureSeeds(browser, game) {
    const server = await createServer({
        configFile: resolve("pwa/vite.config.ts"),
        server: { host: "127.0.0.1", port: 0, watch: null, hmr: false },
        logLevel: "warn"
    });
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    const context = await browser.newContext();
    try {
        await context.route("**/*", (route) => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
        const page = await context.newPage();
        const run = async (path) => {
            await page.goto(origin + path);
            await page.waitForFunction(() => ["passed", "failed"].includes(document.querySelector("#result")?.dataset.status), null, { timeout: 300000 });
            assert.equal(await page.locator("#result").getAttribute("data-status"), "passed", await page.locator("#result").textContent());
        };
        if (game === "stickvania") {
            await run("/browser-verify.html?suite=rumble-castle");
            const castle = await page.evaluate(() => window.rumbleCastleEvidence.checkpoints);
            await run("/browser-verify.html?suite=presentation-state");
            const presentation = await page.evaluate(() => window.presentationStateEvidence.checkpoints);
            const seeds = [...castle, ...presentation].filter((c) =>
                /^(dracula-combat|entry-fade11|tick505|terminal-fade11|credit-0-first-letter|credit-5-mid-recording|route-floor-breaker|floor-phase-.*|stair-0-0-.*-out-11)$/.test(
                    c.label
                )
            );
            for (const pattern of [/dracula/, /entry-fade/, /tick505/, /terminal-fade/, /credit/, /floor/, /stair/])
                assert(
                    seeds.some((c) => pattern.test(c.label)),
                    "Required producer seed: " + pattern
                );
            await run("/browser-verify.html?suite=departure-audio");
            seeds.push(...(await page.evaluate(() => window.departureAudioSeeds)));
            return seeds;
        }
        if (game === "jackal") {
            await page.goto(origin + "/game-mode-persistence.html");
            await page.waitForFunction(() => window.gameModePersistence);
            await page.mouse.click(1, 1);
            const seeds = [];
            for (const label of ["pause-audio", "pause-middle", "pause-completed", "unpaused-audio", "player-death", "player-respawn"]) {
                seeds.push(await page.evaluate((label) => window.gameModePersistence.prepareReload(label), label));
                console.log(game + ": actual producer seed " + label);
            }
            return seeds;
        }
        await run("/browser-verify.html?suite=counter-parity");
        const seeds = await page.evaluate(() => window.counterParityEvidence.departureCheckpoints);
        assert.equal(seeds.length, 4, "Frightened, life-loss, maze-complete and initials actual producer seeds");
        return seeds;
    } finally {
        await context.close();
        await server.close();
    }
}
