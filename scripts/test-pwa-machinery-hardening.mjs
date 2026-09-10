import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const rootDir = process.cwd();
const mainSource = readFileSync(join(rootDir, "pwa", "src", "app", "main.ts"), "utf8");
const runtimeLoaderSource = readFileSync(join(rootDir, "pwa", "src", "app", "RuntimeLoader.ts"), "utf8");
const serviceWorkerSource = readFileSync(join(rootDir, "pwa", "public", "sw.js"), "utf8");

test("forced runtime retry supersedes pending preparation cleanly", () => {
    assert.match(runtimeLoaderSource, /if \(forceRetry && this\.preparationPromise !== null\) \{/);
    assert.match(runtimeLoaderSource, /this\.abortController\?\.abort\(new Error\("Ms\. Pac-Man runtime preparation superseded by retry\."\)\)/);
    assert.match(runtimeLoaderSource, /await this\.preparationPromise;/);
});

test("runtime preload waits for both resource branches before exposing failure", () => {
    assert.match(runtimeLoaderSource, /const results = await Promise\.allSettled\(\[/);
    assert.match(runtimeLoaderSource, /results\.find\(\(result\): result is PromiseRejectedResult => result\.status === "rejected"\)/);
    assert.match(runtimeLoaderSource, /if \(failure !== undefined\) \{\s*throw failure\.reason;\s*\}/);
    assert.match(runtimeLoaderSource, /if \(signal\.aborted\) \{\s*throw signal\.reason/);
    assert.doesNotMatch(
        runtimeLoaderSource,
        /await Promise\.all\(\[\s*ResourceLoader\.preloadResources[\s\S]*?SoundStore\.get\(\)\.preloadAudioBuffers/,
        "Audio and non-audio preload branches must not fail-fast and leave sibling work running behind a retry screen."
    );
});

test("browser lifecycle only enters the PWA menu and never auto-resumes", () => {
    assert.match(mainSource, /window\.addEventListener\("pagehide", \(\) => requestPwaMenu\("pagehide"\)\)/);
    assert.match(mainSource, /window\.addEventListener\("blur", \(\) => requestPwaMenu\("blur"\)\)/);
    assert.match(mainSource, /document\.visibilityState === "hidden"/);
    assert.doesNotMatch(mainSource, /window\.addEventListener\("focus"/);
    assert.doesNotMatch(mainSource, /window\.addEventListener\("pageshow"/);
    assert.match(mainSource, /releaseGameAudio\(\);[\s\S]*menuOverlay = renderMenuUi/);
});

test("STARTING container is owned before the first asynchronous display operation", () => {
    const mount = mainSource.slice(mainSource.indexOf("async function mountGame"), mainSource.indexOf("async function unlockAudio"));
    const ownership = mount.indexOf("container = appContainer;");
    const firstDisplayAwait = mount.indexOf("await appContainer.setDisplayMode");
    assert.ok(ownership >= 0);
    assert.ok(firstDisplayAwait >= 0);
    assert.ok(ownership < firstDisplayAwait);
});

test("service worker treats HTTP failures like network failures", () => {
    assert.match(serviceWorkerSource, /async function fetchOnce\(request\)/);
    assert.match(serviceWorkerSource, /if \(!response\.ok\) \{\s*throw new Error\(`HTTP \$\{response\.status\}`\);\s*\}/);
    assert.match(serviceWorkerSource, /event\.respondWith\(fetchOnce\(request\)\.catch\(\(\) => matchCurrentCache\(APP_INDEX\)\)\)/);
    assert.match(serviceWorkerSource, /return cached \|\| fetchOnce\(request\);/);
    assert.doesNotMatch(serviceWorkerSource, /event\.respondWith\(fetch\(request\)\.catch\(/);
});
