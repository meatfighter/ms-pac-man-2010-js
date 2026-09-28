import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { shellSubject } from "./persistence-test-loader.mjs";
const name = JSON.parse(readFileSync("package.json", "utf8")).name;
const jackal = name === "jackal-js";
const pac = name === "ms-pac-man-2010-js";
const file = jackal ? "pwa/src/app/JackalWebApp.ts" : pac ? "pwa/src/app/main.ts" : "pwa/src/main.ts";
const method = pac ? "mountGame" : "launchPreparedGame";
for (const fault of ["constructor", "setter", "stale", "unsafe", "published-timeout"]) {
    test("unpublished candidate containment: " + fault, async () => {
        const events = [];
        let current = true;
        const replacementGame = {};
        const replacementContainer = {};
        const cleanup = {
            safe: true,
            run(...steps) {
                for (const step of steps) {
                    try {
                        step();
                    } catch {
                        this.safe = false;
                    }
                }
                return this.safe;
            }
        };
        const env = {
            highScoreSync: null,
            retireHighScoreSync() {},
            startHighScoreSync() {},
            game: replacementGame,
            container: replacementContainer,
            sessionCleanup: cleanup,
            isStartingGameSession: () => current,
            viewport: { attach() {}, gameHost: {}, getResponsiveDisplayMode: () => ({ width: 800, height: 600 }) },
            sessionMapping: {},
            preferences: {},
            preferredHardMode: false,
            scalingPreference: "smooth",
            GAME_DISPLAY_WIDTH: 800,
            GAME_DISPLAY_HEIGHT: 600,
            HIGH_DPI_ENABLED: true,
            MAX_DEVICE_PIXEL_RATIO: 2,
            bufferedScalingModeForPreference() {},
            applyDisplayModePreference() {},
            getRumbleManager: () => ({}),
            handleGamePauseStateChanged() {},
            destroyGame() {
                const state = jackal ? this : env;
                state.container.destroy();
                if (jackal) state.game.disposeBrowserRuntime();
                if (pac) state.game.invalidateBrowserLifetime();
                state.container = null;
                state.game = null;
                events.push("terminal");
            },
            showCleanupFailure() {
                events.push("terminal");
            }
        };
        class Main {
            buttonMapping = { copyFrom() {} };
            setInputMappingChangedHandler() {}
            setDifficultyChangedHandler() {}
            reserveBrowserRuntime() {
                events.push("reserve");
            }
            disposeBrowserRuntime() {
                events.push("main-dispose");
            }
            invalidateBrowserLifetime() {
                events.push("main-dispose");
            }
        }
        class Buffered {
            setScalingPreference() {}
        }
        class Container {
            constructor() {
                if (fault === "constructor") throw new Error("constructor failed");
            }
            getBrowserLifetimeSignal() {
                return new AbortController().signal;
            }

            setPreserveAudioCacheOnDestroy() {}
            setLoopSuspended() {}
            getInput() {
                return { pause() {} };
            }
            setHighDpiEnabled() {
                if (fault === "stale") current = false;
                else if (fault !== "published-timeout") throw new Error("setter failed");
            }
            setMaxDevicePixelRatio() {}
            setGraphicsLifecycleHandler() {
                cleanup.safe = false;
                throw new Error("initialization failed");
            }
            destroy() {
                events.push("container-dispose");
                if (fault === "unsafe") throw new Error("destroy failed");
            }
        }
        const runtime = {
            Main,
            StickvaniaBufferedGame: Buffered,
            ScalableGame2: Buffered,
            slick: { AppGameContainer: Container, BufferedScalableGame: Buffered }
        };
        const subject = shellSubject(file, [method], env, jackal ? "JackalWebApp" : null);
        const pending = subject[method](runtime, false, 1, {}, {});
        if (fault === "stale") await pending;
        else await assert.rejects(pending, /failed/);
        const state = jackal ? subject : env;
        assert.equal(state.game, fault === "published-timeout" ? null : replacementGame);
        assert.equal(state.container, fault === "published-timeout" ? null : replacementContainer);
        assert.equal(events.filter((event) => event === "container-dispose").length, fault === "constructor" ? 0 : 1);
        assert.equal(events.filter((event) => event === "main-dispose").length, jackal || pac ? 1 : 0);
        assert.equal(events.includes("terminal"), fault === "unsafe" || fault === "published-timeout");
    });
}
