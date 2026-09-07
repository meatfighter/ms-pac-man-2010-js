import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const manifestPath = new URL("../pwa/public/manifest.webmanifest", import.meta.url);

test("Ms. Pac-Man PWA manifest has a stable game-specific identity", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.id, "/mspacman2010/");
});
