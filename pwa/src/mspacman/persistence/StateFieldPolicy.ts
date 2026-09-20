import type { ModeId } from "./GameStateSnapshot.js";

export const STATE_FIELD_POLICY = {
    Main: {
        persisted: [
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
        ],
        runtime: [
            "browserLifetimeGeneration",
            "fades",
            "random",
            "maxWidth",
            "maxHeight",
            "maxColorDepth",
            "nativeDisplayMode",
            "appGameContainer",
            "appletGameContainer",
            "nextFrameTime",
            "mode",
            "input",
            "currentMusic",
            "highScores",
            "scoresDownloadComplete",
            "uploadComplete",
            "submittedScore",
            "robotInputs",
            "browserSuspended",
            "startupLoadingComplete",
            "loadingCompleteHandler",
            "pauseStateChangeHandler",
            "leaderboardRevision",
            "symbols",
            "ghostSprites",
            "mspacmanSprites",
            "pacmanSprites",
            "tiles",
            "stages",
            "blueGhostSprites",
            "ghostPointsSprites",
            "eyeBallsSprites",
            "whiteTiles",
            "fruitSprites",
            "fruitPointsSprites",
            "redEnergizerSprite",
            "greenEnergizerSprite",
            "heartSprite",
            "clapperBottomSprite",
            "clapperTopSprites",
            "juniorSprite",
            "juniorRightSprite",
            "juniorBagSprite",
            "storkHeadSprite",
            "storkWingsSprites",
            "actMusic",
            "stageMusic",
            "trainingMusic",
            "introMusic",
            "levelSelectMusic",
            "highScoreMusic",
            "gameOverMusic",
            "atePellotSound",
            "ateEnergizerSound",
            "ateGhostSound",
            "ateFruitSound",
            "fruitAppearedSound",
            "blueGhostsSound",
            "clappingSound",
            "extraLifeSound",
            "diedSound",
            "pressedEnterSound",
            "speaking"
        ]
    },
    Thing: {
        persisted: ["x", "y", "speed", "speedRemainder", "direction"],
        runtime: ["playingMode", "main"]
    },
    MsPacMan: {
        persisted: [
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
        ],
        runtime: ["playingMode", "main", "input"]
    },
    Ghost: {
        persisted: [
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
        ],
        runtime: ["playingMode", "main", "sprites"]
    },
    FruitTarget: {
        persisted: [
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
        ],
        runtime: ["playingMode", "main", "exitPath"]
    },
    PlayingMode: {
        persisted: [
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
        ],
        runtime: [
            "main",
            "regionMap",
            "homeTree",
            "leftExitMaps",
            "rightExitMaps",
            "tiles",
            "input",
            "fruitTarget",
            "mspacman",
            "ghosts",
            "eatenGhost",
            "fruitTargetEntries"
        ]
    },
    Act1Mode: {
        persisted: [
            "state",
            "nextState",
            "substate",
            "topClapperIndex",
            "timer",
            "cyanX",
            "pacmanX",
            "pinkX",
            "mspacmanX",
            "mspacmanY",
            "ghostSpriteIndex",
            "ghostSpriteIndexIncrementor",
            "chompSpriteIndex",
            "chompSpriteIndexIncrementor",
            "bumped",
            "showHeart",
            "bumpedAlpha",
            "bumpedSpeed",
            "ghostY",
            "ghostYAngle",
            "fadeIndex",
            "fadeState"
        ],
        runtime: ["main"]
    },
    Act2Mode: {
        persisted: [
            "state",
            "substate",
            "topClapperIndex",
            "timer",
            "fadeIndex",
            "fadeState",
            "mspacmanX",
            "pacmanX",
            "chompSpriteIndex",
            "chompSpriteIndexIncrementor"
        ],
        runtime: ["main"]
    },
    Act3Mode: {
        persisted: [
            "state",
            "substate",
            "topClapperIndex",
            "timer",
            "fadeIndex",
            "fadeState",
            "storkX",
            "storkSpriteIndex",
            "storkSpriteIndexIncrementor",
            "juniorBagX",
            "juniorBagY",
            "juniorBagVy",
            "juniorY",
            "juniorVy"
        ],
        runtime: ["main"]
    },
    Act4Mode: {
        persisted: [
            "state",
            "substate",
            "topClapperIndex",
            "timer",
            "fadeIndex",
            "fadeState",
            "mspacmanX",
            "chompSpriteIndex",
            "chompSpriteIndexIncrementor",
            "storkSpriteIndex",
            "storkSpriteIndexIncrementor",
            "pellotOffset",
            "storkX",
            "storkY",
            "storkYAngle"
        ],
        runtime: ["main"]
    },
    Act5Mode: {
        persisted: [
            "state",
            "substate",
            "topClapperIndex",
            "timer",
            "fadeIndex",
            "fadeState",
            "dialogIndex",
            "stringIndex",
            "stringDone",
            "stringTimer",
            "tone",
            "mspacmanIndex",
            "pacmanIndex"
        ],
        runtime: ["main"]
    },
    Act6Mode: {
        persisted: [
            "state",
            "substate",
            "topClapperIndex",
            "timer",
            "ghostSpriteIndex",
            "ghostSpriteIndexIncrementor",
            "chompSpriteIndex",
            "chompSpriteIndexIncrementor",
            "fadeIndex",
            "fadeState",
            "mspacmanX",
            "ghostX"
        ],
        runtime: ["main"]
    },
    Act7Mode: {
        persisted: [
            "state",
            "substate",
            "topClapperIndex",
            "timer",
            "fadeIndex",
            "fadeState",
            "dialogIndex",
            "stringIndex",
            "stringDone",
            "stringTimer",
            "tone",
            "mspacmanIndex",
            "pacmanIndex"
        ],
        runtime: ["main"]
    },
    AttractMode: {
        persisted: [
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
        ],
        runtime: ["main", "whiteEnergizer", "input"]
    },
    EndingMode: {
        persisted: [
            "state",
            "fadeIndex",
            "fadeState",
            "dialogIndex",
            "stringIndex",
            "stringDone",
            "stringTimer",
            "dotsOffset",
            "redOffset",
            "fadeIndex2",
            "fadeState2",
            "ghostSpriteIndex",
            "ghostSpriteIndexIncrementor",
            "chompSpriteIndex",
            "chompSpriteIndexIncrementor",
            "delay",
            "creditsY",
            "mspacmanX",
            "juniorReturning",
            "juniorX",
            "juniorFruits",
            "fruitData"
        ],
        runtime: ["main", "whiteEnergizer"]
    },
    EnterInitialsMode: {
        persisted: [
            "fadeIndex",
            "fadeState",
            "dotsOffset",
            "redOffset",
            "editingIndex",
            "initials",
            "editVisible",
            "blinkTimer",
            "enterPressed"
        ],
        runtime: ["main", "whiteEnergizer", "input", "blinkingInitials", "newScoreOf"]
    },
    HallOfFameMode: {
        persisted: ["pressEnterDelay", "pressEnterVisible", "dotsOffset", "redOffset", "enterPressed", "fadeIndex", "fadeState", "ticks", "countDown"],
        runtime: ["main", "highScores", "whiteEnergizer", "input"]
    },
    IntroMode: {
        persisted: [
            "dotsOffset",
            "redOffset",
            "fadeIndex",
            "fadeState",
            "mspacmanX",
            "ghostSpriteIndex",
            "ghostSpriteIndexIncrementor",
            "chompSpriteIndex",
            "chompSpriteIndexIncrementor"
        ],
        runtime: ["main", "whiteEnergizer"]
    },
    SelectWorldMode: {
        persisted: [
            "fadeIndex",
            "fadeState",
            "ghostSpriteIndex",
            "ghostSpriteIndexIncrementor",
            "angleOffset",
            "selection",
            "selectY",
            "selecting",
            "selectOffset",
            "selectAngle",
            "selectMag",
            "selectIndex",
            "countDown"
        ],
        runtime: ["main", "input", "whiteEnergizer"]
    }
} as const;

export const MAIN_FIELDS = STATE_FIELD_POLICY.Main.persisted;
export const THING_FIELDS = STATE_FIELD_POLICY.Thing.persisted;
export const MSPACMAN_FIELDS = STATE_FIELD_POLICY.MsPacMan.persisted;
export const GHOST_FIELDS = STATE_FIELD_POLICY.Ghost.persisted;
export const FRUIT_TARGET_FIELDS = STATE_FIELD_POLICY.FruitTarget.persisted;
export const PLAYING_MODE_FIELDS = STATE_FIELD_POLICY.PlayingMode.persisted;

export const MODE_FIELDS = {
    act1: STATE_FIELD_POLICY.Act1Mode.persisted,
    act2: STATE_FIELD_POLICY.Act2Mode.persisted,
    act3: STATE_FIELD_POLICY.Act3Mode.persisted,
    act4: STATE_FIELD_POLICY.Act4Mode.persisted,
    act5: STATE_FIELD_POLICY.Act5Mode.persisted,
    act6: STATE_FIELD_POLICY.Act6Mode.persisted,
    act7: STATE_FIELD_POLICY.Act7Mode.persisted,
    attract: STATE_FIELD_POLICY.AttractMode.persisted,
    ending: STATE_FIELD_POLICY.EndingMode.persisted,
    enterInitials: STATE_FIELD_POLICY.EnterInitialsMode.persisted,
    hallOfFame: STATE_FIELD_POLICY.HallOfFameMode.persisted,
    intro: STATE_FIELD_POLICY.IntroMode.persisted,
    selectWorld: STATE_FIELD_POLICY.SelectWorldMode.persisted
} satisfies Partial<Record<ModeId, readonly string[]>>;
