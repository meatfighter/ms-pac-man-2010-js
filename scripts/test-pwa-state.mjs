import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pwaRoot = resolve(rootDir, "pwa");
const APP_VERSION = "test-version";
const STAGE_URL = "https://meatfighter.com/ms-pac-man-2010-staging/pwa/?v=1.0.0-stage";
const STAGE_ROTATED_URL = "https://meatfighter.com/ms-pac-man-2010-staging/pwa/?v=1.0.1-krotated";
const PRODUCTION_URL = "https://meatfighter.com/mspacman2010/pwa/?v=1.0.0-production";
const originalApiUrl = process.env.MSPACMAN_SCORE_API_URL;
const originalCacheVersion = process.env.MSPACMAN_CACHE_VERSION;
const originalHmacKey = process.env.MSPACMAN_HMAC_KEY_HEX;
const originalLocation = globalThis.location;
let EnterInitialsModeClass = null;

delete process.env.MSPACMAN_SCORE_API_URL;
delete process.env.MSPACMAN_CACHE_VERSION;
delete process.env.MSPACMAN_HMAC_KEY_HEX;

const MAIN_FIELDS = [
    "worldIndex",
    "stageIndex",
    "score",
    "lives",
    "paused",
    "musicVolume",
    "musicVolumeFadeStep",
    "fadeMusicFlag",
    "demoIndex",
    "demoMode"
];

const ATTRACT_FIELDS = [
    "dotsOffset",
    "redOffset",
    "fadeIndex",
    "fadeState",
    "state",
    "titleZ",
    "titleY",
    "titleVy",
    "y2010",
    "barsY",
    "pressEnterDelay",
    "pressEnterVisible",
    "ghostSpriteIndex",
    "ghostSpriteIndexIncrementor",
    "ghostsVisible",
    "ghostX",
    "enterPressed",
    "ticks",
    "countDown"
];

const PLAYING_FIELDS = [
    "pelletCountFraction",
    "pelletCount",
    "pelletsRemaining",
    "tileMap",
    "typeMap",
    "regionCounts",
    "exitIndex",
    "exitDelay",
    "chaseMode",
    "chaseModeToggleDelay",
    "ghostsBlue",
    "ghostsBlueOffset",
    "ghostsBlueTimer",
    "showGhostPoints",
    "showGhostPointsTimer",
    "ghostPointsIndex",
    "energizerLocations",
    "energizersVisible",
    "energizersVisibleTimer",
    "finished",
    "finishedTimer",
    "finishedWhite",
    "finishedBlinkTimer",
    "fruitTargetPresent",
    "fruitTargetTimer",
    "redEnergizerPresent",
    "greenEnergizerPresent",
    "energizerTimer",
    "playerKilledFlag",
    "musicFadeOutTimer",
    "playerSpiraling",
    "spiralTimer",
    "readyTimer",
    "stageMessage",
    "fruitOdds",
    "redPelletOdds",
    "exitDelayTarget",
    "fadeIndex",
    "fadeState",
    "fadeReason",
    "gameOver",
    "gameOverTimer"
];

const MSPACMAN_FIELDS = [
    "x",
    "y",
    "speed",
    "speedRemainder",
    "direction",
    "spriteIndex",
    "spriteIndexIncrementor",
    "pellotDampensSpeed",
    "pellotDampensSpeedCount",
    "corneringEnhancesSpeed",
    "corneringEnhancesSpeedCount",
    "speedBoost",
    "speedBoostTimer"
];

const GHOST_FIELDS = [
    "x",
    "y",
    "speed",
    "speedRemainder",
    "direction",
    "blue",
    "eyeBalls",
    "ghostIndex",
    "spriteIndex",
    "spriteIndexIncrementor",
    "targetX",
    "targetY",
    "inHome",
    "exitingHome",
    "enteringHome"
];

const FRUIT_TARGET_FIELDS = [
    "x",
    "y",
    "speed",
    "speedRemainder",
    "direction",
    "fruitIndex",
    "yOffset",
    "yOffsetAngle",
    "goingAroundHome",
    "clockwise",
    "aroundHomeIndex",
    "exiting",
    "eatenTimer",
    "eaten"
];

class MemoryStorage {
    #values = new Map();

    getItem(key) {
        return this.#values.get(String(key)) ?? null;
    }

    setItem(key, value) {
        this.#values.set(String(key), String(value));
    }

    removeItem(key) {
        this.#values.delete(String(key));
    }

    clear() {
        this.#values.clear();
    }
}

const server = await createServer({
    root: pwaRoot,
    appType: "custom",
    logLevel: "silent",
    server: {
        middlewareMode: true
    }
});

try {
    const { MsPacManGameStateSerializer, isValidMsPacManGameStateSnapshot, isValidSnapshotForLoadedResources, isValidStageIndexForMode } =
        await server.ssrLoadModule("/src/mspacman/persistence/MsPacManGameStateSerializer.ts");
    const { MsPacManGameStateStore } = await server.ssrLoadModule("/src/mspacman/persistence/MsPacManGameStateStore.ts");
    ({ EnterInitialsMode: EnterInitialsModeClass } = await server.ssrLoadModule("/src/mspacman/EnterInitialsMode.ts"));
    const { createBrowserStorageKeys } = await server.ssrLoadModule("/src/app/BrowserStorageKeys.ts");
    const { BrowserPreferences } = await server.ssrLoadModule("/src/app/BrowserPreferences.ts");
    const { SoundStore } = await import("slick2d-ts");

    await runTest("browser preferences recheck ownership at every durable write and reset removal", () => {
        const storage = installMemoryLocalStorage();
        setTestLocation(STAGE_URL);
        const keys = createBrowserStorageKeys();
        storage.setItem(keys.volume, "25");
        storage.setItem(keys.scaling, "crisp");
        storage.setItem(keys.fullscreen, "true");
        storage.setItem(keys.gameState, "protected-save");

        const preferences = new BrowserPreferences();

        assert.equal(preferences.setVolume(0.8, true, () => false), false);
        assert.equal(storage.getItem(keys.volume), "25");
        assert.equal(preferences.setScaling("smooth", () => false), false);
        assert.equal(storage.getItem(keys.scaling), "crisp");
        assert.equal(preferences.setFullscreen(false, () => false), false);
        assert.equal(storage.getItem(keys.fullscreen), "true");
        assert.equal(preferences.clearGameState(() => false), false);
        assert.equal(storage.getItem(keys.gameState), "protected-save");

        let checks = 0;
        const resetAuthorized = () => ++checks <= 2;
        assert.equal(preferences.reset(resetAuthorized), false);
        assert.equal(storage.getItem(keys.gameState), null, "first reset removal may commit while ownership is valid");
        assert.equal(storage.getItem(keys.volume), "25", "reset must stop before later keys after ownership revocation");
        assert.equal(storage.getItem(keys.scaling), "crisp");
        assert.equal(storage.getItem(keys.fullscreen), "true");
    });

    await runTest("save inspection rejects malformed and invalid snapshots without deleting them", () => {
        const storage = installMemoryLocalStorage();
        const store = new MsPacManGameStateStore(APP_VERSION);
        setTestLocation(STAGE_URL);
        const storageKey = createBrowserStorageKeys().gameState;

        storage.setItem(storageKey, "{");
        assert.equal(store.hasValidSave(), false);
        assert.equal(storage.getItem(storageKey), "{");

        const invalidCurrent = JSON.stringify({ version: 5 });
        storage.setItem(storageKey, invalidCurrent);
        assert.equal(store.hasValidSave(), false);
        assert.equal(storage.getItem(storageKey), invalidCurrent);
    });

    await runTest("future saves are protected until an explicit owned clear", () => {
        const storage = installMemoryLocalStorage();
        const store = new MsPacManGameStateStore(APP_VERSION);
        setTestLocation(STAGE_URL);
        const storageKey = createBrowserStorageKeys().gameState;

        const futureSnapshot = JSON.stringify({ version: 999, futureShape: true });
        storage.setItem(storageKey, futureSnapshot);
        assert.equal(store.hasValidSave(), false);
        assert.deepEqual(store.inspectStoredGameState(), { status: "unsupported-future", version: 999 });
        assert.equal(storage.getItem(storageKey), futureSnapshot);

        assert.deepEqual(store.save(createFakeMain("attract", "source"), () => true), {
            saved: false,
            reason: "unsupported-future"
        });
        assert.equal(storage.getItem(storageKey), futureSnapshot);

        assert.equal(store.clear(() => true), true);
        assert.equal(storage.getItem(storageKey), null);
        assert.deepEqual(store.save(createFakeMain("attract", "source"), () => true), { saved: true });
        assert.notEqual(storage.getItem(storageKey), null);
    });

    await runTest("save authority is checked at the Pac storage write boundary", () => {
        const storage = installMemoryLocalStorage();
        const store = new MsPacManGameStateStore(APP_VERSION);
        setTestLocation(STAGE_URL);
        const storageKey = createBrowserStorageKeys().gameState;
        const source = createFakeMain("attract", "source");

        assert.deepEqual(store.save(source, () => false), { saved: false, reason: "not-authorized" });
        assert.equal(storage.getItem(storageKey), null);

        assert.deepEqual(store.save(source, () => true), { saved: true });
        const previous = storage.getItem(storageKey);
        assert.notEqual(previous, null);

        const replacement = createFakeMain("attract", "source", { score: 33330 });
        assert.deepEqual(store.save(replacement, () => false), { saved: false, reason: "not-authorized" });
        assert.equal(storage.getItem(storageKey), previous);
    });

    await runTest("browser storage keys isolate save state by deployment path", () => {
        const storage = installMemoryLocalStorage();
        const store = new MsPacManGameStateStore(APP_VERSION);
        const stageSource = createFakeMain("attract", "source", { score: 11110 });
        const productionSource = createFakeMain("attract", "source", { score: 22220 });

        setTestLocation(STAGE_URL);
        const stageKeys = createBrowserStorageKeys();
        assert.deepEqual(store.save(stageSource, () => true), { saved: true });
        assert.equal(store.hasValidSave(), true);
        const stageSnapshot = storage.getItem(stageKeys.gameState);
        assert.notEqual(stageSnapshot, null);

        setTestLocation(PRODUCTION_URL);
        const productionKeys = createBrowserStorageKeys();
        assert.notEqual(stageKeys.gameState, productionKeys.gameState);
        assert.equal(store.hasValidSave(), false);
        assert.deepEqual(store.save(productionSource, () => true), { saved: true });
        const productionSnapshot = storage.getItem(productionKeys.gameState);
        assert.notEqual(productionSnapshot, null);
        assert.notEqual(stageSnapshot, productionSnapshot);

        setTestLocation(STAGE_URL);
        assert.equal(store.hasValidSave(), true);
        storage.setItem(stageKeys.gameState, "{");
        assert.equal(store.hasValidSave(), false);
        assert.equal(storage.getItem(stageKeys.gameState), "{");
        assert.equal(storage.getItem(productionKeys.gameState), productionSnapshot);

        assert.deepEqual(store.save(stageSource, () => true), { saved: true });
        assert.notEqual(storage.getItem(stageKeys.gameState), productionSnapshot);
        assert.equal(storage.getItem(productionKeys.gameState), productionSnapshot);
    });

    await runTest("browser storage keys isolate volume and ignore release query changes", () => {
        const storage = installMemoryLocalStorage();
        const stageKeys = createBrowserStorageKeys(STAGE_URL);
        const stageRotatedKeys = createBrowserStorageKeys(STAGE_ROTATED_URL);
        const productionKeys = createBrowserStorageKeys(PRODUCTION_URL);

        assert.equal(stageKeys.deploymentId, stageRotatedKeys.deploymentId);
        assert.equal(stageKeys.gameState, stageRotatedKeys.gameState);
        assert.equal(stageKeys.scaling, stageRotatedKeys.scaling);
        assert.equal(stageKeys.volume, stageRotatedKeys.volume);
        assert.notEqual(stageKeys.deploymentId, productionKeys.deploymentId);
        assert.notEqual(stageKeys.scaling, productionKeys.scaling);
        assert.notEqual(stageKeys.volume, productionKeys.volume);

        storage.setItem(stageKeys.scaling, "crisp");
        storage.setItem(productionKeys.scaling, "smooth");
        assert.equal(storage.getItem(stageRotatedKeys.scaling), "crisp");
        assert.equal(storage.getItem(productionKeys.scaling), "smooth");

        storage.setItem(stageKeys.volume, "10");
        storage.setItem(productionKeys.volume, "80");
        assert.equal(storage.getItem(stageRotatedKeys.volume), "10");
        assert.equal(storage.getItem(productionKeys.volume), "80");
    });

    await runTest("serializer rejects malformed snapshots", () => {
        const serializer = new MsPacManGameStateSerializer();
        const snapshot = serializer.createSnapshot(createFakeMain("attract", "source"), APP_VERSION);
        assert.equal(isValidMsPacManGameStateSnapshot(snapshot), true);

        const unsupportedVersion = clone(snapshot);
        unsupportedVersion.version = 999;
        assert.equal(serializer.isSupportedSnapshot(unsupportedVersion), false);

        const missingMainField = clone(snapshot);
        delete missingMainField.mainFields.score;
        assert.equal(serializer.isSupportedSnapshot(missingMainField), false);

        const extraModeField = clone(snapshot);
        extraModeField.mode.fields.extra = 1;
        assert.equal(serializer.isSupportedSnapshot(extraModeField), false);

        const obsoleteSubmittedScoreField = clone(snapshot);
        obsoleteSubmittedScoreField.submittedScore = { world: 0, score: 12340, initials: "AAA" };
        assert.equal(serializer.isSupportedSnapshot(obsoleteSubmittedScoreField), false);

        const obsoleteUploadCompleteField = clone(snapshot);
        obsoleteUploadCompleteField.mainFields.uploadComplete = true;
        assert.equal(serializer.isSupportedSnapshot(obsoleteUploadCompleteField), false);

        const playingSnapshot = serializer.createSnapshot(createFakeMain("playing", "source"), APP_VERSION);
        assert.equal(serializer.isSupportedSnapshot(playingSnapshot), true);

        const demoWithoutRobotInput = clone(playingSnapshot);
        demoWithoutRobotInput.mainFields.demoMode = true;
        demoWithoutRobotInput.mode.inputRobotIndex = null;
        assert.equal(serializer.isSupportedSnapshot(demoWithoutRobotInput), false);

        const robotInputOutsideDemo = clone(playingSnapshot);
        robotInputOutsideDemo.mode.inputRobotIndex = 0;
        assert.equal(serializer.isSupportedSnapshot(robotInputOutsideDemo), false);

        const pausedDemo = clone(playingSnapshot);
        pausedDemo.mainFields.demoMode = true;
        pausedDemo.mainFields.paused = true;
        pausedDemo.mode.inputRobotIndex = 0;
        assert.equal(serializer.isSupportedSnapshot(pausedDemo), false);

        const validDemo = clone(playingSnapshot);
        validDemo.mainFields.demoMode = true;
        validDemo.mainFields.demoIndex = 1;
        validDemo.mainFields.worldIndex = 0;
        validDemo.mainFields.stageIndex = 0;
        validDemo.mainFields.lives = 5;
        validDemo.mode.inputRobotIndex = 0;
        assert.equal(serializer.isSupportedSnapshot(validDemo), true);

        const wrongDemoInput = clone(validDemo);
        wrongDemoInput.mode.inputRobotIndex = 1;
        assert.equal(serializer.isSupportedSnapshot(wrongDemoInput), false);

        const wrongDemoStage = clone(validDemo);
        wrongDemoStage.mainFields.stageIndex = 1;
        assert.equal(serializer.isSupportedSnapshot(wrongDemoStage), false);

        const wrongDemoWorld = clone(validDemo);
        wrongDemoWorld.mainFields.worldIndex = 1;
        assert.equal(serializer.isSupportedSnapshot(wrongDemoWorld), false);

        const wrongDemoLives = clone(validDemo);
        wrongDemoLives.mainFields.lives = 4;
        assert.equal(serializer.isSupportedSnapshot(wrongDemoLives), false);

        const wrappedDemo = clone(validDemo);
        wrappedDemo.mainFields.demoIndex = 0;
        wrappedDemo.mainFields.worldIndex = 3;
        wrappedDemo.mainFields.stageIndex = 3;
        wrappedDemo.mainFields.lives = 5;
        wrappedDemo.mode.inputRobotIndex = 3;
        assert.equal(serializer.isSupportedSnapshot(wrappedDemo), true);

        const terminalDemoCursor = clone(playingSnapshot);
        terminalDemoCursor.robotInputs[0].index = 4390;
        assert.equal(serializer.isSupportedSnapshot(terminalDemoCursor), true);

        const excessiveDemoCursor = clone(playingSnapshot);
        excessiveDemoCursor.robotInputs[0].index = 4391;
        assert.equal(serializer.isSupportedSnapshot(excessiveDemoCursor), false);

        const excessiveFourthDemoCursor = clone(playingSnapshot);
        excessiveFourthDemoCursor.robotInputs[3].index = 3677;
        assert.equal(serializer.isSupportedSnapshot(excessiveFourthDemoCursor), false);

        const validInitials = serializer.createSnapshot(
            createFakeMain("enterInitials", "source", { initials: "CAT", enterPressed: true }),
            APP_VERSION
        );
        assert.equal(serializer.isSupportedSnapshot(validInitials), true);

        const malformedInitials = clone(validInitials);
        malformedInitials.mode.fields.initials = "cat";
        assert.equal(serializer.isSupportedSnapshot(malformedInitials), false);

        const shortInitials = clone(validInitials);
        shortInitials.mode.fields.initials = "AA";
        assert.equal(serializer.isSupportedSnapshot(shortInitials), false);

        const impossibleSubmittedCursor = clone(validInitials);
        impossibleSubmittedCursor.mode.fields.editingIndex = 1;
        assert.equal(serializer.isSupportedSnapshot(impossibleSubmittedCursor), false);

        const impossibleBlinkTimer = clone(validInitials);
        impossibleBlinkTimer.mode.fields.blinkTimer = 45;
        assert.equal(serializer.isSupportedSnapshot(impossibleBlinkTimer), false);
    });

    await runTest("stage index validation follows reachable mode context including completed-world sentinel 8", () => {
        const serializer = new MsPacManGameStateSerializer();

        assert.equal(isValidStageIndexForMode(7, "playing"), true);
        assert.equal(isValidStageIndexForMode(8, "playing"), false);
        assert.equal(isValidStageIndexForMode(1, "act1"), true);
        assert.equal(isValidStageIndexForMode(2, "act1"), false);
        assert.equal(isValidStageIndexForMode(7, "act7"), true);
        assert.equal(isValidStageIndexForMode(8, "ending"), true);
        assert.equal(isValidStageIndexForMode(7, "ending"), false);
        assert.equal(isValidStageIndexForMode(0, "attract"), true);
        assert.equal(isValidStageIndexForMode(8, "attract"), false);
        assert.equal(isValidStageIndexForMode(0, "intro"), true);
        assert.equal(isValidStageIndexForMode(8, "intro"), false);
        assert.equal(isValidStageIndexForMode(8, "enterInitials"), true);
        assert.equal(isValidStageIndexForMode(8, "hallOfFame"), true);
        assert.equal(isValidStageIndexForMode(8, "selectWorld"), true);

        const endingSnapshot = serializer.createSnapshot(createFakeMain("ending", "source", { stageIndex: 8 }), APP_VERSION);
        assert.equal(serializer.isSupportedSnapshot(endingSnapshot), true, "genuine ending sentinel must be saveable");

        const wrongEndingIndex = clone(endingSnapshot);
        wrongEndingIndex.mainFields.stageIndex = 7;
        assert.equal(serializer.isSupportedSnapshot(wrongEndingIndex), false);

        const playingSnapshot = serializer.createSnapshot(createFakeMain("playing", "source", { stageIndex: 7 }), APP_VERSION);
        assert.equal(serializer.isSupportedSnapshot(playingSnapshot), true);
        const impossiblePlayingIndex = clone(playingSnapshot);
        impossiblePlayingIndex.mainFields.stageIndex = 8;
        assert.equal(serializer.isSupportedSnapshot(impossiblePlayingIndex), false);

        const postEndingInitials = serializer.createSnapshot(
            createFakeMain("enterInitials", "source", { stageIndex: 8, initials: "CAT", enterPressed: false }),
            APP_VERSION
        );
        assert.equal(serializer.isSupportedSnapshot(postEndingInitials), true);
    });

    await runTest("playing snapshot validator rejects impossible numeric and relationship states", () => {
        const serializer = new MsPacManGameStateSerializer();
        const valid = serializer.createSnapshot(createFakeMain("playing", "source"), APP_VERSION);
        assert.equal(serializer.isSupportedSnapshot(valid), true);

        const fractionalScore = clone(valid);
        fractionalScore.mainFields.score = 10.5;
        assert.equal(serializer.isSupportedSnapshot(fractionalScore), false);

        const excessiveLives = clone(valid);
        excessiveLives.mainFields.lives = 7;
        assert.equal(serializer.isSupportedSnapshot(excessiveLives), false);

        const invalidVolume = clone(valid);
        invalidVolume.mainFields.musicVolume = 1.01;
        assert.equal(serializer.isSupportedSnapshot(invalidVolume), false);

        const excessiveRemaining = clone(valid);
        excessiveRemaining.mode.fields.pelletsRemaining = excessiveRemaining.mode.fields.pelletCount + 1;
        assert.equal(serializer.isSupportedSnapshot(excessiveRemaining), false);

        const invalidRegionCount = clone(valid);
        invalidRegionCount.mode.fields.regionCounts[0] = 5;
        assert.equal(serializer.isSupportedSnapshot(invalidRegionCount), false);

        const invalidFadeState = clone(valid);
        invalidFadeState.mode.fields.fadeState = 3;
        assert.equal(serializer.isSupportedSnapshot(invalidFadeState), false);

        const invalidStageMessage = clone(valid);
        invalidStageMessage.mode.fields.stageMessage = "READY!";
        assert.equal(serializer.isSupportedSnapshot(invalidStageMessage), false);

        const conflictingSpawn = clone(valid);
        conflictingSpawn.mode.fields.redEnergizerPresent = true;
        assert.equal(serializer.isSupportedSnapshot(conflictingSpawn), false);

        const invalidRemainder = clone(valid);
        invalidRemainder.mode.mspacman.fields.speedRemainder = 1;
        assert.equal(serializer.isSupportedSnapshot(invalidRemainder), false);

        const invalidSprite = clone(valid);
        invalidSprite.mode.mspacman.fields.spriteIndex = 4;
        assert.equal(serializer.isSupportedSnapshot(invalidSprite), false);

        const swappedGhostIdentity = clone(valid);
        swappedGhostIdentity.mode.ghosts[0].fields.ghostIndex = 1;
        assert.equal(serializer.isSupportedSnapshot(swappedGhostIdentity), false);

        const missingEatenGhost = clone(valid);
        missingEatenGhost.mode.eatenGhostIndex = null;
        assert.equal(serializer.isSupportedSnapshot(missingEatenGhost), false);

        const eatenGhostWithoutEyes = clone(valid);
        eatenGhostWithoutEyes.mode.ghosts[eatenGhostWithoutEyes.mode.eatenGhostIndex].fields.eyeBalls = false;
        assert.equal(serializer.isSupportedSnapshot(eatenGhostWithoutEyes), false);

        const invalidAroundHome = clone(valid);
        invalidAroundHome.mode.fruitTarget.fields.aroundHomeIndex = 5;
        assert.equal(serializer.isSupportedSnapshot(invalidAroundHome), false);

        const invalidEatenTimer = clone(valid);
        invalidEatenTimer.mode.fruitTarget.fields.eatenTimer = 91;
        assert.equal(serializer.isSupportedSnapshot(invalidEatenTimer), false);

        const exitingWithoutPath = clone(valid);
        exitingWithoutPath.mode.fruitTarget.exitPath = null;
        assert.equal(serializer.isSupportedSnapshot(exitingWithoutPath), false);
    });

    await runTest("loaded stage resources constrain playing snapshots before restore", () => {
        const serializer = new MsPacManGameStateSerializer();
        const main = createFakeMain("playing", "source");
        const valid = serializer.createSnapshot(main, APP_VERSION);
        assert.equal(isValidSnapshotForLoadedResources(main, valid), true);

        const wrongRegionShape = clone(valid);
        wrongRegionShape.mode.fields.regionCounts = [1, 2];
        assert.equal(isValidSnapshotForLoadedResources(main, wrongRegionShape), false);

        const wrongPelletTotal = clone(valid);
        wrongPelletTotal.mode.fields.pelletCount = 9;
        wrongPelletTotal.mode.fields.pelletsRemaining = 8;
        assert.equal(serializer.isSupportedSnapshot(wrongPelletTotal), true, "pure shape does not own resource pellet totals");
        assert.equal(isValidSnapshotForLoadedResources(main, wrongPelletTotal), false);

        const wrongStageLabel = clone(valid);
        wrongStageLabel.mode.fields.stageMessage = "STAGE 4 OF 8";
        assert.equal(serializer.isSupportedSnapshot(wrongStageLabel), true, "label is structurally valid but belongs to another stage");
        assert.equal(isValidSnapshotForLoadedResources(main, wrongStageLabel), false);

        const wrongEnergizerLocation = clone(valid);
        wrongEnergizerLocation.mode.fields.energizerLocations[0] = [2, 1];
        assert.equal(serializer.isSupportedSnapshot(wrongEnergizerLocation), true);
        assert.equal(isValidSnapshotForLoadedResources(main, wrongEnergizerLocation), false);

        const foreignExitPath = clone(valid);
        foreignExitPath.mode.fruitTarget.exitPath = createMatrix(31, 28, 4);
        assert.equal(serializer.isSupportedSnapshot(foreignExitPath), true);
        assert.equal(isValidSnapshotForLoadedResources(main, foreignExitPath), false);
    });

    await runTest("resource-invalid restore is rejected before destructive or partial mutation", () => {
        const serializer = new MsPacManGameStateSerializer();
        const source = createFakeMain("playing", "source");
        const target = createFakeMain("playing", "target");
        const snapshot = serializer.createSnapshot(source, APP_VERSION);
        snapshot.mode.fields.pelletCount = 9;
        snapshot.mode.fields.pelletsRemaining = 8;
        assert.equal(serializer.isSupportedSnapshot(snapshot), true);
        assert.equal(isValidSnapshotForLoadedResources(target, snapshot), false);

        const before = pickFields(target, MAIN_FIELDS);
        assert.throws(() => serializer.restoreSnapshot(target, createGameContainer(), snapshot), /Unsupported saved game state/);
        assert.deepEqual(pickFields(target, MAIN_FIELDS), before);
        assert.equal(target.stopAllSoundsCalls, 0, "validation must complete before audio or state teardown");
        assert.equal(target.input.clearCalls, 0, "validation failure must not consume live input state");
    });

    await runTest("shipped fruit exit maps use only the persisted 0..4 direction domain", () => {
        const seen = new Set();
        for (let world = 0; world < 4; world++) {
            for (let stage = 0; stage < 8; stage++) {
                const bytes = readFileSync(resolve(rootDir, "pwa", "public", "stages", `stage_${world}_${stage}.dat`));
                for (const direction of readStageExitDirections(bytes)) {
                    assert.ok(direction >= 1 && direction <= 4, `stage_${world}_${stage}.dat has invalid exit direction ${direction}`);
                    seen.add(direction);
                }
            }
        }
        assert.equal(seen.has(4), true, "shipped stage exit maps must exercise UP direction 4");

        const serializer = new MsPacManGameStateSerializer();
        const snapshot = serializer.createSnapshot(createFakeMain("playing", "exit-direction"), APP_VERSION);
        snapshot.mode.fruitTarget.exitPath = createMatrix(31, 28, 0);
        snapshot.mode.fruitTarget.exitPath[0][0] = 4;
        assert.equal(serializer.isSupportedSnapshot(snapshot), true);
    });

    await runTest("store saves and restores a non-playing mode snapshot", () => {
        const storage = installMemoryLocalStorage();
        const store = new MsPacManGameStateStore(APP_VERSION);
        setTestLocation(STAGE_URL);
        const storageKey = createBrowserStorageKeys().gameState;
        const source = createFakeMain("attract", "source");
        const target = createFakeMain("attract", "target");
        const gc = createGameContainer();

        assert.deepEqual(store.save(source, () => true), { saved: true });
        assert.equal(store.hasValidSave(), true);
        assert.notEqual(storage.getItem(storageKey), null);

        const savedText = storage.getItem(storageKey);
        assert.notEqual(savedText, null);
        const savedSnapshot = JSON.parse(savedText);
        assert.equal(savedSnapshot.version, 8);
        assert.equal("audioSettings" in savedSnapshot, false);
        assert.equal("submittedScore" in savedSnapshot, false);
        assert.equal("uploadComplete" in savedSnapshot.mainFields, false);

        assert.equal(store.restore(target, gc), true);
        assert.deepEqual(pickFields(target, MAIN_FIELDS), pickFields(source, MAIN_FIELDS));
        assert.deepEqual(pickFields(target.mode, ATTRACT_FIELDS), pickFields(source.mode, ATTRACT_FIELDS));
        assert.deepEqual(target.random, source.random);
        assert.deepEqual(
            target.robotInputs.map((input) => input.index),
            source.robotInputs.map((input) => input.index)
        );
        assert.equal(target.browserSuspended, true);
        assert.equal(target.stopAllSoundsCalls, 1);
        assert.equal(target.stopAllSoundEffectsCalls >= 1, true);
        assert.equal(target.input.clearCalls > 0, true);
    });

    await runTest("store preserves saved snapshot when restore throws", () => {
        const storage = installMemoryLocalStorage();
        const store = new MsPacManGameStateStore(APP_VERSION);
        setTestLocation(STAGE_URL);
        const storageKey = createBrowserStorageKeys().gameState;
        const source = createFakeMain("attract", "source");
        const target = createFakeMain("attract", "target");

        assert.deepEqual(store.save(source, () => true), { saved: true });
        const savedSnapshot = storage.getItem(storageKey);
        assert.notEqual(savedSnapshot, null);
        target.getModeForStateRestore = () => {
            throw new Error("Injected restore failure.");
        };

        const soundStore = SoundStore.get();
        soundStore.setMusicOn(false);
        soundStore.setSoundsOn(true);

        const originalWarn = console.warn;
        let warnCalls = 0;
        console.warn = (...args) => {
            warnCalls++;
            assert.equal(String(args[0]).includes("Unable to restore MS Pac-Man game state."), true);
        };
        try {
            assert.equal(store.restore(target, createGameContainer()), false);
            assert.equal(soundStore.musicOn(), false, "failed restore changed application Music policy");
            assert.equal(soundStore.soundsOn(), true, "failed restore changed application Sound policy");
        } finally {
            console.warn = originalWarn;
            soundStore.destroy();
        }
        assert.equal(warnCalls, 1);
        assert.equal(storage.getItem(storageKey), savedSnapshot);
    });

    await runTest("serializer restores playing mode fields and runtime bindings", () => {
        const serializer = new MsPacManGameStateSerializer();
        const source = createFakeMain("playing", "source");
        const sourceMusic = source.stageMusic[1];
        sourceMusic.looped = true;
        sourceMusic.position = 143;
        sourceMusic.volume = 0.625;
        sourceMusic.playingState = true;
        source.currentMusic = sourceMusic;

        const snapshot = serializer.createSnapshot(source, APP_VERSION);
        assert.equal("audioSettings" in snapshot, false);
        assert.equal(isValidMsPacManGameStateSnapshot(snapshot), true);
        assert.equal(snapshot.mode.id, "playing");
        assert.equal(snapshot.music.id, "stage:1");
        assert.equal(snapshot.music.playback.transport, "playing");
        assert.equal(snapshot.music.playback.looped, true);
        assert.equal(snapshot.music.playback.positionSeconds, 23);
        assert.equal(snapshot.music.playback.volume, 0.625);

        const target = createFakeMain("playing", "target");
        const targetMusic = target.stageMusic[1];
        const gc = createGameContainer();

        serializer.restoreSnapshot(target, gc, snapshot);

        assert.deepEqual(pickFields(target, MAIN_FIELDS), pickFields(source, MAIN_FIELDS));
        assert.deepEqual(pickFields(target.playingMode, PLAYING_FIELDS), pickFields(source.playingMode, PLAYING_FIELDS));
        assert.deepEqual(pickFields(target.playingMode.mspacman, MSPACMAN_FIELDS), pickFields(source.playingMode.mspacman, MSPACMAN_FIELDS));
        assert.deepEqual(
            target.playingMode.ghosts.map((ghost) => pickFields(ghost, GHOST_FIELDS)),
            source.playingMode.ghosts.map((ghost) => pickFields(ghost, GHOST_FIELDS))
        );
        assert.deepEqual(pickFields(target.playingMode.fruitTarget, FRUIT_TARGET_FIELDS), pickFields(source.playingMode.fruitTarget, FRUIT_TARGET_FIELDS));
        assert.deepEqual(target.playingMode.fruitTarget.exitPath, source.playingMode.fruitTarget.exitPath);
        assert.notEqual(target.playingMode.fruitTarget.exitPath, source.playingMode.fruitTarget.exitPath);
        assert.equal(target.playingMode.main, target);
        assert.equal(target.playingMode.input, target.input);
        assert.equal(target.playingMode.tiles, target.tiles[target.stageIndex]);
        assert.equal(target.playingMode.regionMap, target.stages[target.worldIndex][target.stageIndex].regionMap);
        assert.equal(target.playingMode.homeTree, target.stages[target.worldIndex][target.stageIndex].homeTree);
        assert.equal(target.playingMode.leftExitMaps, target.stages[target.worldIndex][target.stageIndex].leftExitMaps);
        assert.equal(target.playingMode.rightExitMaps, target.stages[target.worldIndex][target.stageIndex].rightExitMaps);
        assert.equal(target.playingMode.mspacman.input, target.input);
        assert.equal(target.playingMode.mspacman.main, target);
        assert.equal(target.playingMode.mspacman.playingMode, target.playingMode);
        assert.equal(target.playingMode.eatenGhost, target.playingMode.ghosts[2]);

        for (const ghost of target.playingMode.ghosts) {
            assert.equal(ghost.main, target);
            assert.equal(ghost.playingMode, target.playingMode);
            assert.equal(ghost.sprites, target.ghostSprites[ghost.ghostIndex]);
        }

        assert.equal(target.currentMusic, targetMusic);
        assert.equal(targetMusic.position, 23);
        assert.equal(targetMusic.volume, 0.625);
        assert.equal(targetMusic.stopCalls, 1);
        assert.equal(target.browserSuspended, true);
    });

    await runTest("paused playing snapshot restores paused logical Music without global audio policy", () => {
        const serializer = new MsPacManGameStateSerializer();
        const source = createFakeMain("playing", "paused-source");
        const sourceMusic = source.stageMusic[0];
        source.paused = true;
        sourceMusic.looped = true;
        sourceMusic.position = 19.5;
        sourceMusic.paused = true;
        sourceMusic.playingState = false;
        source.currentMusic = sourceMusic;

        const snapshot = serializer.createSnapshot(source, APP_VERSION);
        assert.equal(snapshot.mainFields.paused, true);
        assert.equal(snapshot.music.id, "stage:0");
        assert.equal(snapshot.music.playback.transport, "paused");
        assert.equal(snapshot.music.playback.positionSeconds, 19.5);
        assert.equal("audioSettings" in snapshot, false);

        const contradictoryUnpaused = clone(snapshot);
        contradictoryUnpaused.mainFields.paused = false;
        assert.equal(isValidMsPacManGameStateSnapshot(contradictoryUnpaused), false);

        const contradictoryPlayingTransport = clone(snapshot);
        contradictoryPlayingTransport.music.playback.transport = "playing";
        assert.equal(isValidMsPacManGameStateSnapshot(contradictoryPlayingTransport), false);

        const pausedOutsideGameplay = clone(snapshot);
        pausedOutsideGameplay.mode = {
            id: "attract",
            fields: createMode("attract", "source")
        };
        assert.equal(isValidMsPacManGameStateSnapshot(pausedOutsideGameplay), false);

        const target = createFakeMain("playing", "paused-target");
        const targetMusic = target.stageMusic[0];
        serializer.restoreSnapshot(target, createGameContainer(), snapshot);

        assert.equal(target.paused, true);
        assert.equal(target.currentMusic, targetMusic);
        assert.equal(targetMusic.paused, true);
        assert.equal(targetMusic.playingState, false);
        assert.equal(targetMusic.position, 19.5);
    });

    await runTest("submitted-score browser lifetime is absent from durable snapshots", () => {
        const serializer = new MsPacManGameStateSerializer();
        const source = createFakeMain("attract", "source", {
            submittedScore: { world: 1, score: 12340, initials: "CAT" }
        });
        source.uploadComplete = false;

        const snapshot = serializer.createSnapshot(source, APP_VERSION);
        assert.equal("submittedScore" in snapshot, false);
        assert.equal("uploadComplete" in snapshot.mainFields, false);
    });

    await runTest("restoring a submitted initials screen rebuilds local score progress without replaying browser request state", () => {
        const serializer = new MsPacManGameStateSerializer();
        const source = createFakeMain("enterInitials", "source", {
            score: 12340,
            worldIndex: 1,
            initials: "CAT",
            enterPressed: true
        });
        const snapshot = serializer.createSnapshot(source, APP_VERSION);
        assert.equal(snapshot.mode.id, "enterInitials");
        assert.equal(snapshot.mode.fields.enterPressed, true);
        assert.equal(snapshot.mode.fields.initials, "CAT");
        assert.equal("submittedScore" in snapshot, false);
        assert.equal("uploadComplete" in snapshot.mainFields, false);

        const target = createFakeMain("enterInitials", "target", {
            score: 12340,
            worldIndex: 1,
            initials: "DOG",
            enterPressed: false
        });
        target.uploadComplete = false;
        serializer.restoreSnapshot(target, createGameContainer(), snapshot);

        assert.deepEqual(target.scoreAccessCalls, [{ upload: true, world: 1, score: 12340, initials: "CAT" }]);
        assert.deepEqual(target.submittedScore, { world: 1, score: 12340, initials: "CAT" });
        assert.equal(target.uploadComplete, true, "dead browser submission lifetime must be completed after restore");
    });
} finally {
    restoreEnv("MSPACMAN_SCORE_API_URL", originalApiUrl);
    restoreEnv("MSPACMAN_CACHE_VERSION", originalCacheVersion);
    restoreEnv("MSPACMAN_HMAC_KEY_HEX", originalHmacKey);
    restoreLocation();
    await server.close();
}

async function runTest(name, fn) {
    try {
        await fn();
        console.log(`ok - ${name}`);
    } catch (error) {
        console.error(`not ok - ${name}`);
        console.error(error);
        process.exitCode = 1;
    }
}

function installMemoryLocalStorage() {
    const storage = new MemoryStorage();
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: storage
    });
    return storage;
}

function setTestLocation(href) {
    Object.defineProperty(globalThis, "location", {
        configurable: true,
        value: new URL(href)
    });
}

function restoreLocation() {
    if (originalLocation === undefined) {
        delete globalThis.location;
    } else {
        Object.defineProperty(globalThis, "location", {
            configurable: true,
            value: originalLocation
        });
    }
}

function createFakeMain(modeId, variant, options = {}) {
    const main = {
        ...createMainFields(variant, options),
        input: createInput(),
        random: createRandom(variant),
        highScores: createHighScores(options.highScores ?? options.highScore),
        submittedScore: options.submittedScore ?? null,
        robotInputs: createRobotInputs(variant),
        restoreModes: {},
        mode: null,
        playingMode: null,
        currentMusic: null,
        actMusic: [createMusic(), createMusic(), createMusic()],
        stageMusic: [createMusic(), createMusic(), createMusic(), createMusic()],
        trainingMusic: createMusic(),
        introMusic: createMusic(),
        levelSelectMusic: createMusic(),
        highScoreMusic: createMusic(),
        gameOverMusic: createMusic(),
        stages: createStages(),
        tiles: createTiles(),
        ghostSprites: createGhostSprites(),
        browserSuspended: true,
        stopAllSoundsCalls: 0,
        stopAllSoundEffectsCalls: 0,
        scoreAccessCalls: [],
        isStateSaveReady() {
            return true;
        },
        getCurrentModeIdForState() {
            return modeId;
        },
        getModeForStateRestore(id) {
            if (id === "playing") {
                return this.playingMode;
            }
            if (!this.restoreModes[id]) {
                this.restoreModes[id] = createMode(id, variant, options);
            }
            return this.restoreModes[id];
        },
        getPlayingModeForState() {
            return this.playingMode;
        },
        initModeForRestore(mode) {
            this.mode = mode;
            mode.main = this;
            mode.input = this.input;
            mode.initCalls = (mode.initCalls ?? 0) + 1;
            this.input.clearKeyPressedRecord();
            this.resetNextFrameTime();
        },
        stopAllSounds() {
            this.stopAllSoundsCalls++;
            if (this.currentMusic !== null) {
                this.currentMusic.stop();
            }
            this.stopAllSoundEffects();
        },
        stopAllSoundEffects() {
            this.stopAllSoundEffectsCalls++;
        },
        setBrowserSuspended(suspended) {
            this.browserSuspended = suspended;
        },
        resetNextFrameTime() {
            this.nextFrameTimeReset = true;
        },
        accessScoresDatabase(upload, world, score, initials) {
            this.scoreAccessCalls.push({ upload, world, score, initials });
            this.submittedScore = upload ? { world, score, initials } : null;
        }
    };

    main.playingMode = createPlayingMode(main, variant);
    main.mode = modeId === "playing" ? main.playingMode : main.getModeForStateRestore(modeId);
    return main;
}

function createMainFields(variant, options) {
    const alternate = variant === "target";
    return {
        worldIndex: options.worldIndex ?? (alternate ? 3 : 1),
        stageIndex: options.stageIndex ?? (alternate ? 4 : 2),
        score: options.score ?? (alternate ? 10 : 43210),
        lives: alternate ? 1 : 2,
        paused: false,
        musicVolume: alternate ? 0.25 : 0.75,
        musicVolumeFadeStep: alternate ? 0.02 : 0.01,
        fadeMusicFlag: alternate,
        uploadComplete: false,
        demoIndex: alternate ? 3 : 1,
        demoMode: false
    };
}

function createMode(id, variant, options = {}) {
    const alternate = variant === "target";
    if (id === "ending") {
        return {
            state: 0,
            fadeIndex: 22,
            fadeState: 1,
            dialogIndex: 0,
            stringIndex: 0,
            stringDone: false,
            stringTimer: 0,
            dotsOffset: 0,
            redOffset: 0,
            fadeIndex2: 0,
            fadeState2: 0,
            ghostSpriteIndex: 0,
            ghostSpriteIndexIncrementor: 0,
            chompSpriteIndex: 0,
            chompSpriteIndexIncrementor: 0,
            delay: 0,
            creditsY: 600,
            mspacmanX: -64,
            juniorReturning: false,
            juniorX: 0,
            juniorFruits: false,
            fruitData: createMatrix(7, 2, 0)
        };
    }
    if (id === "enterInitials") {
        const initials = options.initials ?? (alternate ? "DOG" : "CAT");
        const mode = EnterInitialsModeClass === null ? {} : Object.create(EnterInitialsModeClass.prototype);
        Object.assign(mode, {
            fadeIndex: alternate ? 2 : 1,
            fadeState: 0,
            dotsOffset: alternate ? 4 : 3,
            redOffset: alternate ? 6 : 5,
            editingIndex: alternate ? 1 : 2,
            initials,
            blinkingInitials: " " + initials.substring(1),
            editVisible: !alternate,
            blinkTimer: alternate ? 8 : 7,
            enterPressed: options.enterPressed ?? !alternate,
            newScoreOf: "YOU ACHIEVED A SCORE OF 12340."
        });
        return mode;
    }
    if (id !== "attract") {
        return {};
    }
    return {
        dotsOffset: alternate ? 9 : 1,
        redOffset: alternate ? 8 : 2,
        fadeIndex: alternate ? 7 : 3,
        fadeState: alternate ? 1 : 0,
        state: alternate ? 3 : 1,
        titleZ: alternate ? 4 : 5,
        titleY: alternate ? 3 : 6,
        titleVy: alternate ? 2 : 7,
        y2010: alternate ? 1 : 8,
        barsY: alternate ? 10 : 9,
        pressEnterDelay: alternate ? 11 : 10,
        pressEnterVisible: !alternate,
        ghostSpriteIndex: alternate ? 1 : 0,
        ghostSpriteIndexIncrementor: alternate ? 13 : 12,
        ghostsVisible: alternate ? 4 : 0,
        ghostX: alternate ? 14 : 13,
        enterPressed: alternate,
        ticks: alternate ? 15 : 14,
        countDown: alternate ? 16 : 15
    };
}

function createPlayingMode(main, variant) {
    const mode = {
        ...createPlayingFields(variant, main.stageIndex),
        main,
        input: main.input,
        mspacman: createMsPacMan(variant),
        ghosts: [0, 1, 2, 3].map((index) => createGhost(index, variant)),
        fruitTarget: createFruitTarget(variant),
        eatenGhost: null,
        tiles: null,
        regionMap: null,
        homeTree: null,
        leftExitMaps: null,
        rightExitMaps: null
    };
    mode.eatenGhost = mode.showGhostPoints ? mode.ghosts[2] : null;
    return mode;
}

function createPlayingFields(variant, stageIndex) {
    const alternate = variant === "target";
    return {
        pelletCountFraction: alternate ? 1 / 3 : 0.1,
        pelletCount: alternate ? 3 : 10,
        pelletsRemaining: alternate ? 2 : 8,
        tileMap: createMatrix(31, 28, alternate ? 2 : 1),
        typeMap: createMatrix(31, 28, alternate ? 3 : 0),
        regionCounts: alternate ? [0, 1, 2] : [1, 2, 1],
        exitIndex: alternate ? 2 : 1,
        exitDelay: alternate ? 6 : 5,
        chaseMode: !alternate,
        chaseModeToggleDelay: alternate ? 8 : 7,
        ghostsBlue: alternate,
        ghostsBlueOffset: alternate ? 2 : 0,
        ghostsBlueTimer: alternate ? 12 : 11,
        showGhostPoints: !alternate,
        showGhostPointsTimer: alternate ? 0 : 13,
        ghostPointsIndex: alternate ? 1 : 2,
        energizerLocations: alternate
            ? [
                  [2, 2],
                  [25, 2],
                  [2, 28],
                  [25, 28]
              ]
            : [
                  [1, 1],
                  [26, 1],
                  [1, 29],
                  [26, 29]
              ],
        energizersVisible: !alternate,
        energizersVisibleTimer: alternate ? 16 : 15,
        finished: alternate,
        finishedTimer: alternate ? 18 : 0,
        finishedWhite: alternate,
        finishedBlinkTimer: alternate ? 20 : 0,
        fruitTargetPresent: !alternate,
        fruitTargetTimer: alternate ? 22 : 21,
        redEnergizerPresent: alternate,
        greenEnergizerPresent: false,
        energizerTimer: alternate ? 24 : 23,
        playerKilledFlag: alternate,
        musicFadeOutTimer: alternate ? 26 : 0,
        playerSpiraling: alternate,
        spiralTimer: alternate ? 28 : 0,
        readyTimer: alternate ? 30 : 29,
        stageMessage: `STAGE ${stageIndex + 1} OF 8`,
        fruitOdds: alternate ? 0.1 : 0.5,
        redPelletOdds: alternate ? 0.05 : 0.25,
        exitDelayTarget: alternate ? 32 : 31,
        fadeIndex: alternate ? 22 : 0,
        fadeState: alternate ? 1 : 0,
        fadeReason: alternate ? 2 : 1,
        gameOver: alternate,
        gameOverTimer: alternate ? 40 : 0
    };
}

function createMsPacMan(variant) {
    const alternate = variant === "target";
    return {
        x: alternate ? 10 : 20,
        y: alternate ? 11 : 21,
        speed: alternate ? 1 : 2,
        speedRemainder: alternate ? 0.3 : 0.4,
        direction: alternate ? 1 : 3,
        spriteIndex: alternate ? 1 : 2,
        spriteIndexIncrementor: alternate ? 3 : 4,
        pellotDampensSpeed: !alternate,
        pellotDampensSpeedCount: alternate ? 9 : 10,
        corneringEnhancesSpeed: alternate,
        corneringEnhancesSpeedCount: alternate ? 9 : 8,
        speedBoost: !alternate,
        speedBoostTimer: alternate ? 13 : 14
    };
}

function createGhost(index, variant) {
    const alternate = variant === "target";
    return {
        x: 40 + index + (alternate ? 10 : 0),
        y: 50 + index + (alternate ? 10 : 0),
        speed: alternate ? 1 : 2,
        speedRemainder: alternate ? 0.3 : 0.4,
        direction: index % 4,
        blue: alternate,
        eyeBalls: !alternate,
        ghostIndex: index,
        spriteIndex: alternate ? 0 : 1,
        spriteIndexIncrementor: alternate ? 7 : 8,
        targetX: alternate ? 9 : 10,
        targetY: alternate ? 11 : 12,
        inHome: index === 0 ? !alternate : alternate,
        exitingHome: index === 1 ? !alternate : alternate,
        enteringHome: index === 2 ? !alternate : alternate
    };
}

function createFruitTarget(variant) {
    const alternate = variant === "target";
    return {
        x: alternate ? 60 : 70,
        y: alternate ? 61 : 71,
        speed: alternate ? 1 : 2,
        speedRemainder: alternate ? 0.3 : 0.4,
        direction: alternate ? 2 : 3,
        fruitIndex: alternate ? 4 : 5,
        yOffset: alternate ? 6 : 7,
        yOffsetAngle: alternate ? 8 : 9,
        goingAroundHome: !alternate,
        clockwise: alternate,
        aroundHomeIndex: alternate ? 2 : 3,
        exiting: !alternate,
        eatenTimer: alternate ? 12 : 13,
        eaten: alternate,
        exitPath: createMatrix(31, 28, alternate ? 2 : 1)
    };
}

function createInput() {
    return {
        clearCalls: 0,
        clearKeyPressedRecord() {
            this.clearCalls++;
        }
    };
}

function createRandom(variant) {
    const random = variant === "target" ? { seed0: 444, seed1: 555, seed2: 666 } : { seed0: 111, seed1: 222, seed2: 333 };
    Object.defineProperties(random, {
        getState: {
            value() {
                return { seed0: this.seed0, seed1: this.seed1, seed2: this.seed2 };
            }
        },
        setState: {
            value(state) {
                this.seed0 = state.seed0;
                this.seed1 = state.seed1;
                this.seed2 = state.seed2;
            }
        }
    });
    return random;
}

function createRobotInputs(variant) {
    const offset = variant === "target" ? 100 : 0;
    return [0, 1, 2, 3].map((index) => ({
        index: offset + index + 1,
        getState() {
            return { index: this.index };
        },
        setState(snapshot) {
            this.index = snapshot.index;
        }
    }));
}

function createHighScores(highScoreOrScores) {
    const scores = [[], [], [], []];
    const highScores = Array.isArray(highScoreOrScores) ? highScoreOrScores : highScoreOrScores ? [highScoreOrScores] : [];
    for (const highScore of highScores) {
        scores[highScore.world].push({
            score: highScore.score,
            initials: highScore.initials
        });
    }
    return scores;
}

function createMusic() {
    return {
        looped: false,
        paused: false,
        playbackRate: 1,
        position: 0,
        volume: 1,
        playingState: false,
        completionPending: false,
        fade: null,
        buffer: {
            duration: 60
        },
        stopCalls: 0,
        playCalls: [],
        loopCalls: [],
        pauseCalls: 0,
        capturePlaybackState() {
            const duration = this.buffer?.duration ?? null;
            let positionSeconds = Number.isFinite(this.position) ? Math.max(0, this.position) : 0;
            if (duration !== null && duration > 0) {
                positionSeconds = this.looped ? ((positionSeconds % duration) + duration) % duration : Math.min(positionSeconds, duration);
            }
            return {
                transport: this.completionPending ? "ended-pending" : this.paused ? "paused" : this.playingState ? "playing" : "stopped",
                looped: this.looped,
                playbackRate: this.playbackRate,
                positionSeconds,
                volume: this.volume,
                fade: this.fade === null ? null : { ...this.fade }
            };
        },
        restorePlaybackState(snapshot) {
            this.stopCalls++;
            this.looped = snapshot.looped;
            this.playbackRate = snapshot.playbackRate;
            this.position = snapshot.positionSeconds;
            this.volume = snapshot.volume;
            this.paused = snapshot.transport === "paused";
            this.playingState = snapshot.transport === "playing";
            this.completionPending = snapshot.transport === "ended-pending";
            this.fade = snapshot.fade === null ? null : { ...snapshot.fade };
        },
        isLooped() {
            return this.looped;
        },
        isPaused() {
            return this.paused;
        },
        getPlaybackRate() {
            return this.playbackRate;
        },
        getDuration() {
            return this.buffer?.duration ?? null;
        },
        playing() {
            return this.playingState;
        },
        getPosition() {
            return this.position;
        },
        setPosition(position) {
            this.position = position;
        },
        getVolume() {
            return this.volume;
        },
        setVolume(volume) {
            this.volume = volume;
        },
        play(rate, volume) {
            this.playCalls.push({ rate, volume });
            this.playbackRate = rate;
            this.paused = false;
            this.looped = false;
            this.playingState = true;
            this.completionPending = false;
        },
        loop(rate, volume) {
            this.loopCalls.push({ rate, volume });
            this.playbackRate = rate;
            this.paused = false;
            this.looped = true;
            this.playingState = true;
            this.completionPending = false;
        },
        stop() {
            this.stopCalls++;
            this.paused = false;
            this.playingState = false;
            this.completionPending = false;
        },
        pause() {
            this.pauseCalls++;
            this.paused = true;
            this.playingState = false;
        },
        ready() {
            return Promise.resolve();
        }
    };
}

function createStages() {
    return Array.from({ length: 4 }, (_worldValue, world) =>
        Array.from({ length: 8 }, (_stageValue, stage) => {
            const tileMap = createMatrix(31, 28, 47);
            for (const [x, y] of [
                [1, 1],
                [26, 1],
                [1, 29],
                [26, 29]
            ]) {
                tileMap[y][x] = 49;
            }
            return {
                pelletCount: 10,
                regionCount: 3,
                tileMap,
                regionMap: createMatrix(31, 28, 1),
                homeTree: { world, stage, kind: "home" },
                leftExitMaps: [createMatrix(31, 28, 1)],
                rightExitMaps: [createMatrix(31, 28, 2)]
            };
        })
    );
}

function createTiles() {
    return Array.from({ length: 8 }, (_value, index) => ({ index }));
}

function createGhostSprites() {
    return Array.from({ length: 4 }, (_value, index) => ({ index, kind: "ghostSprites" }));
}

function createGameContainer() {
    return {
        setMusicOn() {
            throw new Error("game-state restore must not mutate application Music policy");
        },
        setSoundOn() {
            throw new Error("game-state restore must not mutate application Sound policy");
        }
    };
}

function readStageExitDirections(bytes) {
    let offset = 8 + 31 * 28 * 3;
    const directions = [];
    const readInt = () => {
        assert.ok(offset + 4 <= bytes.length, "stage data ended while reading exit maps");
        const value = bytes.readInt32BE(offset);
        offset += 4;
        return value;
    };
    const readMaps = () => {
        const mapCount = readInt();
        assert.ok(mapCount >= 0 && mapCount <= 1024, `invalid exit-map count ${mapCount}`);
        for (let map = 0; map < mapCount; map++) {
            const size = readInt();
            assert.ok(size >= 0 && size <= 31 * 28, `invalid exit-map size ${size}`);
            for (let entry = 0; entry < size; entry++) {
                const x = readInt();
                const y = readInt();
                const direction = readInt();
                assert.ok(x >= 0 && x < 28, `invalid exit-map x ${x}`);
                assert.ok(y >= 0 && y < 31, `invalid exit-map y ${y}`);
                directions.push(direction);
            }
        }
    };
    readMaps();
    readMaps();
    return directions;
}

function createMatrix(rows, columns, value) {
    return Array.from({ length: rows }, () => Array.from({ length: columns }, () => value));
}

function pickFields(source, fields) {
    const picked = {};
    for (const field of fields) {
        picked[field] = source[field];
    }
    return picked;
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function restoreEnv(name, value) {
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
}
