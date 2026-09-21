import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const rootDir = process.cwd();
const mainSource = readFileSync(join(rootDir, "pwa", "src", "app", "main.ts"), "utf8");
const gameMainSource = readFileSync(join(rootDir, "pwa", "src", "mspacman", "Main.ts"), "utf8");
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
    assert.ok(startGame.indexOf("if (!destroyGame())") > startGame.indexOf("const runtime = runtimeLoader.prepared;"));
    assert.ok(startGame.indexOf("const generation = sessionGeneration.begin();") < startGame.indexOf("const audio = beginGameAudio();"));
    assert.ok(startGame.indexOf('pwaSessionState = "starting";') < startGame.indexOf("const audio = beginGameAudio();"));
    assert.ok(startGame.indexOf("viewport.createShell(generation)") < startGame.indexOf("const audio = beginGameAudio();"));
    assert.ok(startGame.indexOf("requestPreferredFullscreen()") < startGame.indexOf("await audio.ready"));
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

test("live-menu presentation exits fullscreen before publishing recoverable save state", () => {
    const liveMenu = mainSource.slice(mainSource.indexOf("function showLiveMenuOverlay"), mainSource.indexOf("async function resumeLiveGameFromMenu"));
    assert.match(liveMenu, /const saved = sessionCleanup\.trySave\(saveCurrentGameState\)/);
    assert.match(liveMenu, /Progress could not be saved\. Continue still preserves this live game\./);
    const exitIndex = liveMenu.indexOf("await viewport.exitFullscreenForMenu()");
    const renderIndex = liveMenu.indexOf("menuOverlay = renderMenuUi");
    const publishIndex = liveMenu.indexOf('pwaSessionState = "menu";');
    assert.ok(exitIndex >= 0 && renderIndex > exitIndex && publishIndex > renderIndex);
    // A rendering/cleanup failure may still destroy the session. An early destroy
    // before fullscreen exit is also valid when cleanup is already unsafe. What
    // must not happen is destructive cleanup during the ordinary exit-to-menu
    // interval before the retained menu has been rendered.
    const destroyIndex = liveMenu.indexOf("destroyGame();");
    assert.ok(
        destroyIndex < 0 || destroyIndex < exitIndex || destroyIndex > renderIndex,
        "destroyGame() may only be an early unsafe-cleanup abort or occur after retained-menu rendering"
    );
});

test("ownership relinquishment performs the final save before destructive cleanup", () => {
    const release = mainSource.slice(mainSource.indexOf("function releaseOwnedSession"), mainSource.indexOf("function showCleanupFailure"));
    const save = mainSource.slice(mainSource.indexOf("function saveCurrentGameState"), mainSource.indexOf("function getGameStateStore"));
    assert.ok(release.indexOf("sessionCleanup.trySave(saveCurrentGameState);") < release.indexOf("destroyGame();"));
    assert.match(save, /const mainGame = game;/);
    assert.match(save, /if \(!ownership\.owned \|\| mainGame === null \|\| !mainGame\.isStateSaveReady\(\)\)/);
    assert.match(save, /store\.save\(mainGame, \(\) => ownership\.owned && game === mainGame\)/);
});

test("high-score network callbacks are fenced by browser lifetime and per-operation generations", () => {
    const operationFactory = gameMainSource.slice(
        gameMainSource.indexOf("function beginScoreOperation"),
        gameMainSource.indexOf("function retireScoreOperations")
    );
    assert.match(operationFactory, /main\.isBrowserLifetimeGenerationCurrent\(lifetime\)/);
    assert.match(operationFactory, /state\[generationKey\] === generation/);
    assert.match(operationFactory, /state\[controllerKey\] === controller/);
    assert.match(operationFactory, /!controller\.signal\.aborted/);
    assert.match(operationFactory, /state\[controllerKey\]\?\.abort\(/);

    const download = gameMainSource.slice(gameMainSource.indexOf("public downloadScores"), gameMainSource.indexOf("public accessScoresDatabaseAsync"));
    assert.match(download, /const lifetime = this\.captureBrowserLifetimeGeneration\(\)/);
    assert.match(download, /beginScoreOperation\(this, "download", lifetime\)/);
    assert.match(download, /this\.runScoreDownload\(revision, operation\)/);

    const submit = gameMainSource.slice(gameMainSource.indexOf("public accessScoresDatabaseAsync"), gameMainSource.indexOf("private async runScoreDownload"));
    assert.match(submit, /const lifetime = this\.captureBrowserLifetimeGeneration\(\)/);
    assert.match(submit, /beginScoreOperation\(this, "upload", lifetime\)/);
    assert.match(submit, /operation\.isCurrent\(\)/);
    assert.match(submit, /this\.runScoreSubmission\(submittedScore, revision, operation\)/);

    const downloadRunner = gameMainSource.slice(
        gameMainSource.indexOf("private async runScoreDownload"),
        gameMainSource.indexOf("private async runScoreSubmission")
    );
    assert.match(downloadRunner, /signal: operation\.controller\.signal/);
    assert.match(downloadRunner, /isCurrent: operation\.isCurrent/);
    assert.ok((downloadRunner.match(/operation\.isCurrent\(\)/g) ?? []).length >= 2);

    const submitRunner = gameMainSource.slice(
        gameMainSource.indexOf("private async runScoreSubmission"),
        gameMainSource.indexOf("public accessScoresDatabase(")
    );
    assert.match(submitRunner, /signal: operation\.controller\.signal/);
    assert.match(submitRunner, /isCurrent: operation\.isCurrent/);
    assert.ok((submitRunner.match(/operation\.isCurrent\(\)/g) ?? []).length >= 2);
});

test("live Continue is scoped to its playback attempt and retained session", () => {
    const resume = mainSource.slice(mainSource.indexOf("async function resumeLiveGameFromMenu"), mainSource.indexOf("function removeMenuOverlay"));
    assert.match(resume, /const audio = beginGameAudio\(\)/);
    assert.match(resume, /requestPreferredFullscreen\(\)/);
    assert.ok(resume.indexOf("requestPreferredFullscreen()") < resume.indexOf("await audio.ready"));
    assert.match(resume, /commitGameAudio\(audio\)/);
    assert.match(resume, /isGameAudioLatest\(audio\)/);
    assert.equal((resume.match(/isGameAudioLatest\(audio\)/g) ?? []).length, 2, "Continue catch and finally must both reject stale attempts.");
    assert.match(resume, /isStartingGameSession\(session, audio\)/);
});

test("synchronous post-commit viewport hooks are rechecked before RUNNING", () => {
    const mount = mainSource.slice(mainSource.indexOf("async function mountGame"), mainSource.indexOf("function applyVolume"));
    const mountPause = mount.indexOf("appContainer.getInput().pause();");
    const mountStart = mount.indexOf("await appContainer.start();");
    const mountFocus = mount.indexOf("viewport.focusCanvas();");
    const mountGuard = mount.indexOf("if (!isStartingGameSession(generation, audio) || game !== mainGame || container !== appContainer)", mountFocus);
    const mountResume = mount.indexOf("appContainer.getInput().resume();", mountGuard);
    const mountRunning = mount.indexOf('pwaSessionState = "running";', mountResume);
    const mountUnsuspend = mount.indexOf("mainGame.setBrowserSuspended(false);", mountRunning);
    assert.ok(
        mountPause >= 0 &&
            mountStart > mountPause &&
            mountFocus > mountStart &&
            mountGuard > mountFocus &&
            mountResume > mountGuard &&
            mountRunning > mountResume &&
            mountUnsuspend > mountRunning
    );

    const resume = mainSource.slice(mainSource.indexOf("async function resumeLiveGameFromMenu"), mainSource.indexOf("function removeMenuOverlay"));
    const resumeFocus = resume.indexOf("viewport.focusCanvas();");
    const resumeGuard = resume.indexOf("if (!isStartingGameSession(session, audio))", resumeFocus);
    const resumeRunning = resume.indexOf('pwaSessionState = "running";', resumeFocus);
    assert.ok(resumeFocus >= 0 && resumeGuard > resumeFocus && resumeRunning > resumeGuard);
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
