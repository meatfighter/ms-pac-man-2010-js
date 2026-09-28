import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
    return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

const packageJson = JSON.parse(read("package.json"));
const packageLock = JSON.parse(read("package-lock.json"));
const humanInput = read("pwa/src/mspacman/HumanInput.ts");
const serializer = read("pwa/src/mspacman/persistence/MsPacManGameStateSerializer.ts");
const snapshot = read("pwa/src/mspacman/persistence/GameStateSnapshot.ts");
const statePolicy = read("pwa/src/mspacman/persistence/StateFieldPolicy.ts");
const stateStore = read("pwa/src/mspacman/persistence/MsPacManGameStateStore.ts");
const enterInitialsMode = read("pwa/src/mspacman/EnterInitialsMode.ts");
const browserMain = read("pwa/src/app/main.ts");
const browserPreferences = read("pwa/src/app/BrowserPreferences.ts");
const browserStorageKeys = read("pwa/src/app/BrowserStorageKeys.ts");
const playbackSession = read("pwa/src/app/PlaybackSession.ts");
const sessionCleanup = read("pwa/src/app/SessionCleanup.ts");
const runtimeLoader = read("pwa/src/app/RuntimeLoader.ts");
const sessionGeneration = read("pwa/src/app/SessionGeneration.ts");
const serviceWorkerRegistrar = read("pwa/src/app/ServiceWorkerRegistrar.ts");
const tsMain = read("pwa/src/mspacman/Main.ts");
const javaMain = read("desktop/src/mspacman/Main.java");
const thingJava = read("desktop/src/mspacman/Thing.java");
const thingTs = read("pwa/src/mspacman/Thing.ts");
const msPacManTs = read("pwa/src/mspacman/MsPacMan.ts");
const ghostTs = read("pwa/src/mspacman/Ghost.ts");
const fruitTargetTs = read("pwa/src/mspacman/FruitTarget.ts");
const audioPolicyQualification = read("scripts/run-audio-policy-qualification.mjs");

function sliceBetween(source, start, end) {
    const startIndex = source.indexOf(start);
    assert.notEqual(startIndex, -1, `Missing start marker: ${start}`);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.notEqual(endIndex, -1, `Missing end marker: ${end}`);
    return source.slice(startIndex, endIndex);
}

function assertBefore(source, first, second, message) {
    const firstIndex = source.indexOf(first);
    const secondIndex = source.indexOf(second);
    assert.notEqual(firstIndex, -1, `Missing ordering marker: ${first}`);
    assert.notEqual(secondIndex, -1, `Missing ordering marker: ${second}`);
    assert.ok(firstIndex < secondIndex, message);
}

test("Slick dependency is exact and available over public HTTPS", () => {
    const dependency = packageJson.dependencies["slick2d-ts"];
    const lockedDependency = packageLock.packages[""].dependencies["slick2d-ts"];
    const locked = packageLock.packages["node_modules/slick2d-ts"];

    assert.equal(dependency, lockedDependency);
    assert.match(dependency, /^https:\/\/codeload\.github\.com\/meatfighter\/slick2d-ts\/tar\.gz\/[0-9a-f]{40}$/);
    assert.equal(locked.resolved, dependency);
    assert.match(locked.version, /^\d+\.\d+\.\d+$/);
});

test("browser input delegates controller axis calibration and dense enumeration to Slick", () => {
    assert.match(humanInput, /setAdditionalControllerDirectionAxes/);
    assert.match(humanInput, /getControllerCount\(\)/);
    assert.match(humanInput, /getButtonCount\(controller\)/);
    assert.doesNotMatch(humanInput, /extraAxisBaselines|getAxisValue|CONTROLLER_INDEX_LIMIT|GAMEPAD_AXIS_LIMIT|AXIS_RECENTER_THRESHOLD/);
});

test("persistence uses public Slick random, Music, and Sound snapshot APIs", () => {
    assert.match(serializer, /main\.random\.getState\(\)/);
    assert.match(serializer, /main\.random\.setState\(snapshot\)/);
    assert.match(serializer, /music\.capturePlaybackState\(\)/);
    assert.match(serializer, /music\.restorePlaybackState\(/);
    assert.match(serializer, /isMusicPlaybackSnapshot\(snapshot\.playback\)/);
    assert.match(serializer, /sound\.capturePlaybackState\(\)/);
    assert.match(serializer, /sound\.restorePlaybackState\(/);
    assert.match(serializer, /isSoundPlaybackSnapshot\(snapshot\.playback\)/);
    assert.match(serializer, /registeredMusic\(main\)/);
    assert.match(serializer, /registeredSounds\(main\)/);
    assert.doesNotMatch(serializer, /getField\(music,\s*["'](?:looped|paused|playbackRate|buffer|positionOffset|fadeState)["']/);
    assert.doesNotMatch(serializer, /(?:getField|setField|numberField)\(main\.random/);
    assert.match(snapshot, /GAME_STATE_VERSION = 11/);
    assert.match(snapshot, /soundEffects: SoundSnapshot\[\]/);
    assert.doesNotMatch(snapshot, /FIRST_PUBLIC_GAME_STATE_VERSION/);
    assert.match(browserStorageKeys, /createStorageKey\(deploymentId, "game-state"\)/);
});

test("extended audio-policy qualification reads the stable deployment slot", () => {
    assert.doesNotMatch(audioPolicyQualification, /Object\.entries\(localStorage\)|game-state-v/);
    assert.match(audioPolicyQualification, /encodeURIComponent\(new URL\("\.", globalThis\.location\.href\)\.pathname\)/);
    assert.match(audioPolicyQualification, /localStorage\.getItem\(key\)/);
    assert.match(audioPolicyQualification, /Number\.isInteger\(snapshot\.version\)/);
});

test("save-state inspection is read-only while explicit authorized clear remains separate", () => {
    const inspection = sliceBetween(stateStore, "public inspectStoredGameState()", "private isSnapshotValid");
    assert.doesNotMatch(inspection, /this\.clear\(|removeItem\(/);
    assert.match(stateStore, /public clear\(isAuthorized: \(\) => boolean\): boolean/);
    assert.match(stateStore, /removePreference\("Ms\. Pac-Man game state", createBrowserStorageKeys\(\)\.gameState, isAuthorized\)/);
    assert.doesNotMatch(stateStore, /localStorage\.removeItem|globalThis\.localStorage\.removeItem/);
});

test("score submission browser lifetime is runtime-only while Enter Initials restore rebuilds local progress", () => {
    const mainPolicy = sliceBetween(statePolicy, "Main: {", "Thing: {");
    const persisted = sliceBetween(mainPolicy, "persisted: [", "runtime: [");
    const runtime = sliceBetween(mainPolicy, "runtime: [", "]\n    }");
    assert.doesNotMatch(persisted, /uploadComplete|submittedScore/);
    assert.match(runtime, /uploadComplete/);
    assert.match(runtime, /submittedScore/);
    assert.doesNotMatch(snapshot, /submittedScore|uploadComplete/);
    assert.match(serializer, /private restoreSubmittedInitials\(/);
    assert.match(serializer, /main\.accessScoresDatabase\(true, main\.worldIndex, main\.score, initials\)/);
    assert.match(serializer, /this\.setField\(main, "uploadComplete", true\)/);
    assert.match(enterInitialsMode, /main\.uploadComplete = true/);
    assert.match(enterInitialsMode, /main\.submittedScore = null/);
});

test("browser-native responsibilities are decomposed and generation owned", () => {
    assert.doesNotMatch(browserMain, /slick2d-ts\/slick\//);
    assert.match(browserMain, /new BrowserPreferences\(false\)/);
    assert.match(browserMain, /new RuntimeLoader\(/);
    assert.match(browserMain, /new SessionGeneration\(\)/);
    assert.match(browserMain, /sessionGeneration\.isCurrent/);
    assert.match(browserMain, /beginGameAudio\(\)/);
    assert.match(browserMain, /commitGameAudio\(audio\)/);
    assert.match(browserMain, /sessionCleanup\.run/);
    assert.doesNotMatch(browserMain, /ResourceLoader\.preloadResources|preloadAudioBuffers|unlockAudio/);
    assert.doesNotMatch(browserMain, /function safeReadVolume|function safeReadScalingPreference|function registerServiceWorker/);
    assert.match(browserPreferences, /setVolume\(value: number, persist: boolean, isAuthorized: \(\) => boolean\)/);
    assert.match(browserPreferences, /if \(!isAuthorized\(\)\) return false;/);
    assert.match(browserMain, /function currentPreferenceWriteAuthorized\(\): boolean/);
    assert.match(browserMain, /preferences\.setFullscreen\(!preferences\.fullscreen, currentPreferenceWriteAuthorized\)/);
    assert.match(browserMain, /preferences\.setScaling\(value, currentPreferenceWriteAuthorized\)/);
    assert.match(browserMain, /preferences\.reset\(\(\) => ownership\.isCurrent\(epoch\)\)/);
    assert.match(browserPreferences, /BrowserPreferences\.isScaling/);
    assert.match(runtimeLoader, /setCacheVersionResolver\(getResourceVersion\)/);
    assert.match(runtimeLoader, /runSettledBatch\(resources, RESOURCE_PRELOAD_CONCURRENCY, runRequired\)/);
    assert.match(sessionGeneration, /isCurrent\(generation: number\)/);
    assert.match(playbackSession, /let revision = 0/);
    assert.match(playbackSession, /isGameAudioCurrent/);
    assert.match(playbackSession, /isGameAudioLatest/);
    assert.match(sessionCleanup, /private error: Error \| null = null/);
    assert.match(sessionCleanup, /this\.error \?\?= new AggregateError/);
    assert.match(sessionCleanup, /return this\.error === null/);
    assert.match(serviceWorkerRegistrar, /navigator\.serviceWorker\.register/);

    const inputHandler = sliceBetween(browserMain, 'volumeInput?.addEventListener("input"', 'volumeInput?.addEventListener("change"');
    assert.doesNotMatch(inputHandler, /setVolume\(volume, true\)/);
    assert.match(browserMain, /volumeInput\?\.addEventListener\("change"/);
});

test("live-menu save/Continue keeps logical audio detached through save and reattaches before gameplay resumes", () => {
    const suspend = sliceBetween(browserMain, "function suspendGameForMenu", "async function showLiveMenuOverlay");
    assert.match(suspend, /releaseGameAudio\(\)/);
    assert.doesNotMatch(suspend, /stopAllSounds|stopAllSoundEffects|destroyGame/);

    const showMenu = sliceBetween(browserMain, "async function showLiveMenuOverlay", "async function resumeLiveGameFromMenu");
    assertBefore(showMenu, "suspendGameForMenu()", "sessionCleanup.trySave(saveCurrentGameState)", "Audio must be retired before the live game is saved.");

    const resume = sliceBetween(browserMain, "async function resumeLiveGameFromMenu", "function removeMenuOverlay");
    assertBefore(resume, "commitGameAudio(audio)", "liveGame.setBrowserSuspended(false)", "Audio must commit before the game logical clock resumes.");
    assertBefore(resume, "commitGameAudio(audio)", "liveContainer.setLoopSuspended(false)", "Audio must commit before the RAF/game loop resumes.");
});

test("stale launch cleanup is ownership-safe and exception-safe", () => {
    const launch = sliceBetween(browserMain, "async function mountGame", "function applyVolume");
    assert.match(browserMain, /function disposeStaleLaunch\(mainGame: MsPacManMain, appContainer: AppGameContainer\): void/);
    assert.match(browserMain, /sessionCleanup\.run\(\s*\(\) => mainGame\.invalidateBrowserLifetime\(\),\s*\(\) => appContainer\.destroy\(\)/s);
    assert.doesNotMatch(launch, /mainGame\.invalidateBrowserLifetime\(\);\s*appContainer\.destroy\(\);/s);
});

test("the historical /91 loop remains the Java 10 ms fixed-step cadence", () => {
    assert.match(javaMain, /nextFrameTime \+= Sys\.getTimerResolution\(\) \/ 91;/);
    assert.match(tsMain, /nextFrameTime \+= intDiv\(Sys\.getTimerResolution\(\), 91\);/);
    assert.equal(Math.trunc(1000 / 91), 10);
});

test("known Java float movement state retains explicit float32 boundaries", () => {
    assert.match(thingJava, /public float speed;/);
    assert.match(thingJava, /public float speedRemainder;/);
    assert.match(thingTs, /public speed = 0;/);
    assert.match(thingTs, /public speedRemainder = 0;/);
    assert.match(msPacManTs, /this\.speed = toFloat\(/);
    assert.match(msPacManTs, /this\.speedRemainder = toFloat\(this\.speedRemainder \+ speed\)/);
    assert.match(ghostTs, /this\.speedRemainder = toFloat\(this\.speedRemainder \+ speed\)/);
    assert.match(fruitTargetTs, /this\.speedRemainder = toFloat\(this\.speedRemainder \+ this\.speed\)/);
});
