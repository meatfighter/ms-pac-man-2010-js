import { sourceMember } from "./persistence-test-loader.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const rootDir = process.cwd();
const mainSource = readFileSync(join(rootDir, "pwa", "src", "app", "main.ts"), "utf8");
const gameMainSource = readFileSync(join(rootDir, "pwa", "src", "mspacman", "Main.ts"), "utf8");
const runtimeLoaderSource = readFileSync(join(rootDir, "pwa", "src", "app", "RuntimeLoader.ts"), "utf8");
const serviceWorkerSource = readFileSync(join(rootDir, "pwa", "public", "sw.js"), "utf8");

test("forced runtime retry awaits canceled preparation before replacement", () => {
    assert.match(runtimeLoaderSource, /if \(!forceRetry && !alreadyCancelled\) return prior/);
    assert.match(runtimeLoaderSource, /await prior\.catch/);
    assert.match(runtimeLoaderSource, /if \(this\.reloadFailure !== null\) throw this\.reloadFailure/);
});

test("new game requires boot-prepared runtime before fresh playback activation", () => {
    const startGame = mainSource.slice(mainSource.indexOf("async function startGame"), mainSource.indexOf("function renderBoot"));
    assert.match(startGame, /const runtime = runtimeLoader\.prepared;/);
    assert.match(startGame, /if \(runtime === null\) \{\s*startPwaMenu\(\);\s*return;\s*\}/);
    const runtimeIndex = startGame.indexOf("const runtime = runtimeLoader.prepared;");
    const destroyIndex = startGame.indexOf("if (!destroyGame())");
    const generationIndex = startGame.indexOf("const generation = sessionGeneration.begin();");
    const startingIndex = startGame.indexOf('pwaSessionState = "starting";');
    const shellIndex = startGame.indexOf("viewport.createShell(generation)");
    const audioIndex = startGame.indexOf("audio = beginGameAudio();");
    const fullscreenIndex = startGame.indexOf("requestPreferredFullscreen()");
    const readyIndex = startGame.indexOf("await audio.ready");
    assert.ok(runtimeIndex >= 0 && destroyIndex > runtimeIndex);
    assert.ok(generationIndex >= 0 && audioIndex > generationIndex);
    assert.ok(startingIndex >= 0 && audioIndex > startingIndex);
    assert.ok(shellIndex >= 0 && audioIndex > shellIndex);
    assert.ok(fullscreenIndex >= 0 && readyIndex > fullscreenIndex);
    assert.match(startGame, /await audio\.ready/);
    assert.doesNotMatch(startGame, /unlockAudio|runtimeLoader\.prepare\s*\(|renderBoot/);
});

test("runtime preload observes both settled batches and aborts on first failure", () => {
    assert.match(runtimeLoaderSource, /await Promise\.all\(\[/);
    assert.match(runtimeLoaderSource, /runSettledBatch\(resources, RESOURCE_PRELOAD_CONCURRENCY, runRequired\)/);
    assert.match(runtimeLoaderSource, /runSettledBatch\(audio, AUDIO_PRELOAD_CONCURRENCY, runRequired\)/);
    assert.match(runtimeLoaderSource, /controller\.abort\(error\)/);
    assert.match(runtimeLoaderSource, /if \(failed\) throw firstFailure/);
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
    const suspendIndex = liveMenu.indexOf("suspendGameForMenu()");
    const saveIndex = liveMenu.indexOf("saveCurrentGameState");
    assert.ok(suspendIndex >= 0 && saveIndex > suspendIndex);
    const suspend = mainSource.slice(mainSource.indexOf("function suspendGameForMenu"), mainSource.indexOf("function showLiveMenuOverlay"));
    assert.match(suspend, /setLoopSuspended\(true\)/);
    assert.match(suspend, /setBrowserSuspended\(true\)/);
    assert.match(suspend, /getInput\(\)\.pause\(\)/);
    assert.match(suspend, /releaseGameAudio\(\)/);
});

test("live-menu presentation exits fullscreen before publishing a quiet retained menu", () => {
    const liveMenu = mainSource.slice(mainSource.indexOf("function showLiveMenuOverlay"), mainSource.indexOf("async function resumeLiveGameFromMenu"));
    assert.match(liveMenu, /trySave\(saveCurrentGameState\)/);
    assert.doesNotMatch(liveMenu, /Progress could not be saved|const saved =/);
    assert.match(liveMenu, /await finishLiveMenuPresentation\(session, null\)/);
    const presenter = sourceMember("pwa/src/app/main.ts", "finishLiveMenuPresentation");
    const exitIndex = presenter.indexOf("await viewport.exitFullscreenForMenu()");
    const renderIndex = presenter.indexOf("menuOverlay = overlay;");
    const publishIndex = presenter.indexOf('pwaSessionState = "menu";');
    assert.ok(exitIndex >= 0 && renderIndex > exitIndex && publishIndex > renderIndex);
});

test("ownership relinquishment performs the final save before destructive cleanup", () => {
    const release = mainSource.slice(mainSource.indexOf("function releaseOwnedSession"), mainSource.indexOf("function showCleanupFailure"));
    const saveIndex = release.indexOf("trySave(saveCurrentGameState)");
    const destroyIndex = release.indexOf("destroyGame()");
    assert.ok(saveIndex >= 0 && destroyIndex > saveIndex);
    const save = mainSource.slice(mainSource.indexOf("function saveCurrentGameState"), mainSource.indexOf("function getGameStateStore"));
    assert.match(save, /ownership/);
    assert.match(save, /persistence\.canSave\(mainGame\)/);
    assert.doesNotMatch(save, /canReadStored|inspectStored|hasValidSave/);
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
    assert.match(resume, /audio = beginGameAudio\(\)/);
    assert.match(resume, /requestPreferredFullscreen\(\)/);
    const fullscreenIndex = resume.indexOf("requestPreferredFullscreen()");
    const readyIndex = resume.indexOf("await audio.ready");
    assert.ok(fullscreenIndex >= 0 && readyIndex > fullscreenIndex);
    assert.match(resume, /commitGameAudio\(audio\)/);
    assert.match(resume, /isGameAudioLatest\(audio\)/);
    assert.equal((resume.match(/isGameAudioLatest\(audio\)/g) ?? []).length, 2, "Continue catch and finally must both reject stale attempts.");
    assert.match(resume, /isStartingGameSession\(session, audio\)/);
});

test("synchronous post-commit viewport hooks are rechecked before RUNNING", () => {
    const mount = mainSource.slice(mainSource.indexOf("async function mountGame"), mainSource.indexOf("function applyVolume"));
    const mountPause = mount.indexOf("appContainer.getInput().pause();");
    const mountStart = mount.indexOf("await initializeWithDeadline(appContainer.start(), sessionCleanup, initializationOwner);");
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
    const firstDisplayAwait = mount.indexOf("Promise.resolve(appContainer.setDisplayMode");
    assert.ok(ownership >= 0);
    assert.ok(firstDisplayAwait >= 0);
    assert.ok(ownership < firstDisplayAwait);
});

test("service worker routes bounded navigation and discards failed response bodies", () => {
    assert.match(serviceWorkerSource, /serveNavigation\(request\)/);
    assert.match(serviceWorkerSource, /discardResponse\(response\)/);
    assert.match(serviceWorkerSource, /return cached \|\| fetchOnce\(request\);/);
});
