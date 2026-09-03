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
const browserMain = read("pwa/src/app/main.ts");
const browserPreferences = read("pwa/src/app/BrowserPreferences.ts");
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

function sliceBetween(source, start, end) {
    const startIndex = source.indexOf(start);
    assert.notEqual(startIndex, -1, `Missing start marker: ${start}`);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.notEqual(endIndex, -1, `Missing end marker: ${end}`);
    return source.slice(startIndex, endIndex);
}

test("Slick dependency is exact and cloneable over public HTTPS", () => {
    const dependency = packageJson.dependencies["slick2d-ts"];
    const lockedDependency = packageLock.packages[""].dependencies["slick2d-ts"];
    const locked = packageLock.packages["node_modules/slick2d-ts"];

    assert.equal(dependency, lockedDependency);
    assert.match(dependency, /^git\+https:\/\/github\.com\/meatfighter\/slick2d-ts\.git#[0-9a-f]{40}$/);
    assert.equal(locked.resolved, dependency);
    assert.match(locked.version, /^\d+\.\d+\.\d+$/);
});

test("browser input delegates controller axis calibration and dense enumeration to Slick", () => {
    assert.match(humanInput, /setAdditionalControllerDirectionAxes/);
    assert.match(humanInput, /getControllerCount\(\)/);
    assert.match(humanInput, /getButtonCount\(controller\)/);
    assert.doesNotMatch(humanInput, /extraAxisBaselines|getAxisValue|CONTROLLER_INDEX_LIMIT|GAMEPAD_AXIS_LIMIT|AXIS_RECENTER_THRESHOLD/);
});

test("persistence uses public Slick random and music state APIs", () => {
    assert.match(serializer, /main\.random\.getState\(\)/);
    assert.match(serializer, /main\.random\.setState\(snapshot\)/);
    assert.match(serializer, /music\.isLooped\(\)/);
    assert.match(serializer, /music\.isPaused\(\)/);
    assert.match(serializer, /music\.getPlaybackRate\(\)/);
    assert.match(serializer, /music\.getDuration\(\)/);
    assert.doesNotMatch(serializer, /getField\(music,\s*["'](?:looped|paused|playbackRate|buffer)["']/);
    assert.doesNotMatch(serializer, /(?:getField|setField|numberField)\(main\.random/);
    assert.match(snapshot, /GAME_STATE_VERSION = 3/);
});

test("browser-native responsibilities are decomposed and generation owned", () => {
    assert.doesNotMatch(browserMain, /slick2d-ts\/slick\//);
    assert.match(browserMain, /new BrowserPreferences\(\)/);
    assert.match(browserMain, /new RuntimeLoader\(/);
    assert.match(browserMain, /new SessionGeneration\(\)/);
    assert.match(browserMain, /sessionGeneration\.isCurrent/);
    assert.doesNotMatch(browserMain, /ResourceLoader\.preloadResources|preloadAudioBuffers/);
    assert.doesNotMatch(browserMain, /function safeReadVolume|function safeReadScalingPreference|function registerServiceWorker/);
    assert.match(browserPreferences, /setVolume\(value: number, persist = true\)/);
    assert.match(browserPreferences, /BrowserPreferences\.isScaling/);
    assert.match(runtimeLoader, /setCacheVersionResolver\(getResourceVersion\)/);
    assert.match(runtimeLoader, /concurrency: RESOURCE_PRELOAD_CONCURRENCY/);
    assert.match(sessionGeneration, /isCurrent\(generation: number\)/);
    assert.match(serviceWorkerRegistrar, /navigator\.serviceWorker\.register/);

    const inputHandler = sliceBetween(browserMain, 'volumeInput?.addEventListener("input"', 'volumeInput?.addEventListener("change"');
    assert.doesNotMatch(inputHandler, /setVolume\(volume, true\)/);
    assert.match(browserMain, /volumeInput\?\.addEventListener\("change"/);
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
