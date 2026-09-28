/* global document */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
const server = await createServer({
    root: fileURLToPath(new URL("../pwa/", import.meta.url)),
    appType: "custom",
    logLevel: "silent",
    cacheDir: fileURLToPath(new URL("../node_modules/.vite-score-sync-test", import.meta.url)),
    server: { middlewareMode: true }
});
const original = {
    storage: Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
    document: globalThis.document,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    now: Date.now,
    warn: console.warn
};
let now = 1_000_000,
    id = 0,
    timers = new Map(),
    records = new Map(),
    writes = 0,
    reads = 0,
    failWrite = false,
    authorized = true,
    clients = [];
const endpoint = "https://test.invalid/api/ms-pac-man-2010/scores",
    key = "score-outbox";
const a = { world: 0, score: 100, initials: "AAA" },
    b = { world: 0, score: 200, initials: "BBB" };
const storage = {
    getItem(k) {
        reads++;
        return records.get(k) ?? null;
    },
    setItem(k, v) {
        if (failWrite) throw new Error("quota");
        writes++;
        records.set(k, v);
    },
    removeItem(k) {
        records.delete(k);
    }
};
const flush = async () => {
    for (let i = 0; i < 16; i++) await Promise.resolve();
};
const deferred = () => {
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    return { promise, resolve };
};
try {
    const { HighScoreOutbox } = await server.ssrLoadModule("/src/app/HighScoreOutbox.ts");
    const { HighScoreSync } = await server.ssrLoadModule("/src/app/HighScoreSync.ts");
    const { HighScoreService } = await server.ssrLoadModule("/src/mspacman/HighScoreService.ts");
    const { Main } = await server.ssrLoadModule("/src/mspacman/Main.ts");
    const { HighScore } = await server.ssrLoadModule("/src/mspacman/HighScore.ts");
    globalThis.document = { visibilityState: "visible" };
    Date.now = () => now;
    globalThis.setTimeout = (fn, ms) => {
        assert.ok(Number.isFinite(ms) && ms >= 0 && ms <= 3_600_000);
        const n = ++id;
        timers.set(n, { fn, at: now + ms });
        return n;
    };
    globalThis.clearTimeout = (n) => timers.delete(n);
    console.warn = () => {};
    const advance = async (ms) => {
        now += ms;
        for (let i = 0; i < 100; i++) {
            const due = [...timers].filter(([, t]) => t.at <= now);
            if (!due.length) return;
            for (const [n, t] of due) {
                timers.delete(n);
                t.fn();
            }
            await flush();
        }
        throw new Error("timer busy loop");
    };
    const box = () => new HighScoreOutbox(key, endpoint, () => authorized);
    const sync = (out, publish = () => {}) => {
        const c = new HighScoreSync(out, () => authorized, publish);
        clients.push(c);
        return c;
    };
    const reset = () => {
        for (const c of clients) c.dispose();
        clients = [];
        assert.equal(timers.size, 0, "retirement releases timers");
        records = new Map();
        writes = reads = 0;
        failWrite = false;
        authorized = true;
        Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
        document.visibilityState = "visible";
        HighScoreService.downloadScores = async () => [];
        HighScoreService.submitScore = async () => [];
    };
    const run = async (name, fn) => {
        reset();
        await fn();
        console.log("ok - " + name);
    };
    await run("enqueue persists before POST, preserves B during A acknowledgement, deduplicates exact tuples", async () => {
        const out = box(),
            pending = deferred();
        let posts = 0;
        HighScoreService.submitScore = async () => {
            posts++;
            assert.deepEqual(JSON.parse(records.get(key)).pending, [a]);
            assert.ok(JSON.parse(records.get(key)).notBefore > now);
            return pending.promise;
        };
        const c = sync(out);
        assert.equal(c.enqueueScore(a), true);
        assert.equal(posts, 1);
        assert.ok(writes >= 2);
        assert.equal(reads, 1);
        assert.equal(c.enqueueScore(a), true);
        assert.equal(c.enqueueScore(b), true);
        pending.resolve([]);
        await flush();
        assert.deepEqual(JSON.parse(records.get(key)).pending, [b]);
        assert.equal(posts, 1);
        HighScoreService.submitScore = async () => {
            posts++;
            return [];
        };
        await advance(7000);
        assert.equal(posts, 2);
        assert.deepEqual(JSON.parse(records.get(key)).pending, []);
    });
    await run("GET never acknowledges a tuple or publishes over an overlapping enqueue", async () => {
        const get = deferred(),
            post = deferred(),
            published = [];
        let posts = 0;
        HighScoreService.downloadScores = () => get.promise;
        HighScoreService.submitScore = () => {
            posts++;
            return post.promise;
        };
        const out = box(),
            c = sync(out, (t) => published.push(t));
        c.start();
        c.enqueueScore(a);
        assert.equal(posts, 0);
        get.resolve([a]);
        await flush();
        assert.equal(posts, 1);
        assert.equal(out.first().score, 100);
        assert.deepEqual(published, []);
        post.resolve([]);
        await flush();
        assert.deepEqual(published, [[]]);
        assert.equal(out.first(), null, "durable consideration acknowledges below-cutoff tuple");
    });
    await run("failed enqueue/reservation does not POST or change existing bytes", async () => {
        const out = box();
        out.enqueue(a);
        const before = records.get(key);
        let posts = 0;
        HighScoreService.submitScore = async () => {
            posts++;
            return [];
        };
        failWrite = true;
        const c = sync(out);
        assert.equal(c.enqueueScore(b), false);
        assert.equal(records.get(key), before);
        c.start();
        await flush();
        assert.equal(posts, 0);
        assert.equal(records.get(key), before);
    });
    await run("reads are bounded non-destructive misses; outgoing writes do not read old data", async () => {
        for (const text of [
            "{",
            "x".repeat(32769),
            JSON.stringify({ version: 2 }),
            JSON.stringify({ version: 1, endpoint: "wrong", pending: [a], notBefore: 0, failures: 0 })
        ]) {
            records.set(key, text);
            const out = box();
            assert.equal(out.first(), null);
            assert.equal(records.get(key), text);
            const savedGet = storage.getItem;
            storage.getItem = () => {
                throw new Error("outgoing read forbidden");
            };
            try {
                assert.equal(out.enqueue(a), true);
            } finally {
                storage.getItem = savedGet;
            }
        }
    });
    await run("full queue, oversized outgoing envelope and revoked last-boundary authority preserve storage", async () => {
        const out = box();
        for (let i = 0; i < 128; i++) assert.equal(out.enqueue({ ...a, score: (i + 1) * 10 }), true);
        const before = records.get(key);
        assert.equal(out.enqueue({ ...b, score: 99990 }), false);
        assert.equal(records.get(key), before);
        assert.equal(new HighScoreOutbox(key, "x".repeat(33000), () => true).enqueue(a), false);
        assert.equal(records.get(key), before);
        Object.defineProperty(globalThis, "localStorage", {
            configurable: true,
            get() {
                authorized = false;
                return storage;
            }
        });
        assert.equal(out.enqueue({ ...a, score: 10 }), true, "already durable duplicate needs no new write");
        authorized = true;
        const fresh = new HighScoreOutbox("fresh", endpoint, () => authorized);
        authorized = true;
        assert.equal(fresh.enqueue(a), false);
        assert.equal(records.has("fresh"), false);
    });
    await run("storage getter failure is tolerated and explicit enqueue fails", async () => {
        Object.defineProperty(globalThis, "localStorage", {
            configurable: true,
            get() {
                throw new Error("denied");
            }
        });
        const out = box();
        assert.equal(out.first(), null);
        assert.equal(out.enqueue(a), false);
    });
    await run("failed acknowledgement keeps pending tuple with bounded local retry", async () => {
        const pending = deferred();
        let posts = 0;
        HighScoreService.submitScore = () => {
            posts++;
            return pending.promise;
        };
        const out = box(),
            c = sync(out);
        c.enqueueScore(a);
        const reserved = records.get(key);
        failWrite = true;
        pending.resolve([]);
        await flush();
        assert.equal(records.get(key), reserved);
        assert.deepEqual(out.first(), a);
        for (let i = 0; i < 10; i++) c.wake();
        assert.equal(posts, 1);
        failWrite = false;
        await advance(125000);
        assert.equal(posts, 2);
        await flush();
        assert.equal(out.first(), null);
    });
    await run("Main retirement cancels its wait but delivery survives and publishes only through current app", async () => {
        const pending = deferred(),
            published = [];
        let transportSignal;
        HighScoreService.submitScore = (_w, _s, _i, ctx) => {
            transportSignal = ctx.signal;
            return pending.promise;
        };
        const out = box(),
            c = sync(out, (t) => published.push(t));
        const main = new Main();
        main.highScores = Array.from({ length: 4 }, () => Array.from({ length: 5 }, () => new HighScore()));
        main.highScoreClient = c;
        assert.equal(main.accessScoresDatabaseAsync(true, 0, 100, "AAA"), true);
        main.invalidateBrowserLifetime();
        assert.equal(transportSignal.aborted, false);
        pending.resolve([a]);
        await flush();
        assert.equal(main.uploadComplete, false);
        assert.equal(out.first(), null);
        assert.deepEqual(published, [[a]]);
    });
    await run("old epoch response/timers cannot rewrite new owner or Reset storage", async () => {
        const pending = deferred();
        HighScoreService.submitScore = () => pending.promise;
        const out = box(),
            c = sync(out);
        c.enqueueScore(a);
        c.dispose();
        authorized = false;
        records.set(key, "new-owner-bytes");
        authorized = true;
        pending.resolve([a]);
        await flush();
        c.wake();
        assert.equal(records.get(key), "new-owner-bytes");
        assert.equal(timers.size, 0);
    });
    await run("hidden abort pauses transport; visible reload respects durable reservation", async () => {
        const pending = deferred();
        let posts = 0,
            signal;
        HighScoreService.submitScore = (_w, _s, _i, ctx) => {
            posts++;
            signal = ctx.signal;
            return pending.promise;
        };
        const c = sync(box());
        c.enqueueScore(a);
        document.visibilityState = "hidden";
        c.wake();
        assert.equal(signal.aborted, true);
        pending.resolve(null);
        await flush();
        c.dispose();
        document.visibilityState = "visible";
        HighScoreService.submitScore = async () => {
            posts++;
            return [];
        };
        const next = sync(box());
        next.start();
        assert.equal(posts, 1);
        for (let i = 0; i < 20; i++) next.wake();
        assert.equal(posts, 1);
        await advance(124999);
        assert.equal(posts, 1);
        await advance(1);
        assert.equal(posts, 2);
    });
    await run("known failures persist bounded backoff and honor Retry-After without event storm", async () => {
        let posts = 0;
        HighScoreService.submitScore = async (_w, _s, _i, ctx) => {
            posts++;
            ctx.onRetryAfter(600000);
            return null;
        };
        const c = sync(box());
        c.enqueueScore(a);
        await flush();
        assert.equal(JSON.parse(records.get(key)).notBefore, now + 600000);
        for (let i = 0; i < 50; i++) c.wake();
        assert.equal(posts, 1);
        await advance(599999);
        assert.equal(posts, 1);
        await advance(1);
        assert.equal(posts, 2);
    });
    await run("result wait cancellation/timeout/disposal settle once and release listeners and timers", async () => {
        HighScoreService.downloadScores = () => new Promise(() => {});
        const c = sync(box()),
            abort = new AbortController();
        let adds = 0,
            removes = 0;
        const add = abort.signal.addEventListener.bind(abort.signal),
            remove = abort.signal.removeEventListener.bind(abort.signal);
        abort.signal.addEventListener = (...args) => {
            adds++;
            return add(...args);
        };
        abort.signal.removeEventListener = (...args) => {
            removes++;
            return remove(...args);
        };
        const p = c.requestScores({ signal: abort.signal });
        abort.abort();
        assert.equal(await p, null);
        assert.equal(adds, removes);
        const timeout = c.requestScores();
        await advance(5000);
        assert.equal(await timeout, null);
        const disposed = c.requestScores();
        c.dispose();
        assert.equal(await disposed, null);
        assert.equal(timers.size, 0);
    });
    reset();
} finally {
    for (const c of clients) c.dispose();
    globalThis.setTimeout = original.setTimeout;
    globalThis.clearTimeout = original.clearTimeout;
    Date.now = original.now;
    console.warn = original.warn;
    globalThis.document = original.document;
    if (original.storage) Object.defineProperty(globalThis, "localStorage", original.storage);
    else delete globalThis.localStorage;
    await server.close();
}
