import assert from "node:assert/strict";
import { resolve } from "node:path";
import { resolveConfig } from "vite";

const CONFIG_FILE = resolve("pwa", "vite.config.ts");
const FIXED_API_URL = "/api/ms-pac-man-2010/scores";
const VALID_SYNTHETIC_KEY = "0".repeat(64);
const ORIGINAL_KEY = process.env.MSPACMAN_HMAC_KEY_HEX;
const ORIGINAL_API_URL = process.env.MSPACMAN_SCORE_API_URL;

try {
    await runTest("release build config rejects missing and empty HMAC keys", async () => {
        await assertReleaseConfigFails(undefined, undefined, "MSPACMAN_HMAC_KEY_HEX");
        await assertReleaseConfigFails("", undefined, "MSPACMAN_HMAC_KEY_HEX");
    });

    await runTest("release build config rejects malformed HMAC keys without printing them", async () => {
        for (const key of ["0".repeat(63), "0".repeat(65), "A".repeat(64), "g".repeat(64)]) {
            const error = await resolveReleaseConfigError(key, undefined);
            assert.ok(error instanceof Error);
            assert.match(error.message, /MSPACMAN_HMAC_KEY_HEX/);
            assert.equal(error.message.includes(key), false);
        }
    });

    await runTest("release build config rejects overridden score API URLs", async () => {
        await assertReleaseConfigFails(VALID_SYNTHETIC_KEY, "/api/ms-pac-man-2010/test-scores", "fixed same-origin");
        await assertReleaseConfigFails(VALID_SYNTHETIC_KEY, "https://example.invalid/api/ms-pac-man-2010/scores", "same-origin");
        await assertReleaseConfigFails(VALID_SYNTHETIC_KEY, `${FIXED_API_URL}?debug=1`, "query");
    });

    await runTest("release build config accepts fixed API URL with a valid synthetic key", async () => {
        await assertReleaseConfigPasses(VALID_SYNTHETIC_KEY, FIXED_API_URL);
    });
} finally {
    restoreEnv();
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

async function assertReleaseConfigFails(key, apiUrl, pattern) {
    const error = await resolveReleaseConfigError(key, apiUrl);
    assert.ok(error instanceof Error);
    assert.match(error.message, new RegExp(pattern));
}

async function assertReleaseConfigPasses(key, apiUrl) {
    const error = await resolveReleaseConfigError(key, apiUrl);
    assert.equal(error, null);
}

async function resolveReleaseConfigError(key, apiUrl) {
    setEnv("MSPACMAN_HMAC_KEY_HEX", key);
    setEnv("MSPACMAN_SCORE_API_URL", apiUrl);
    try {
        await resolveConfig(
            {
                configFile: CONFIG_FILE,
                logLevel: "silent"
            },
            "build",
            "release"
        );
        return null;
    } catch (error) {
        return error;
    }
}

function setEnv(name, value) {
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
}

function restoreEnv() {
    setEnv("MSPACMAN_HMAC_KEY_HEX", ORIGINAL_KEY);
    setEnv("MSPACMAN_SCORE_API_URL", ORIGINAL_API_URL);
}
