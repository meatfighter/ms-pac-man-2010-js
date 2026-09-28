import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const records = new Map();
const server = await createServer({
    root: fileURLToPath(new URL("../pwa/", import.meta.url)),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true }
});
try {
    const { HighScoreOutbox } = await server.ssrLoadModule("/src/app/HighScoreOutbox.ts");
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: { getItem: (k) => records.get(k) ?? null, setItem: (k, v) => records.set(k, v) }
    });
    const endpoint = "https://loopback.invalid/scores",
        tuple = { world: 0, score: 100, initials: "AAA" };
    const valid = { version: 1, endpoint, pending: [tuple], notBefore: 0, failures: 0 };
    const mutations = [
        (d) => (d.version = 0),
        (d) => (d.endpoint = "wrong"),
        (d) => (d.extra = true),
        (d) => (d.pending = [tuple, tuple]),
        (d) => (d.pending = [{ ...tuple, world: 4 }]),
        (d) => (d.pending = [{ ...tuple, score: 101 }]),
        (d) => (d.pending = [{ ...tuple, initials: "a" }]),
        (d) => (d.notBefore = -1),
        (d) => (d.notBefore = 1.5),
        (d) => (d.failures = 17),
        (d) => (d.pending = Array(129).fill(tuple))
    ];
    for (const mutate of mutations) {
        const d = structuredClone(valid);
        mutate(d);
        const bytes = JSON.stringify(d);
        records.set("out", bytes);
        const box = new HighScoreOutbox("out", endpoint, () => true);
        assert.equal(box.first(), null);
        assert.equal(records.get("out"), bytes);
        assert.equal(box.enqueue(tuple), true);
        assert.deepEqual(JSON.parse(records.get("out")), valid);
    }
    records.set("out", JSON.stringify(valid));
    const box = new HighScoreOutbox("out", endpoint, () => true);
    assert.deepEqual(box.first(), tuple);
    const copy = box.first();
    copy.score = 999;
    assert.deepEqual(box.first(), tuple);
    assert.deepEqual(Object.keys(JSON.parse(records.get("out"))).sort(), ["endpoint", "failures", "notBefore", "pending", "version"]);
    assert.deepEqual(Object.keys(JSON.parse(records.get("out")).pending[0]).sort(), ["initials", "score", "world"]);
    console.log(
        "Outbox validation: 11 malformed documents rejected without mutation; valid overwrite, detached tuple, and minimal serialized authority passed."
    );
} finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
    await server.close();
}
