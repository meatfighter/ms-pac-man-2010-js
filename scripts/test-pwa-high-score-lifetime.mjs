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

    await runTest("older same-lifetime score download cannot complete or replace a newer download", async () => {
        const first = deferred();
        const second = deferred();
        const contexts = [];
        let call = 0;
        const originalDownload = HighScoreService.downloadScores;
        HighScoreService.downloadScores = (context) => {
            contexts.push(context);
            return (call++ === 0 ? first : second).promise;
        };
        try {
            const main = createMain(Main, HighScore);
            main.downloadScores();
            main.downloadScores();
            assert.equal(contexts.length, 2);
            assert.equal(contexts[0].signal.aborted, true, "superseding a download must abort its predecessor");
            assert.equal(main.scoresDownloadComplete, false);

            first.resolve([{ world: 0, score: 11110, initials: "OLD" }]);
            await flush();
            assert.deepEqual(readWorld(main, 0), emptyWorld());
            assert.equal(main.scoresDownloadComplete, false, "older completion must not settle the newer operation");

            second.resolve([{ world: 0, score: 22220, initials: "NEW" }]);
            await flush();
            assert.deepEqual(readWorld(main, 0)[0], { score: 22220, initials: "NEW" });
            assert.equal(main.scoresDownloadComplete, true);
        } finally {
            HighScoreService.downloadScores = originalDownload;
        }
    });

    await runTest("older same-lifetime score submission cannot settle or overwrite a newer submission", async () => {
        const first = deferred();
        const second = deferred();
        const contexts = [];
        let call = 0;
        const originalSubmit = HighScoreService.submitScore;
        HighScoreService.submitScore = (_world, _score, _initials, context) => {
            contexts.push(context);
            return (call++ === 0 ? first : second).promise;
        };
        try {
            const main = createMain(Main, HighScore);
            main.accessScoresDatabaseAsync(true, 0, 123450, "AAA");
            main.accessScoresDatabaseAsync(true, 0, 223450, "BBB");
            assert.equal(contexts.length, 2);
            assert.equal(contexts[0].signal.aborted, true, "superseding a submission must abort its predecessor");
            assert.equal(main.uploadComplete, false);

            first.resolve([{ world: 0, score: 99990, initials: "OLD" }]);
            await flush();
            assert.equal(main.uploadComplete, false);
            assert.equal(readWorld(main, 0)[0].score, 223450);

            second.resolve([{ world: 0, score: 223450, initials: "BBB" }]);
            await flush();
            assert.equal(main.uploadComplete, true);
            assert.deepEqual(readWorld(main, 0)[0], { score: 223450, initials: "BBB" });
        } finally {
            HighScoreService.submitScore = originalSubmit;
        }
    });

    await runTest("browser lifetime retirement aborts current score request contexts", async () => {
        const pendingDownload = deferred();
        const pendingSubmit = deferred();
        let downloadContext;
        let submitContext;
        const originalDownload = HighScoreService.downloadScores;
        const originalSubmit = HighScoreService.submitScore;
        HighScoreService.downloadScores = (context) => {
            downloadContext = context;
            return pendingDownload.promise;
        };
        HighScoreService.submitScore = (_world, _score, _initials, context) => {
            submitContext = context;
            return pendingSubmit.promise;
        };
        try {
            const main = createMain(Main, HighScore);
            main.downloadScores();
            main.accessScoresDatabaseAsync(true, 0, 123450, "AAA");
            assert.equal(downloadContext.signal.aborted, false);
            assert.equal(submitContext.signal.aborted, false);

            main.invalidateBrowserLifetime();

            assert.equal(downloadContext.signal.aborted, true);
            assert.equal(submitContext.signal.aborted, true);
            pendingDownload.resolve([]);
            pendingSubmit.resolve([]);
            await flush();
            assert.equal(main.scoresDownloadComplete, false);
            assert.equal(main.uploadComplete, false);
        } finally {
            HighScoreService.downloadScores = originalDownload;
            HighScoreService.submitScore = originalSubmit;
        }
    });

    await runTest("current remote table is canonical over a restored local-only submitted score", async () => {
        const pending = deferred();
        const originalDownload = HighScoreService.downloadScores;
        HighScoreService.downloadScores = () => pending.promise;
        try {
            const main = createMain(Main, HighScore);
            main.accessScoresDatabase(true, 0, 123450, "LOC");
            assert.deepEqual(readWorld(main, 0)[0], { score: 123450, initials: "LOC" });
            assert.deepEqual(main.submittedScore, { world: 0, score: 123450, initials: "LOC" });

            main.downloadScores();
            pending.resolve([{ world: 0, score: 200000, initials: "SRV" }]);
            await flush();

            assert.deepEqual(readWorld(main, 0)[0], { score: 200000, initials: "SRV" });
            assert.equal(main.submittedScore, null);
            assert.equal(main.scoresDownloadComplete, true);
        } finally {
            HighScoreService.downloadScores = originalDownload;
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
