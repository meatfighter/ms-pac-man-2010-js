import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pwaRoot = resolve(rootDir, "pwa");
const originalApiUrl = process.env.MSPACMAN_SCORE_API_URL;
const originalHmacKey = process.env.MSPACMAN_HMAC_KEY_HEX;
const originalCacheVersion = process.env.MSPACMAN_CACHE_VERSION;

process.env.MSPACMAN_SCORE_API_URL = "/api/ms-pac-man-2010/scores";
process.env.MSPACMAN_HMAC_KEY_HEX = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
delete process.env.MSPACMAN_CACHE_VERSION;

const server = await createServer({
    root: pwaRoot,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true }
});

try {
    const { HighScoreService } = await server.ssrLoadModule("/src/mspacman/HighScoreService.ts");
    const { Main } = await server.ssrLoadModule("/src/mspacman/Main.ts");
    const { HighScore } = await server.ssrLoadModule("/src/mspacman/HighScore.ts");

    await runTest("disposed Main ignores a late score download completion", async () => {
        const pending = deferred();
        const originalDownload = HighScoreService.downloadScores;
        HighScoreService.downloadScores = () => pending.promise;
        try {
            const main = createMain(Main, HighScore);
            main.downloadScores();
            assert.equal(main.scoresDownloadComplete, false);

            main.invalidateBrowserLifetime();
            pending.resolve([{ world: 0, score: 99990, initials: "OLD" }]);
            await flush();

            assert.deepEqual(readWorld(main, 0), emptyWorld());
            assert.equal(main.scoresDownloadComplete, false, "a dead Main must not be marked complete by its stale request");
        } finally {
            HighScoreService.downloadScores = originalDownload;
        }
    });

    await runTest("disposed Main ignores a late score submission completion", async () => {
        const pending = deferred();
        const originalSubmit = HighScoreService.submitScore;
        HighScoreService.submitScore = () => pending.promise;
        try {
            const main = createMain(Main, HighScore);
            main.accessScoresDatabaseAsync(true, 0, 123450, "MJB");
            assert.deepEqual(readWorld(main, 0)[0], { score: 123450, initials: "MJB" });
            assert.equal(main.uploadComplete, false);

            main.invalidateBrowserLifetime();
            pending.resolve([{ world: 0, score: 99990, initials: "OLD" }]);
            await flush();

            assert.deepEqual(readWorld(main, 0)[0], { score: 123450, initials: "MJB" });
            assert.deepEqual(main.submittedScore, { world: 0, score: 123450, initials: "MJB" });
            assert.equal(main.uploadComplete, false, "a dead Main must not be marked complete by its stale request");
        } finally {
            HighScoreService.submitScore = originalSubmit;
        }
    });
} finally {
    restoreEnv("MSPACMAN_SCORE_API_URL", originalApiUrl);
    restoreEnv("MSPACMAN_HMAC_KEY_HEX", originalHmacKey);
    restoreEnv("MSPACMAN_CACHE_VERSION", originalCacheVersion);
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

function createMain(Main, HighScore) {
    const main = new Main();
    main.highScores = Array.from({ length: 4 }, () => Array.from({ length: 5 }, () => makeHighScore(HighScore, 0, "AAA")));
    return main;
}

function makeHighScore(HighScore, score, initials) {
    const highScore = new HighScore();
    highScore.score = score;
    highScore.initials = initials;
    return highScore;
}

function readWorld(main, world) {
    return main.highScores[world].map((score) => ({ score: score.score, initials: score.initials }));
}

function emptyWorld() {
    return Array.from({ length: 5 }, () => ({ score: 0, initials: "AAA" }));
}

function deferred() {
    let resolve;
    const promise = new Promise((resolveValue) => {
        resolve = resolveValue;
    });
    return { promise, resolve };
}

async function flush() {
    for (let i = 0; i < 8; i++) {
        await Promise.resolve();
    }
}

function restoreEnv(name, value) {
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
}
