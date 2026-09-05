import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pwaRoot = resolve(rootDir, "pwa");
const originalApiUrl = process.env.MSPACMAN_SCORE_API_URL;
const originalCacheVersion = process.env.MSPACMAN_CACHE_VERSION;
const originalHmacKey = process.env.MSPACMAN_HMAC_KEY_HEX;

process.env.MSPACMAN_SCORE_API_URL = "/api/ms-pac-man-2010/scores";
process.env.MSPACMAN_HMAC_KEY_HEX = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
delete process.env.MSPACMAN_CACHE_VERSION;

const server = await createServer({
    root: pwaRoot,
    appType: "custom",
    logLevel: "silent",
    server: {
        middlewareMode: true
    }
});

try {
    const { EnterInitialsMode } = await server.ssrLoadModule("/src/mspacman/EnterInitialsMode.ts");

    await runTest("restored submitted-initials screen does not wait for a dead request", () => {
        const input = createInput();
        const main = createMain(input);
        const mode = new EnterInitialsMode();

        mode.init(main, {});
        assert.equal(main.uploadComplete, true);
        assert.equal(main.submittedScore, null);

        // Recreate the durable UI state captured after the player had already
        // pressed Start. No browser request can survive the destroyed page.
        mode.enterPressed = true;
        mode.fadeState = EnterInitialsMode.FADE_NONE;
        mode.fadeIndex = 0;
        main.uploadComplete = true;

        mode.update({});
        assert.equal(mode.fadeState, EnterInitialsMode.FADE_OUT);
        assert.equal(mode.fadeIndex, 0);
        assert.equal(main.submitCalls, 0);
    });

    await runTest("fresh score submission still waits for its live request", () => {
        const input = createInput();
        const main = createMain(input);
        const mode = new EnterInitialsMode();

        mode.init(main, {});
        mode.fadeState = EnterInitialsMode.FADE_NONE;
        mode.fadeIndex = 0;
        mode.editingIndex = 2;
        input.confirmPressed = true;

        mode.update({});
        assert.equal(main.submitCalls, 1);
        assert.equal(main.uploadComplete, false);
        assert.equal(mode.enterPressed, true);
        assert.equal(mode.fadeState, EnterInitialsMode.FADE_NONE);

        input.confirmPressed = false;
        mode.update({});
        assert.equal(mode.fadeState, EnterInitialsMode.FADE_NONE);

        main.uploadComplete = true;
        mode.update({});
        assert.equal(mode.fadeState, EnterInitialsMode.FADE_OUT);
    });
} finally {
    restoreEnv("MSPACMAN_SCORE_API_URL", originalApiUrl);
    restoreEnv("MSPACMAN_CACHE_VERSION", originalCacheVersion);
    restoreEnv("MSPACMAN_HMAC_KEY_HEX", originalHmacKey);
    await server.close();
}

async function runTest(name, fn) {
    try {
        await fn();
        console.log(`ok - ${name}`);
    } catch (error) {
        console.error(`not ok - ${name}`);
        console.error(error);
        process.exitCode = 1;
    }
}

function createInput() {
    return {
        confirmPressed: false,
        clearKeyPressedRecord() {},
        isConfirmPressed() {
            return this.confirmPressed;
        },
        isLeftPressed() {
            return false;
        },
        isRightPressed() {
            return false;
        },
        isDownPressed() {
            return false;
        },
        isUpPressed() {
            return false;
        }
    };
}

function createMain(input) {
    const tile = {};
    const tileRow = new Array(50).fill(tile);
    return {
        input,
        tiles: [tileRow],
        score: 12340,
        worldIndex: 0,
        uploadComplete: false,
        submittedScore: { world: 0, score: 12340, initials: "OLD" },
        clappingSound: {},
        ateEnergizerSound: {},
        atePellotSound: {},
        pressedEnterSound: {},
        submitCalls: 0,
        playSound() {},
        accessScoresDatabaseAsync() {
            this.submitCalls++;
            this.uploadComplete = false;
        },
        setMode() {
            throw new Error("test should not finish the fade-out");
        }
    };
}

function restoreEnv(name, value) {
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
}
