import assert from "node:assert/strict";

export const ALLOWED_RELEASE_PROVENANCE = new Set([
    "production/active",
    "synthetic-test/env",
    "rotation-candidate/next",
    "component/active",
    "component/env",
    "component/next"
]);

export function assertReleaseProvenance(metadata, { expectedHmacKeySource = "", expectedReleaseKind = "" } = {}) {
    const provenance = `${metadata.releaseKind}/${metadata.hmacKeySource}`;
    assert.ok(ALLOWED_RELEASE_PROVENANCE.has(provenance), `release.json contains an unknown release provenance: ${provenance}`);
    if (expectedReleaseKind !== "") {
        assert.equal(metadata.releaseKind, expectedReleaseKind, "Release kind does not match expected provenance.");
    }
    if (expectedHmacKeySource !== "") {
        assert.equal(metadata.hmacKeySource, expectedHmacKeySource, "HMAC key source does not match expected provenance.");
    }
}
