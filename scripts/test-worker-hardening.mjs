import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
const source = readFileSync("pwa/public/sw.js", "utf8")
    .replaceAll("__APP_VERSION__", "test")
    .replaceAll("__BUILD_STAMP__", "current")
    .replaceAll("__SERVICE_WORKER_VERSION__", "current")
    .replaceAll("__RESOURCE_VERSIONS__", "{}")
    .replaceAll("__INSTALL_ICON_VERSIONS__", "{}");
function fixture({
    fetch = async () => new Response("online", { headers: { "Content-Type": "text/html" } }),
    match = async () => undefined,
    open = async () => ({ addAll: async () => {} })
} = {}) {
    const listeners = new Map();
    const timers = new Map();
    let serial = 0;
    const context = {
        URL,
        Request,
        Response,
        Headers,
        AbortController,
        setTimeout(callback, delay) {
            const id = ++serial;
            timers.set(id, { callback, delay });
            return id;
        },
        clearTimeout(id) {
            timers.delete(id);
        },
        fetch,
        caches: { match, open },
        self: {
            registration: { scope: "https://example.test/game/" },
            location: new URL("https://example.test/game/sw.js"),
            addEventListener(name, callback) {
                listeners.set(name, callback);
            }
        }
    };
    vm.runInNewContext(source, context);
    return {
        async request(mode = "navigate", suffix = "?v=other-release") {
            let result;
            listeners.get("fetch")({
                request: { url: "https://example.test/game/" + suffix, method: "GET", mode, signal: new AbortController().signal },
                respondWith(value) {
                    result = value;
                }
            });
            return result;
        },
        install() {
            let result;
            listeners.get("install")({
                waitUntil(value) {
                    result = value;
                }
            });
            return result;
        },
        async expire(delay) {
            for (let i = 0; i < 20; i++) await Promise.resolve();
            for (const [id, timer] of [...timers])
                if (timer.delay === delay) {
                    timers.delete(id);
                    timer.callback();
                }
        }
    };
}
test("cache failures do not prevent online navigation or static resource access", async () => {
    const f = fixture({
        match: async () => {
            throw new Error("cache unavailable");
        },
        open: async () => {
            throw new Error("cache unavailable");
        }
    });
    assert.equal(await (await f.request()).text(), "online");
    assert.equal(await (await f.request("same-origin", "module.js")).text(), "online");
});
test("offline navigation ignores a foreign version and reads only the active cache", async () => {
    const reads = [];
    const f = fixture({
        fetch: async () => {
            throw new Error("offline");
        },
        match: async (url, options) => {
            reads.push({ url, options });
            return new Response("offline");
        }
    });
    assert.equal(await (await f.request()).text(), "offline");
    assert.match(reads[0].url, /index.html\?v=current$/);
    assert.match(reads[0].options.cacheName, /current$/);
});
test("a total navigation miss returns an explicit uncached failure response", async () => {
    const f = fixture({
        fetch: async () => {
            throw new Error("offline");
        }
    });
    const response = await f.request();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
});
for (const phase of ["headers", "body"])
    test("navigation deadline covers stalled " + phase, async () => {
        const f = fixture({
            fetch: async () =>
                phase === "headers" ? new Promise(() => {}) : new Response(new ReadableStream({ start() {} }), { headers: { "Content-Type": "text/html" } }),
            match: async () => new Response("cached")
        });
        const pending = f.request();
        await f.expire(8000);
        assert.equal(await (await pending).text(), "cached");
    });
test("installation timeout rejects and does not report partial success", async () => {
    const f = fixture({ open: async () => ({ addAll: () => new Promise(() => {}) }) });
    const pending = assert.rejects(f.install(), /timed out/);
    await f.expire(120000);
    await pending;
});
test("navigation bounds the decoded document and removes compressed transfer metadata", async () => {
    const f = fixture({
        fetch: async () => new Response("document", { headers: { "Content-Type": "text/html", "Content-Encoding": "gzip", "Content-Length": "3" } })
    });
    const response = await f.request();
    assert.equal(await response.text(), "document");
    assert.equal(response.headers.has("Content-Encoding"), false);
    assert.equal(response.headers.has("Content-Length"), false);
    const huge = fixture({ fetch: async () => new Response(new Uint8Array(1024 * 1024 + 1), { headers: { "Content-Type": "text/html" } }) });
    assert.equal((await huge.request()).status, 503);
});
