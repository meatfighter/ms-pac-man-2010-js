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

test("new game requires boot-prepared runtime before fresh playback activation", () => {
    const startGame = mainSource.slice(mainSource.indexOf("async function startGame"), mainSource.indexOf("function renderBoot"));
    assert.match(startGame, /const runtime = runtimeLoader\.prepared;/);
    assert.match(startGame, /if \(runtime === null\) \{\s*startPwaMenu\(\);\s*return;\s*\}/);
    assert.ok(startGame.indexOf("destroyGame();") > startGame.indexOf("const runtime = runtimeLoader.prepared;"));
    assert.ok(startGame.indexOf("const generation = sessionGeneration.begin();") < startGame.indexOf("const audio = beginGameAudio();"));
    assert.ok(startGame.indexOf('pwaSessionState = "starting";') < startGame.indexOf("const audio = beginGameAudio();"));
    assert.match(startGame, /await audio\.ready/);
    assert.doesNotMatch(startGame, /unlockAudio|runtimeLoader\.prepare\s*\(|renderBoot/);
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
    assert.match(mainSource, /function requestPwaMenu[\s\S]*?pwaSessionState = "stopping";[\s\S]*?suspendGameForMenu\(\)/);
    assert.match(mainSource, /function suspendGameForMenu[\s\S]*?releaseGameAudio\(\)/);
});

test("graphics lifecycle is exit-only and restoration never resumes gameplay", () => {
    const mount = mainSource.slice(mainSource.indexOf("async function mountGame"), mainSource.indexOf("function applyVolume"));
    assert.match(mount, /setGraphicsLifecycleHandler\(\(state\) => \{[\s\S]*?state === "lost"[\s\S]*?requestPwaMenu\("graphics-context-lost"\)/);
    assert.doesNotMatch(mount, /state === "restored"[\s\S]*?(?:setLoopSuspended\(false\)|setBrowserSuspended\(false\)|beginGameAudio\(|commitGameAudio\()/);
});

test("live-menu transition freezes and retires playback before serializing progress", () => {
    const liveMenu = mainSource.slice(mainSource.indexOf("function showLiveMenuOverlay"), mainSource.indexOf("async function resumeLiveGameFromMenu"));
    assert.ok(liveMenu.indexOf("suspendGameForMenu();") < liveMenu.indexOf("saveCurrentGameState"));
    const suspend = mainSource.slice(mainSource.indexOf("function suspendGameForMenu"), mainSource.indexOf("function showLiveMenuOverlay"));
    assert.match(suspend, /setLoopSuspended\(true\)/);
    assert.match(suspend, /setBrowserSuspended\(true\)/);
    assert.match(suspend, /getInput\(\)\.pause\(\)/);
    assert.match(suspend, /releaseGameAudio\(\)/);
});

test("live Continue is scoped to its playback attempt and retained session", () => {
    const resume = mainSource.slice(mainSource.indexOf("async function resumeLiveGameFromMenu"), mainSource.indexOf("function removeMenuOverlay"));
    assert.match(resume, /const audio = beginGameAudio\(\)/);
    assert.match(resume, /commitGameAudio\(audio\)/);
    assert.match(resume, /isGameAudioLatest\(audio\)/);
    assert.equal((resume.match(/isGameAudioLatest\(audio\)/g) ?? []).length, 2, "Continue catch and finally must both reject stale attempts.");
    assert.match(resume, /isStartingGameSession\(session, audio\)/);
});

test("STARTING container is owned before the first asynchronous display operation", () => {
    const mount = mainSource.slice(mainSource.indexOf("async function mountGame"), mainSource.indexOf("function applyVolume"));
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
