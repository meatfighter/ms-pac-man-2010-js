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

process.env.MSPACMAN_SCORE_API_URL = API_URL;
process.env.MSPACMAN_HMAC_KEY_HEX = KEY_HEX;
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

try {
    const { HighScoreService, calculateScoreChecksumForTesting } = await server.ssrLoadModule("/src/mspacman/HighScoreService.ts");
    const { PROTOCOL_VERSION } = await server.ssrLoadModule("/src/mspacman/HighScoreProtocol.ts");
    const { Main } = await server.ssrLoadModule("/src/mspacman/Main.ts");
    const { HighScore } = await server.ssrLoadModule("/src/mspacman/HighScore.ts");

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

    await runTest("timeout aborts the single score request without retry", async () => {
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
            return new Promise((_resolve, reject) => {
                if (init.signal.aborted) {
                    reject(new DOMException("Aborted", "AbortError"));
                    return;
                }
                init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
            });
        };

        assert.equal(await HighScoreService.downloadScores(), null);
        assert.equal(calls.length, 1);
        globalThis.window = originalWindow ?? {
            setTimeout: globalThis.setTimeout.bind(globalThis),
            clearTimeout: globalThis.clearTimeout.bind(globalThis)
        };
    });

    await runTest("startup GET cannot overwrite a later successful POST response", async () => {
        const startupGet = deferred();
        const post = deferred();
        const restore = overrideScoreService(HighScoreService, startupGet.promise, post.promise);
        try {
            const main = createMain(Main, HighScore);
            main.downloadScores();
            main.accessScoresDatabaseAsync(true, 0, 123450, "MJB");
            await tick();

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
            await tick();

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
} finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
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
        headers: protocolHeaders("application/json")
    });
}

function protocolHeaders(contentType) {
    return {
        "Content-Type": contentType,
        "MsPacMan-Protocol-Version": "1"
    };
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
