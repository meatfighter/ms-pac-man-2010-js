import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("only the two proved accumulator paths escape the generic magnitude guard", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "mspacman-value-policy-"));
    let server;
    try {
        server = await createServer({ root: resolve("pwa"), cacheDir, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
        const { hasReasonableSnapshotValues: valid } = await server.ssrLoadModule("/src/mspacman/persistence/SnapshotValuePolicy.ts");
        const sample = (id, fields) => ({ mode: { id, fields } });
        for (const value of [100000, 100001, 1000001, 2147483647]) assert.equal(valid(sample("enterInitials", { redOffset: value })), true);
        for (const value of [100000, 100000.01, 100001.25, 1000001]) assert.equal(valid(sample("selectWorld", { angleOffset: value })), true);
        for (const [id, key] of [
            ["enterInitials", "redOffset"],
            ["selectWorld", "angleOffset"]
        ]) {
            for (const value of [-1, NaN, Infinity, -Infinity]) assert.equal(valid(sample(id, { [key]: value })), false);
            assert.equal(valid(sample("attract", { [key]: 100001 })), false);
            assert.equal(valid(sample(id, { other: 100001 })), false);
            assert.equal(valid(sample(id, { nested: { [key]: 100001 } })), false);
            assert.equal(valid({ mode: { id, fields: [{ [key]: 100001 }] } }), false);
        }
        assert.equal(valid(sample("enterInitials", { redOffset: 100001.5 })), false);
        assert.equal(valid(sample("enterInitials", { redOffset: 2147483648 })), false);
        assert.equal(valid({ mainFields: { score: 1234567, highScoreQualificationCutoff: 1234566 } }), true);
        assert.equal(valid({ text: "x".repeat(4097) }), false);
        assert.equal(valid({ mode: { id: "selectWorld", fields: { angleOffset: 100001, x: 100001 } } }), false);
    } finally {
        if (server) await server.close();
        rmSync(cacheDir, { recursive: true, force: true });
    }
});
