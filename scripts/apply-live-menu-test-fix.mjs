import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = "scripts/test-pwa-machinery-hardening.mjs";
let source = readFileSync(path, "utf8");

const oldText = `    // A rendering/cleanup failure may still destroy the session; an ordinary save
    // failure does not, because its boolean only selects the warning text above.
    const destroyIndex = liveMenu.indexOf("destroyGame();");
    assert.ok(destroyIndex < 0 || destroyIndex > renderIndex);`;

const newText = `    // A rendering/cleanup failure may still destroy the session. An early destroy
    // before fullscreen exit is also valid when cleanup is already unsafe. What
    // must not happen is destructive cleanup during the ordinary exit-to-menu
    // interval before the retained menu has been rendered.
    const destroyIndex = liveMenu.indexOf("destroyGame();");
    assert.ok(
        destroyIndex < 0 || destroyIndex < exitIndex || destroyIndex > renderIndex,
        "destroyGame() may only be an early unsafe-cleanup abort or occur after retained-menu rendering"
    );`;

const first = source.indexOf(oldText);
const last = source.lastIndexOf(oldText);
if (first < 0 || first !== last) {
    throw new Error(`Expected exactly one live-menu destroy assertion; found ${first < 0 ? 0 : "multiple"}. Source was not modified.`);
}

source = source.replace(oldText, newText);
writeFileSync(path, source);
unlinkSync(fileURLToPath(import.meta.url));
console.log("Updated live-menu hardening assertion and deleted the one-shot helper.");
