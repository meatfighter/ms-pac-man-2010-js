import assert from "node:assert/strict";
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
    "uploadComplete",
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
    const { MsPacManGameStateSerializer, isFutureMsPacManGameStateSnapshot, isValidMsPacManGameStateSnapshot } = await server.ssrLoadModule(
        "/src/mspacman/persistence/MsPacManGameStateSerializer.ts"
    );
    const { MsPacManGameStateStore } = await server.ssrLoadModule("/src/mspacman/persistence/MsPacManGameStateStore.ts");
    const { createBrowserStorageKeys } = await server.ssrLoadModule("/src/app/BrowserStorageKeys.ts");

    await runTest("store clears malformed and current-version invalid local-storage snapshots", () => {
        const storage = installMemoryLocalStorage();
        const store = new MsPacManGameStateStore(APP_VERSION);
        setTestLocation(STAGE_URL);
        const storageKey = createBrowserStorageKeys().gameState;

        storage.setItem(storageKey, "{");
        assert.equal(store.hasValidSave(), false);
        assert.equal(storage.getItem(storageKey), null);

        storage.setItem(storageKey, JSON.stringify({ version: 3 }));
        assert.equal(store.hasValidSave(), false);
        assert.equal(storage.getItem(storageKey), null);
    });

    await runTest("store discards obsolete saves and protects future saves from overwrite", () => {
        const storage = installMemoryLocalStorage();
        const store = new MsPacManGameStateStore(APP_VERSION);
        setTestLocation(STAGE_URL);
        const storageKey = createBrowserStorageKeys().gameState;

        storage.setItem(storageKey, JSON.stringify({ version: 1 }));
        assert.equal(store.hasValidSave(), false);
        assert.equal(storage.getItem(storageKey), null);

        const futureSnapshot = JSON.stringify({ version: 999, futureShape: true });
        storage.setItem(storageKey, futureSnapshot);
        assert.equal(store.hasValidSave(), false);
        assert.equal(storage.getItem(storageKey), futureSnapshot);
        assert.equal(store.save(createFakeMain("attract", "source")), false);
        assert.equal(storage.getItem(storageKey), futureSnapshot);

        store.clear();
        assert.equal(store.save(createFakeMain("attract", "source")), true);
        assert.notEqual(storage.getItem(storageKey), futureSnapshot);
    });

    await runTest("browser storage keys isolate save state by deployment path", () => {
        const storage = installMemoryLocalStorage();
        const store = new MsPacManGameStateStore(APP_VERSION);
        const stageSource = createFakeMain("attract", "source", { score: 11110 });
        const productionSource = createFakeMain("attract", "source", { score: 22220 });

        setTestLocation(STAGE_URL);
        const stageKeys = createBrowserStorageKeys();
        assert.equal(store.save(stageSource), true);
        assert.equal(store.hasValidSave(), true);
        const stageSnapshot = storage.getItem(stageKeys.gameState);
        assert.notEqual(stageSnapshot, null);

        setTestLocation(PRODUCTION_URL);
        const productionKeys = createBrowserStorageKeys();
        assert.notEqual(stageKeys.gameState, productionKeys.gameState);
        assert.equal(store.hasValidSave(), false);
        assert.equal(store.save(productionSource), true);
        const productionSnapshot = storage.getItem(productionKeys.gameState);
        assert.notEqual(productionSnapshot, null);
        assert.notEqual(stageSnapshot, productionSnapshot);

        setTestLocation(STAGE_URL);
        assert.equal(store.hasValidSave(), true);
        storage.setItem(stageKeys.gameState, "{");
        assert.equal(store.hasValidSave(), false);
        assert.equal(storage.getItem(stageKeys.gameState), null);
        assert.equal(storage.getItem(productionKeys.gameState), productionSnapshot);

        assert.equal(store.save(stageSource), true);
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
        assert.equal(isFutureMsPacManGameStateSnapshot(unsupportedVersion), true);

        const missingMainField = clone(snapshot);
        delete missingMainField.mainFields.score;
        assert.equal(serializer.isSupportedSnapshot(missingMainField), false);
        assert.equal(isFutureMsPacManGameStateSnapshot(missingMainField), false);

        const extraModeField = clone(snapshot);
        extraModeField.mode.fields.extra = 1;
        assert.equal(serializer.isSupportedSnapshot(extraModeField), false);

        const zeroSubmittedScore = clone(snapshot);
        zeroSubmittedScore.submittedScore = { world: 0, score: 0, initials: "AAA" };
        assert.equal(serializer.isSupportedSnapshot(zeroSubmittedScore), false);

        const nonMultipleSubmittedScore = clone(snapshot);
        nonMultipleSubmittedScore.submittedScore = { world: 0, score: 12341, initials: "AAA" };
        assert.equal(serializer.isSupportedSnapshot(nonMultipleSubmittedScore), false);

        const invalidInitialsSubmittedScore = clone(snapshot);
        invalidInitialsSubmittedScore.submittedScore = { world: 0, score: 12340, initials: "cat" };
        assert.equal(serializer.isSupportedSnapshot(invalidInitialsSubmittedScore), false);
    });

    await runTest("store saves and restores a non-playing mode snapshot", () => {
        const storage = installMemoryLocalStorage();
        const store = new MsPacManGameStateStore(APP_VERSION);
        setTestLocation(STAGE_URL);
        const storageKey = createBrowserStorageKeys().gameState;
        const source = createFakeMain("attract", "source");
        const target = createFakeMain("attract", "target");
        const gc = createGameContainer();

        assert.equal(store.save(source), true);
        assert.equal(store.hasValidSave(), true);
        assert.notEqual(storage.getItem(storageKey), null);

        assert.equal(store.restore(target, gc), true);
        assert.deepEqual(pickFields(target, MAIN_FIELDS), pickFields(source, MAIN_FIELDS));
        assert.deepEqual(pickFields(target.mode, ATTRACT_FIELDS), pickFields(source.mode, ATTRACT_FIELDS));
        assert.deepEqual(target.random, source.random);
        assert.deepEqual(
            target.robotInputs.map((input) => input.index),
            source.robotInputs.map((input) => input.index)
        );
        assert.equal(target.browserSuspended, false);
        assert.equal(target.stopAllSoundsCalls, 1);
        assert.equal(target.stopAllSoundEffectsCalls >= 1, true);
        assert.equal(target.input.clearCalls > 0, true);
        assert.deepEqual(gc.musicOnValues, [true]);
    });

    await runTest("store preserves saved snapshot when restore throws", () => {
        const storage = installMemoryLocalStorage();
        const store = new MsPacManGameStateStore(APP_VERSION);
        setTestLocation(STAGE_URL);
        const storageKey = createBrowserStorageKeys().gameState;
        const source = createFakeMain("attract", "source");
        const target = createFakeMain("attract", "target");

        assert.equal(store.save(source), true);
        const savedSnapshot = storage.getItem(storageKey);
        assert.notEqual(savedSnapshot, null);
        target.getModeForStateRestore = () => {
            throw new Error("Injected restore failure.");
        };

        const originalWarn = console.warn;
        let warnCalls = 0;
        console.warn = (...args) => {
            warnCalls++;
            assert.equal(String(args[0]).includes("Unable to restore MS Pac-Man game state."), true);
        };
        try {
            assert.equal(store.restore(target, createGameContainer()), false);
        } finally {
            console.warn = originalWarn;
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
        source.currentMusic = sourceMusic;

        const snapshot = serializer.createSnapshot(source, APP_VERSION);
        assert.equal(isValidMsPacManGameStateSnapshot(snapshot), true);
        assert.equal(snapshot.mode.id, "playing");
        assert.equal(snapshot.music.id, "stage:1");
        assert.equal(snapshot.music.position, 23);

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
        assert.deepEqual(gc.musicOnValues, [true]);
        assert.equal(target.browserSuspended, false);
    });

    await runTest("restoring an already-recorded submitted score does not submit again", () => {
        const serializer = new MsPacManGameStateSerializer();
        const source = createFakeMain("attract", "source", {
            score: 12340,
            worldIndex: 1,
            highScore: { world: 1, score: 12340, initials: "CAT" },
            submittedScore: { world: 1, score: 12340, initials: "CAT" }
        });
        const snapshot = serializer.createSnapshot(source, APP_VERSION);
        assert.deepEqual(snapshot.submittedScore, { world: 1, score: 12340, initials: "CAT" });

        const target = createFakeMain("attract", "target", {
            highScore: { world: 1, score: 12340, initials: "CAT" }
        });
        serializer.restoreSnapshot(target, createGameContainer(), snapshot);
        assert.deepEqual(target.scoreAccessCalls, []);
        assert.deepEqual(target.submittedScore, { world: 1, score: 12340, initials: "CAT" });
    });

    await runTest("serializer captures the explicit submitted score when equal-score rows exist", () => {
        const serializer = new MsPacManGameStateSerializer();
        const source = createFakeMain("attract", "source", {
            score: 12340,
            worldIndex: 1,
            highScores: [
                { world: 1, score: 12340, initials: "DOG" },
                { world: 1, score: 12340, initials: "CAT" }
            ],
            submittedScore: { world: 1, score: 12340, initials: "CAT" }
        });

        const snapshot = serializer.createSnapshot(source, APP_VERSION);
        assert.deepEqual(snapshot.submittedScore, { world: 1, score: 12340, initials: "CAT" });

        const target = createFakeMain("attract", "target", {
            highScore: { world: 1, score: 12340, initials: "DOG" }
        });
        serializer.restoreSnapshot(target, createGameContainer(), snapshot);
        assert.deepEqual(target.scoreAccessCalls, [{ upload: true, world: 1, score: 12340, initials: "CAT" }]);
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
                this.restoreModes[id] = createMode(id, variant);
            }
            return this.restoreModes[id];
        },
        getPlayingModeForState() {
            return this.playingMode;
        },
        initModeForRestore(mode) {
            this.mode = mode;
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

function createMode(id, variant) {
    if (id !== "attract") {
        return {};
    }
    const alternate = variant === "target";
    return {
        dotsOffset: alternate ? 9 : 1,
        redOffset: alternate ? 8 : 2,
        fadeIndex: alternate ? 7 : 3,
        fadeState: alternate ? 6 : 4,
        state: alternate ? 5 : 1,
        titleZ: alternate ? 4 : 5,
        titleY: alternate ? 3 : 6,
        titleVy: alternate ? 2 : 7,
        y2010: alternate ? 1 : 8,
        barsY: alternate ? 10 : 9,
        pressEnterDelay: alternate ? 11 : 10,
        pressEnterVisible: !alternate,
        ghostSpriteIndex: alternate ? 12 : 11,
        ghostSpriteIndexIncrementor: alternate ? 13 : 12,
        ghostsVisible: !alternate,
        ghostX: alternate ? 14 : 13,
        enterPressed: alternate,
        ticks: alternate ? 15 : 14,
        countDown: alternate ? 16 : 15
    };
}

function createPlayingMode(main, variant) {
    const mode = {
        ...createPlayingFields(variant),
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
    mode.eatenGhost = mode.ghosts[2];
    return mode;
}

function createPlayingFields(variant) {
    const alternate = variant === "target";
    return {
        pelletCountFraction: alternate ? 0.125 : 0.25,
        pelletCount: alternate ? 3 : 10,
        pelletsRemaining: alternate ? 90 : 180,
        tileMap: createMatrix(31, 28, alternate ? 2 : 1),
        typeMap: createMatrix(31, 28, alternate ? 3 : 0),
        regionCounts: alternate ? [4, 5, 6] : [1, 2, 3],
        exitIndex: alternate ? 2 : 1,
        exitDelay: alternate ? 6 : 5,
        chaseMode: !alternate,
        chaseModeToggleDelay: alternate ? 8 : 7,
        ghostsBlue: alternate,
        ghostsBlueOffset: alternate ? 10 : 9,
        ghostsBlueTimer: alternate ? 12 : 11,
        showGhostPoints: !alternate,
        showGhostPointsTimer: alternate ? 14 : 13,
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
        finishedTimer: alternate ? 18 : 17,
        finishedWhite: !alternate,
        finishedBlinkTimer: alternate ? 20 : 19,
        fruitTargetPresent: !alternate,
        fruitTargetTimer: alternate ? 22 : 21,
        redEnergizerPresent: alternate,
        greenEnergizerPresent: !alternate,
        energizerTimer: alternate ? 24 : 23,
        playerKilledFlag: alternate,
        musicFadeOutTimer: alternate ? 26 : 25,
        playerSpiraling: !alternate,
        spiralTimer: alternate ? 28 : 27,
        readyTimer: alternate ? 30 : 29,
        stageMessage: alternate ? "WAIT" : "READY!",
        fruitOdds: alternate ? 0.1 : 0.5,
        redPelletOdds: alternate ? 0.2 : 0.6,
        exitDelayTarget: alternate ? 32 : 31,
        fadeIndex: alternate ? 34 : 33,
        fadeState: alternate ? 36 : 35,
        fadeReason: alternate ? 38 : 37,
        gameOver: alternate,
        gameOverTimer: alternate ? 40 : 39
    };
}

function createMsPacMan(variant) {
    const alternate = variant === "target";
    return {
        x: alternate ? 10 : 20,
        y: alternate ? 11 : 21,
        speed: alternate ? 1 : 2,
        speedRemainder: alternate ? 3 : 4,
        direction: alternate ? 1 : 3,
        spriteIndex: alternate ? 5 : 6,
        spriteIndexIncrementor: alternate ? 7 : 8,
        pellotDampensSpeed: !alternate,
        pellotDampensSpeedCount: alternate ? 9 : 10,
        corneringEnhancesSpeed: alternate,
        corneringEnhancesSpeedCount: alternate ? 11 : 12,
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
        speedRemainder: alternate ? 3 : 4,
        direction: index % 4,
        blue: alternate,
        eyeBalls: !alternate,
        ghostIndex: index,
        spriteIndex: alternate ? 5 : 6,
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
        speedRemainder: alternate ? 3 : 4,
        direction: alternate ? 2 : 3,
        fruitIndex: alternate ? 4 : 5,
        yOffset: alternate ? 6 : 7,
        yOffsetAngle: alternate ? 8 : 9,
        goingAroundHome: !alternate,
        clockwise: alternate,
        aroundHomeIndex: alternate ? 10 : 11,
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
        buffer: {
            duration: 60
        },
        stopCalls: 0,
        playCalls: [],
        loopCalls: [],
        pauseCalls: 0,
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
        },
        loop(rate, volume) {
            this.loopCalls.push({ rate, volume });
            this.playbackRate = rate;
            this.paused = false;
            this.looped = true;
            this.playingState = true;
        },
        stop() {
            this.stopCalls++;
            this.paused = false;
            this.playingState = false;
        },
        pause() {
            this.pauseCalls++;
            this.paused = true;
        },
        ready() {
            return Promise.resolve();
        }
    };
}

function createStages() {
    return Array.from({ length: 4 }, (_worldValue, world) =>
        Array.from({ length: 8 }, (_stageValue, stage) => ({
            regionMap: { world, stage, kind: "region" },
            homeTree: { world, stage, kind: "home" },
            leftExitMaps: { world, stage, kind: "left" },
            rightExitMaps: { world, stage, kind: "right" }
        }))
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
        musicOnValues: [],
        setMusicOn(value) {
            this.musicOnValues.push(value);
        }
    };
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
