import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTypeScript } from "./persistence-test-loader.mjs";

const { hasReasonableSnapshotValues: valid } = await loadTypeScript("pwa/src/mspacman/persistence/SnapshotValuePolicy.ts");

test("JSON budget does not invent a second numeric gameplay policy", () => {
    for (const number of [-100001, 100001.5, 1000001, 2147483648, Number.MAX_SAFE_INTEGER, 1e20]) {
        for (const mode of ["enterInitials", "selectWorld", "attract"]) {
            assert.equal(valid({ mode: { id: mode, fields: { other: number, nested: { number } } } }), true);
        }
    }
    // Sign, exact integer and resource-index rules belong to the exact field
    // validators, not this JSON/capacity traversal.
    for (const number of [NaN, Infinity, -Infinity]) assert.equal(valid({ nested: { number } }), false);
    assert.equal(valid({ text: "x".repeat(4096) }), true);
    assert.equal(valid({ text: "x".repeat(4097) }), false);
    const shared = { x: 100001 };
    assert.equal(valid([shared, shared]), true);
    shared.self = shared;
    assert.equal(valid(shared), false);
});
