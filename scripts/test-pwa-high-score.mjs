import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const KEY_HEX = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const EXPECTED_CHECKSUM = "fe345752fb39fd05f3311673de7990bebab48c9b801436b3a46546ce65e5c418";
const API_URL = "/api/ms-pac-man-2010/scores";
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pwaRoot = resolve(rootDir, "pwa");
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalCrypto = globalThis.crypto;
const originalApiUrl = process.env.MSPACMAN_SCORE_API_URL;
const originalHmacKey = process.env.MSPACMAN_HMAC_KEY_HEX;
const originalCacheVersion = process.env.MSPACMAN_CACHE_VERSION;

process.env.MSPACMAN_SCORE_API_URL = API_URL;
process.env.MSPACMAN_HMAC_KEY_HEX = KEY_HEX;
delete process.env.MSPACMAN_CACHE_VERSION;
globalThis.window = {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis)
};

const server = await createServer({
    root: pwaRoot,
    appType: "custom",
    logLevel: "silent",
    server: {
        middlewareMode: true
    }
});

let scoreService;
try {
    const { HighScoreService, calculateScoreChecksumForTesting, resetHighScoreServiceForTesting } =
        await server.ssrLoadModule("/src/mspacman/HighScoreService.ts");
    const { PROTOCOL_VERSION } = await server.ssrLoadModule("/src/mspacman/HighScoreProtocol.ts");
    scoreService = HighScoreService;
    const { Main } = await server.ssrLoadModule("/src/mspacman/Main.ts");
    const { HighScore } = await server.ssrLoadModule("/src/mspacman/HighScore.ts");

    await runTest("unused score bodies cancel without waiting for native cancellation", async () => {
        let canceled = 0;
        const response = new Response(
            new ReadableStream({
                cancel() {
                    canceled++;
                    return new Promise(() => {});
                }
            }),
            { status: 503 }
        );
        installFetch(() => response);
        assert.equal(await HighScoreService.downloadScores(), null);
        assert.equal(canceled, 1);
    });

    await runTest("score readers release locks on success, read failure, and oversized data", async () => {
        for (const kind of ["success", "failure", "oversize"]) {
            let canceled = 0;
            const stream = new ReadableStream({
                start(controller) {
                    if (kind === "failure") controller.error(new Error("read failed"));
                    else if (kind === "oversize") controller.enqueue(new Uint8Array(8193));
                    else {
                        controller.enqueue(new TextEncoder().encode(JSON.stringify({ protocolVersion: 1, scores: [] })));
                        controller.close();
                    }
                },
                cancel() {
                    canceled++;
                    return new Promise(() => {});
                }
            });
            const response = new Response(stream, { headers: protocolHeaders("application/json") });
            installFetch(() => response);
            const result = await HighScoreService.downloadScores();
            assert.equal(stream.locked, false);
            if (kind === "success") assert.deepEqual(result, []);
            else assert.equal(result, null);
            if (kind === "oversize") assert.equal(canceled, 1);
        }
    });

    await runTest("POST requires complete validation plus exact durable marker; Retry-After is bounded", async () => {
        for (const marker of [null, "0", "true", "1"]) {
            installFetch(() => {
                const r = jsonResponse([], 1);
                if (marker === null) r.headers.delete("MsPacMan-Score-Durable");
                else r.headers.set("MsPacMan-Score-Durable", marker);
                return r;
            });
            assert.deepEqual(await HighScoreService.submitScore(0, 100, "AAA"), marker === "1" ? [] : null);
        }
        const now = Date.now();
        for (const status of [429, 503])
            for (const [value, min, max] of [
                ["60", 60000, 60000],
                ["999999", 3600000, 3600000],
                [new Date(now + 120000).toUTCString(), 118000, 120000],
                ["garbage", null, null]
            ]) {
                let observed = null;
                installFetch(() => new Response("", { status, headers: { "Retry-After": value } }));
                assert.equal(await HighScoreService.submitScore(0, 100, "AAA", { onRetryAfter: (d) => (observed = d) }), null);
                if (min === null) assert.equal(observed, null);
                else assert.ok(observed >= min && observed <= max, String(observed));
            }
    });
    await runTest("HMAC checksum matches the cross-language vector", async () => {
        const checksum = await calculateScoreChecksumForTesting(KEY_HEX, {
            world: 0,
            score: 123450,
            initials: "MJB"
        });
        assert.equal(checksum, EXPECTED_CHECKSUM);
    });

    await runTest("downloadScores returns a validated table without mutating callers", async () => {
        const calls = installFetch(() => jsonResponse([{ world: 0, score: 123450, initials: "MJB" }], PROTOCOL_VERSION));
        const result = await HighScoreService.downloadScores();

        assert.deepEqual(result, [{ world: 0, score: 123450, initials: "MJB" }]);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, API_URL);
        assert.equal(calls[0].init.method, "GET");
        assert.equal(calls[0].init.cache, "no-store");
        assert.equal(calls[0].init.credentials, "omit");
    });

    await runTest("submitScore sends one signed POST and returns the authoritative table", async () => {
        const calls = installFetch(() => jsonResponse([{ world: 0, score: 123450, initials: "MJB" }], PROTOCOL_VERSION));
        const result = await HighScoreService.submitScore(0, 123450, "MJB");
        const body = JSON.parse(calls[0].init.body);

        assert.deepEqual(result, [{ world: 0, score: 123450, initials: "MJB" }]);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].init.method, "POST");
        assert.equal(body.protocolVersion, PROTOCOL_VERSION);
        assert.equal(body.checksum, EXPECTED_CHECKSUM);
    });

    await runTest("score requests reject non-200 and common server failure statuses without retry", async () => {
        for (const status of [400, 403, 413, 429, 503, 201, 204]) {
            const calls = installFetch(() => jsonResponse([], PROTOCOL_VERSION, status));
            assert.equal(await HighScoreService.downloadScores(), null);
            assert.equal(calls.length, 1);
        }
    });

    await runTest("score requests reject malformed response metadata and bodies", async () => {
        installFetch(() => jsonResponse([], 2));
        assert.equal(await HighScoreService.downloadScores(), null);

        installFetch(
            () =>
                new Response(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, scores: [] }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                })
        );
        assert.equal(await HighScoreService.downloadScores(), null);

        installFetch(
            () => new Response(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, scores: [] }), { status: 200, headers: protocolHeaders("text/plain") })
        );
        assert.equal(await HighScoreService.downloadScores(), null);

        installFetch(() => new Response("{", { status: 200, headers: protocolHeaders("application/json") }));
        assert.equal(await HighScoreService.downloadScores(), null);

        installFetch(() => jsonResponse([{ world: 0, score: 0, initials: "AAA" }], PROTOCOL_VERSION));
        assert.equal(await HighScoreService.downloadScores(), null);
    });

    await runTest("oversized score responses are canceled and treated as best-effort failure", async () => {
        let canceled = false;
        installFetch(
            () =>
                new Response(
                    new ReadableStream({
                        start(controller) {
                            controller.enqueue(new TextEncoder().encode("x".repeat(8193)));
                        },
                        cancel() {
                            canceled = true;
                        }
                    }),
                    { status: 200, headers: protocolHeaders("application/json") }
                )
        );

        assert.equal(await HighScoreService.downloadScores(), null);
        assert.equal(canceled, true);
    });

    await runTest("request timeout covers the whole operation and can prevent fetch from starting", async () => {
        const calls = [];
        globalThis.window = {
            setTimeout(callback) {
                callback();
                return 1;
            },
            clearTimeout() {}
        };
        globalThis.fetch = (_url, init) => {
            calls.push({ init });
            return Promise.reject(new Error("fetch should not start after synchronous retirement"));
        };

        assert.equal(await HighScoreService.downloadScores(), null);
        assert.equal(calls.length, 0);
        globalThis.window = originalWindow ?? {
            setTimeout: globalThis.setTimeout.bind(globalThis),
            clearTimeout: globalThis.clearTimeout.bind(globalThis)
        };
    });

    await runTest("caller cancellation during HMAC import prevents signing and POST", async () => {
        resetHighScoreServiceForTesting();
        const calls = installFetch(() => jsonResponse([], PROTOCOL_VERSION));
        const imported = deferred();
        let signCalls = 0;
        Object.defineProperty(globalThis, "crypto", {
            configurable: true,
            value: {
                subtle: {
                    importKey() {
                        return imported.promise;
                    },
                    sign() {
                        signCalls++;
                        return Promise.resolve(new Uint8Array(32).buffer);
                    }
                }
            }
        });
        const controller = new AbortController();
        const operation = HighScoreService.submitScore(0, 123450, "MJB", { signal: controller.signal });
        controller.abort();
        imported.resolve({});
        assert.equal(await operation, null);
        assert.equal(signCalls, 0);
        assert.equal(calls.length, 0);
        restoreCrypto();
        resetHighScoreServiceForTesting();
    });

    await runTest("caller cancellation returns even when HMAC import never settles", async () => {
        resetHighScoreServiceForTesting();
        const calls = installFetch(() => jsonResponse([], PROTOCOL_VERSION));
        Object.defineProperty(globalThis, "crypto", {
            configurable: true,
            value: {
                subtle: {
                    importKey() {
                        return new Promise(() => undefined);
                    },
                    sign() {
                        throw new Error("sign must not run after retirement");
                    }
                }
            }
        });
        const controller = new AbortController();
        const operation = HighScoreService.submitScore(0, 123450, "MJB", { signal: controller.signal });
        await Promise.resolve();
        controller.abort();

        const result = await Promise.race([
            operation,
            new Promise((_, reject) => setTimeout(() => reject(new Error("retired HMAC import did not return")), 250))
        ]);
        assert.equal(result, null);
        assert.equal(calls.length, 0);
        restoreCrypto();
        resetHighScoreServiceForTesting();
    });

    await runTest("caller cancellation during signing prevents a late POST", async () => {
        resetHighScoreServiceForTesting();
        const calls = installFetch(() => jsonResponse([], PROTOCOL_VERSION));
        const signing = deferred();
        const signingStarted = deferred();
        Object.defineProperty(globalThis, "crypto", {
            configurable: true,
            value: {
                subtle: {
                    importKey() {
                        return Promise.resolve({});
                    },
                    sign() {
                        signingStarted.resolve();
                        return signing.promise;
                    }
                }
            }
        });
        const controller = new AbortController();
        const operation = HighScoreService.submitScore(0, 123450, "MJB", { signal: controller.signal });
        await signingStarted.promise;
        controller.abort();
        signing.resolve(new Uint8Array(32).buffer);
        assert.equal(await operation, null);
        assert.equal(calls.length, 0);
        restoreCrypto();
        resetHighScoreServiceForTesting();
    });

    await runTest("caller cancellation aborts a fetch already in flight", async () => {
        const calls = [];
        globalThis.window = {
            setTimeout: globalThis.setTimeout.bind(globalThis),
            clearTimeout: globalThis.clearTimeout.bind(globalThis)
        };
        globalThis.fetch = (_url, init) => {
            calls.push({ init });
            return new Promise((_resolve, reject) => {
                if (init.signal.aborted) {
                    reject(new DOMException("Aborted", "AbortError"));
                    return;
                }
                init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
            });
        };
        const controller = new AbortController();
        const operation = HighScoreService.downloadScores({ signal: controller.signal });
        assert.equal(calls.length, 1);
        controller.abort();
        assert.equal(await operation, null);
        assert.equal(calls[0].init.signal.aborted, true);
    });

    await runTest("unavailable WebCrypto returns ordinary submission failure without network retry", async () => {
        resetHighScoreServiceForTesting();
        const calls = installFetch(() => jsonResponse([], PROTOCOL_VERSION));
        Object.defineProperty(globalThis, "crypto", {
            configurable: true,
            value: {
                subtle: {
                    importKey() {
                        return Promise.reject(new Error("synthetic crypto import failure"));
                    },
                    sign() {
                        return Promise.reject(new Error("synthetic crypto sign failure"));
                    }
                }
            }
        });

        assert.equal(await HighScoreService.submitScore(0, 123450, "MJB"), null);
        assert.equal(calls.length, 0);
        restoreCrypto();
        resetHighScoreServiceForTesting();
    });

    await runTest("rejecting WebCrypto signing returns ordinary submission failure without network retry", async () => {
        resetHighScoreServiceForTesting();
        const calls = installFetch(() => jsonResponse([], PROTOCOL_VERSION));
        Object.defineProperty(globalThis, "crypto", {
            configurable: true,
            value: {
                subtle: {
                    importKey() {
                        return Promise.resolve({});
                    },
                    sign() {
                        return Promise.reject(new Error("synthetic crypto sign failure"));
                    }
                }
            }
        });

        assert.equal(await HighScoreService.submitScore(0, 123450, "MJB"), null);
        assert.equal(calls.length, 0);
        restoreCrypto();
        resetHighScoreServiceForTesting();
    });

    await runTest("score exactly equal to fifth place is not a high score", () => {
        const main = createMain(Main, HighScore, [
            [
                { score: 50000, initials: "AAA" },
                { score: 40000, initials: "BBB" },
                { score: 30000, initials: "CCC" },
                { score: 20000, initials: "DDD" },
                { score: 10000, initials: "EEE" }
            ]
        ]);
        main.worldIndex = 0;
        main.beginUserRunHighScoreQualification();
        main.score = 10000;
        assert.equal(main.isHighScore(), false);
        main.score = 10010;
        assert.equal(main.isHighScore(), true);
    });

    await runTest("exact duplicate submission leaves five-row local table unchanged", () => {
        const initialRows = [
            { score: 50000, initials: "AAA" },
            { score: 40000, initials: "BBB" },
            { score: 30000, initials: "CCC" },
            { score: 20000, initials: "DDD" },
            { score: 10000, initials: "EEE" }
        ];
        const main = createMain(Main, HighScore, [initialRows]);
        const result = main.accessScoresDatabase(true, 0, 30000, "CCC");

        assert.deepEqual(readWorld(main, 0), initialRows);
        assert.deepEqual(result, { world: 0, score: 30000, initials: "CCC" });
        assert.equal(readWorld(main, 0).filter((row) => row.score === 30000 && row.initials === "CCC").length, 1);
    });

    await runTest("async submission updates local leaderboard before an event-loop tick", async () => {
        const post = deferred();
        const restore = overrideScoreService(HighScoreService, Promise.resolve(null), post.promise);
        try {
            const main = createMain(Main, HighScore);
            main.accessScoresDatabaseAsync(true, 0, 123450, "MJB");

            assert.deepEqual(readWorld(main, 0), [
                { score: 123450, initials: "MJB" },
                { score: 0, initials: "AAA" },
                { score: 0, initials: "AAA" },
                { score: 0, initials: "AAA" },
                { score: 0, initials: "AAA" }
            ]);
            assert.deepEqual(main.submittedScore, { world: 0, score: 123450, initials: "MJB" });
            assert.equal(main.uploadComplete, false);

            post.resolve(null);
            await tick();
            assert.equal(main.uploadComplete, true);
        } finally {
            restore();
        }
    });

    await runTest("explicit below-local-cutoff score still reaches the application client", async () => {
        let submitCount = 0;
        const originalSubmit = HighScoreService.submitScore;
        HighScoreService.submitScore = () => {
            submitCount++;
            return Promise.resolve(null);
        };
        try {
            const main = createMain(Main, HighScore, [
                [
                    { score: 50000, initials: "AAA" },
                    { score: 40000, initials: "BBB" },
                    { score: 30000, initials: "CCC" },
                    { score: 20000, initials: "DDD" },
                    { score: 10000, initials: "EEE" }
                ]
            ]);

            main.accessScoresDatabaseAsync(true, 0, 9990, "LOW");
            assert.deepEqual(readWorld(main, 0), [
                { score: 50000, initials: "AAA" },
                { score: 40000, initials: "BBB" },
                { score: 30000, initials: "CCC" },
                { score: 20000, initials: "DDD" },
                { score: 10000, initials: "EEE" }
            ]);
            assert.equal(main.submittedScore, null);
            assert.equal(main.uploadComplete, false);
            assert.equal(submitCount, 1);
            await tick();
            assert.equal(main.uploadComplete, true);
        } finally {
            HighScoreService.submitScore = originalSubmit;
        }
    });

    await runTest("exact duplicate while server is unreachable leaves one local copy", async () => {
        const initialRows = [
            { score: 50000, initials: "AAA" },
            { score: 40000, initials: "BBB" },
            { score: 30000, initials: "CCC" },
            { score: 20000, initials: "DDD" },
            { score: 10000, initials: "EEE" }
        ];
        const post = deferred();
        const restore = overrideScoreService(HighScoreService, Promise.resolve(null), post.promise);
        try {
            const main = createMain(Main, HighScore, [initialRows]);
            main.accessScoresDatabaseAsync(true, 0, 30000, "CCC");
            assert.deepEqual(readWorld(main, 0), initialRows);
            post.resolve(null);
            await tick();

            assert.deepEqual(readWorld(main, 0), initialRows);
            assert.equal(readWorld(main, 0).filter((row) => row.score === 30000 && row.initials === "CCC").length, 1);
        } finally {
            restore();
        }
    });

    await runTest("startup GET cannot overwrite a later successful POST response", async () => {
        const startupGet = deferred();
        const post = deferred();
        const restore = overrideScoreService(HighScoreService, startupGet.promise, post.promise);
        try {
            const main = createMain(Main, HighScore);
            main.downloadScores();
            main.accessScoresDatabaseAsync(true, 0, 123450, "MJB");
            assert.deepEqual(readWorld(main, 0)[0], { score: 123450, initials: "MJB" });

            post.resolve([{ world: 0, score: 123450, initials: "MJB" }]);
            await tick();
            startupGet.resolve([{ world: 0, score: 99990, initials: "OLD" }]);
            await tick();

            assert.deepEqual(readWorld(main, 0), [
                { score: 123450, initials: "MJB" },
                { score: 0, initials: "AAA" },
                { score: 0, initials: "AAA" },
                { score: 0, initials: "AAA" },
                { score: 0, initials: "AAA" }
            ]);
        } finally {
            restore();
        }
    });

    await runTest("startup GET cannot roll back a local-only score after POST failure", async () => {
        const startupGet = deferred();
        const post = deferred();
        const restore = overrideScoreService(HighScoreService, startupGet.promise, post.promise);
        try {
            const main = createMain(Main, HighScore);
            main.downloadScores();
            main.accessScoresDatabaseAsync(true, 0, 123450, "MJB");
            assert.deepEqual(readWorld(main, 0)[0], { score: 123450, initials: "MJB" });

            post.resolve(null);
            await tick();
            startupGet.resolve([{ world: 0, score: 99990, initials: "OLD" }]);
            await tick();

            assert.equal(readWorld(main, 0)[0].score, 123450);
            assert.equal(readWorld(main, 0)[0].initials, "MJB");
        } finally {
            restore();
        }
    });

    await runTest("fresh server GET after restored submitted score becomes authoritative", async () => {
        const serverGet = deferred();
        const restore = overrideScoreService(HighScoreService, serverGet.promise, Promise.resolve(null));
        try {
            const main = createMain(Main, HighScore);
            main.accessScoresDatabase(true, 0, 123450, "CAT");
            main.downloadScores();
            serverGet.resolve([
                { world: 0, score: 200000, initials: "TOP" },
                { world: 0, score: 150000, initials: "MID" },
                { world: 1, score: 50000, initials: "SUE" }
            ]);
            await tick();

            assert.deepEqual(readWorld(main, 0), [
                { score: 200000, initials: "TOP" },
                { score: 150000, initials: "MID" },
                { score: 0, initials: "AAA" },
                { score: 0, initials: "AAA" },
                { score: 0, initials: "AAA" }
            ]);
            assert.equal(main.submittedScore, null);
        } finally {
            restore();
        }
    });

    await runTest("authoritative POST table without candidate clears rejected submitted score", async () => {
        const post = deferred();
        const restore = overrideScoreService(HighScoreService, Promise.resolve(null), post.promise);
        try {
            const main = createMain(Main, HighScore);
            main.accessScoresDatabaseAsync(true, 0, 123450, "MJB");
            assert.deepEqual(readWorld(main, 0)[0], { score: 123450, initials: "MJB" });
            post.resolve([{ world: 0, score: 99990, initials: "OLD" }]);
            await tick();

            assert.deepEqual(readWorld(main, 0), [
                { score: 99990, initials: "OLD" },
                { score: 0, initials: "AAA" },
                { score: 0, initials: "AAA" },
                { score: 0, initials: "AAA" },
                { score: 0, initials: "AAA" }
            ]);
            assert.equal(main.submittedScore, null);
        } finally {
            restore();
        }
    });

    await runTest("exact duplicate POST supersedes an older startup GET", async () => {
        const startupGet = deferred();
        const post = deferred();
        const restore = overrideScoreService(HighScoreService, startupGet.promise, post.promise);
        try {
            const main = createMain(Main, HighScore, [[{ score: 123450, initials: "MJB" }]]);
            main.downloadScores();
            main.accessScoresDatabaseAsync(true, 0, 123450, "MJB");
            assert.deepEqual(readWorld(main, 0)[0], { score: 123450, initials: "MJB" });

            post.resolve([{ world: 0, score: 123450, initials: "MJB" }]);
            await tick();
            startupGet.resolve([{ world: 0, score: 99990, initials: "OLD" }]);
            await tick();

            assert.equal(readWorld(main, 0)[0].score, 123450);
            assert.equal(readWorld(main, 0)[0].initials, "MJB");
            assert.equal(main.submittedScore, null);
        } finally {
            restore();
        }
    });
} finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    restoreEnv("MSPACMAN_SCORE_API_URL", originalApiUrl);
    restoreEnv("MSPACMAN_HMAC_KEY_HEX", originalHmacKey);
    restoreEnv("MSPACMAN_CACHE_VERSION", originalCacheVersion);
    restoreCrypto();
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

function installFetch(handler) {
    const calls = [];
    globalThis.window = {
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis)
    };
    globalThis.fetch = async (url, init) => {
        calls.push({ url: String(url), init });
        return handler(url, init);
    };
    return calls;
}

function jsonResponse(scores, protocolVersion, status = 200) {
    const body =
        status === 204
            ? null
            : JSON.stringify({
                  protocolVersion,
                  scores
              });
    return new Response(body, {
        status,
        headers: { ...protocolHeaders("application/json"), ...(status === 200 ? { "MsPacMan-Score-Durable": "1" } : {}) }
    });
}

function protocolHeaders(contentType) {
    return {
        "Content-Type": contentType,
        "MsPacMan-Protocol-Version": "1"
    };
}

function createMain(Main, HighScore, worldRows = []) {
    const main = new Main();
    // UI-wait double. The real application coordinator is exercised in test-high-score-sync.
    let candidate = null;
    main.highScoreClient = {
        enqueueScore(value) {
            candidate = value;
            return true;
        },
        requestScores(context) {
            const pending = candidate;
            candidate = null;
            return pending === null ? scoreService.downloadScores(context) : scoreService.submitScore(pending.world, pending.score, pending.initials, context);
        }
    };
    main.highScores = Array.from({ length: 4 }, () => Array.from({ length: 5 }, () => makeHighScore(HighScore, 0, "AAA")));
    for (let world = 0; world < worldRows.length; world++) {
        const rows = worldRows[world];
        if (!Array.isArray(rows)) {
            continue;
        }
        for (let row = 0; row < Math.min(rows.length, 5); row++) {
            main.highScores[world][row] = makeHighScore(HighScore, rows[row].score, rows[row].initials);
        }
    }
    return main;
}

function makeHighScore(HighScore, score, initials) {
    const highScore = new HighScore();
    highScore.score = score;
    highScore.initials = initials;
    return highScore;
}

function readWorld(main, world) {
    return main.highScores[world].map((score) => ({
        score: score.score,
        initials: score.initials
    }));
}

function overrideScoreService(HighScoreService, downloadPromise, submitPromise) {
    const originalDownload = HighScoreService.downloadScores;
    const originalSubmit = HighScoreService.submitScore;
    HighScoreService.downloadScores = () => downloadPromise;
    HighScoreService.submitScore = () => submitPromise;
    return () => {
        HighScoreService.downloadScores = originalDownload;
        HighScoreService.submitScore = originalSubmit;
    };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolveValue, rejectValue) => {
        resolve = resolveValue;
        reject = rejectValue;
    });
    return {
        promise,
        resolve,
        reject
    };
}

async function tick() {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function restoreCrypto() {
    Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: originalCrypto
    });
}

function restoreEnv(name, value) {
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
}
