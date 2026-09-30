/* global window, document, KeyboardEvent */
import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium, firefox } from "playwright";
import { resolve, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { departureShellPlugin } from "./departure-shell-plugin.mjs";
export async function qualifyDepartureShell(game) {
    const evidence = resolve(process.env.QUALIFICATION_EVIDENCE_DIR ?? join(tmpdir(), game + "-departure-save"));
    mkdirSync(evidence, { recursive: true });
    const server = await createServer({
        configFile: resolve("pwa/vite.config.ts"),
        server: { host: "127.0.0.1", port: 0, watch: null, hmr: false },
        plugins: [departureShellPlugin(game)],
        logLevel: "warn"
    });
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/`;
    const scope = encodeURIComponent("/");
    const key = game === "jackal" ? `jackal.game-state:${scope}` : `${game === "stickvania" ? game : "ms-pac-man-2010"}:${scope}:game-state`;
    const results = [];
    try {
        for (const [name, type] of Object.entries({ chromium, firefox })) {
            const browser = await type.launch({
                headless: true,
                ...(name === "chromium" ? { args: ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] } : {})
            });
            try {
                const cases = [
                    "none",
                    "freeze",
                    "game",
                    "input",
                    "audio",
                    "wake",
                    "storage",
                    "unsafe",
                    "unaccepted",
                    "freeze-reentry",
                    "storage-reentry",
                    "storage-target",
                    "setItem-reentry",
                    "cleanup-reentry",
                    "input-callback",
                    "audio-poll-callback",
                    "update-callback",
                    ...(game === "stickvania" ? ["rumble", "internal-rumble"] : [])
                ];
                for (const fault of cases) {
                    const context = await browser.newContext();
                    try {
                        await context.route("**/*", (route) =>
                            new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort()
                        );
                        await context.addInitScript(() => {
                            window.departureBoundary = (_, action) => action();
                        });
                        const page = await context.newPage();
                        page.setDefaultTimeout(120000);
                        await page.goto(url);
                        await page.waitForFunction(() => window.__gameResourcesPrepared === true);
                        const fullscreen = page.locator("#fullscreen-switch-button");
                        if ((await fullscreen.isEnabled()) && (await fullscreen.getAttribute("aria-pressed")) === "true") await fullscreen.click();
                        await page.locator("#new-game-button, #newGameButton").first().click();
                        await page.locator('button[aria-label*="menu" i]:not([hidden])').first().waitFor();
                        await page.locator('button[aria-label*="menu" i]:not([hidden])').first().click();
                        await page.locator("#continue-button, #continueButton").first().click();
                        await page.locator('button[aria-label*="menu" i]:not([hidden])').first().waitFor();
                        await page.waitForTimeout(300);
                        const record = await page.evaluate(
                            ({ fault, key }) => {
                                const a = window.departureTestAccess,
                                    events = [];
                                if (!a.game?.isStateSaveReady()) throw Error("Actual Main is not ready");
                                // Establish an actual validated old snapshot before arming faults.
                                const storage = localStorage,
                                    old = storage.getItem(key);
                                if (!old) throw Error("Actual serializer/store did not establish baseline");
                                const game = a.game;
                                let expected;
                                let armed = true,
                                    nested = false,
                                    writes = 0;
                                const set = Storage.prototype.setItem;
                                const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
                                const reenter = () => {
                                    if (!nested) {
                                        nested = true;
                                        a.suspend("nested");
                                    }
                                };
                                Storage.prototype.setItem = function (candidate, text) {
                                    if (candidate === key && this === storage) {
                                        events.push("setItem");
                                        if (fault === "storage") throw Error("Injected quota");
                                        set.call(this, candidate, text);
                                        writes++;
                                        if (fault === "setItem-reentry") reenter();
                                    } else set.call(this, candidate, text);
                                };
                                if (fault === "storage-reentry" || fault === "storage-target")
                                    Object.defineProperty(window, "localStorage", {
                                        configurable: true,
                                        get() {
                                            if (armed) {
                                                armed = false;
                                                if (fault === "storage-reentry") reenter();
                                                else a.replaceGame(null);
                                            }
                                            return storage;
                                        }
                                    });
                                if (fault === "unsafe")
                                    a.cleanup.run(() => {
                                        throw Error("Earlier failure");
                                    });
                                if (fault === "unaccepted") a.persistence.retire(game);
                                if (fault === "internal-rumble") {
                                    const stop = game.stopAllRumbles.bind(game);
                                    game.stopAllRumbles = () => {
                                        events.push("internal-rumble");
                                        stop();
                                        throw Error("Injected internal rumble");
                                    };
                                }
                                window.departureBoundary = (label, action) => {
                                    events.push(label);
                                    if (fault === "freeze-reentry" && label === "freeze") reenter();
                                    if (fault === "cleanup-reentry" && label === "audio") reenter();
                                    if (fault === label) throw Error("Injected " + label);
                                    const result = action();
                                    if (label === "freeze" && expected === undefined) expected = a.capture();
                                    return result;
                                };
                                let safe;
                                try {
                                    if (fault.endsWith("callback")) {
                                        let entered = false;
                                        const enter = () => {
                                            if (!entered) {
                                                entered = true;
                                                events.push(fault);
                                                a.suspend("engine-callback");
                                            }
                                        };
                                        const input = a.container.getInput();
                                        if (fault === "input-callback") {
                                            input.addKeyListener({
                                                setInput() {},
                                                isAcceptingInput: () => true,
                                                inputStarted() {},
                                                inputEnded() {},
                                                keyPressed: enter,
                                                keyReleased() {}
                                            });
                                            const canvas = document.querySelector("canvas");
                                            canvas.focus();
                                            canvas.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyZ", key: "z", bubbles: true }));
                                        } else {
                                            const target = fault === "update-callback" ? a.container.game : a.soundStore;
                                            const method = fault === "update-callback" ? "update" : "poll";
                                            const original = target[method];
                                            target[method] = function (...args) {
                                                target[method] = original;
                                                enter();
                                                return original.apply(this, args);
                                            };
                                        }
                                        a.container.loopFrame(a.container.lastFrameTime + 32);
                                        if (!entered) throw Error("Actual engine callback was not reached: " + fault);
                                        if (!a.container.isLoopSuspended()) throw Error("Reentrant departure did not freeze engine");
                                        safe = a.cleanup.safe;
                                    } else safe = a.suspend("qualification");
                                } finally {
                                    armed = false;
                                    Storage.prototype.setItem = set;
                                    if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
                                    a.restoreGame(game);
                                }
                                const current = storage.getItem(key);
                                return {
                                    fault,
                                    safe,
                                    events,
                                    writes,
                                    oldSchema: JSON.parse(old).version,
                                    schema: JSON.parse(current).version,
                                    oldUnchanged: old === current,
                                    expected,
                                    actual: JSON.parse(current),
                                    old: JSON.parse(old),
                                    cleanupSafe: a.cleanup.safe,
                                    failures: a.cleanup.failure?.errors?.map((e) => ({ message: e.message, stack: e.stack }))
                                };
                            },
                            { fault, key }
                        );
                        const denied = ["freeze", "unsafe", "unaccepted", "freeze-reentry", "storage-reentry", "storage-target", "storage"].includes(fault);
                        assert.equal(record.writes, denied ? 0 : 1, `${name}/${fault}: exactly one eligible actual-store write`);
                        if (denied) assert(record.oldUnchanged, `${fault}: keep prior valid bytes`);
                        else {
                            const material = (snapshot) =>
                                JSON.stringify(snapshot, (key, value) =>
                                    /^(savedAt|appVersion|nextFrameTime|audio|audioState|currentSongState)$/.test(key) ? undefined : value
                                );
                            assert.equal(material(record.actual), material(record.expected), `${fault}: save contains the actual frozen world`);
                            assert.notEqual(material(record.actual), material(record.old), `${fault}: save advances the older world, not just savedAt`);
                            for (const boundary of ["game", "input", "audio", "wake", ...(game === "stickvania" ? ["rumble"] : [])])
                                assert(record.events.indexOf("setItem") < record.events.indexOf(boundary), `${fault}: native write precedes ${boundary}`);
                        }
                        for (const boundary of ["freeze", "game", "input", "audio", "wake", ...(game === "stickvania" ? ["rumble"] : [])])
                            assert(record.events.includes(boundary), `${fault}: still attempts ${boundary}`);
                        const guardedInputReentry = game === "stickvania" && fault === "input-callback";
                        if (guardedInputReentry) {
                            assert.equal(record.failures?.length, 1, "Only the existing controller baseline guard may fail");
                            assert.match(record.failures[0].message, /controller baseline sampling is not reentrant with poll/);
                        }
                        assert.equal(
                            record.safe,
                            !guardedInputReentry && !["freeze", "game", "input", "audio", "wake", "rumble", "internal-rumble", "unsafe"].includes(fault),
                            `${fault}: preserve actual cleanup safety ${JSON.stringify(record.failures)}`
                        );
                        assert.equal(record.schema, record.oldSchema);
                        results.push({ browser: name, ...record });
                        writeFileSync(join(evidence, game + "-departure-shell.json"), JSON.stringify(results, null, 2));
                        console.log(`${game} ${name}: actual shell/store ${fault} passed`);
                    } finally {
                        await context.close();
                    }
                }
            } finally {
                await browser.close();
            }
        }
    } finally {
        await server.close();
    }
    return results;
}
