import type { GameContainer, Music } from "slick2d-ts";
import { isValidSubmittedScoreTuple, normalizeHighScoreInitials } from "../HighScoreProtocol";
import type { Main } from "../Main";
import type { PlayingMode } from "../PlayingMode";
import {
    GAME_STATE_VERSION,
    type CurrentModeSnapshot,
    type FruitTargetSnapshot,
    type JsonRecord,
    type JsonValue,
    type ModeId,
    type ModeSnapshot,
    type MsPacManGameStateSnapshot,
    type MusicId,
    type MusicSnapshot,
    type PlayingModeSnapshot,
    type RandomSnapshot,
    type RobotInputSnapshot,
    type SubmittedScoreSnapshot
} from "./GameStateSnapshot";

type FieldBag = Record<string, unknown>;

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
] as const;

const THING_FIELDS = ["x", "y", "speed", "speedRemainder", "direction"] as const;

const MSPACMAN_FIELDS = [
    ...THING_FIELDS,
    "spriteIndex",
    "spriteIndexIncrementor",
    "pellotDampensSpeed",
    "pellotDampensSpeedCount",
    "corneringEnhancesSpeed",
    "corneringEnhancesSpeedCount",
    "speedBoost",
    "speedBoostTimer"
] as const;

const GHOST_FIELDS = [
    ...THING_FIELDS,
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
] as const;

const FRUIT_TARGET_FIELDS = [
    ...THING_FIELDS,
    "fruitIndex",
    "yOffset",
    "yOffsetAngle",
    "goingAroundHome",
    "clockwise",
    "aroundHomeIndex",
    "exiting",
    "eatenTimer",
    "eaten"
] as const;

const PLAYING_MODE_FIELDS = [
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
] as const;

const MODE_FIELDS: Partial<Record<ModeId, readonly string[]>> = {
    act1: [
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
    act2: [
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
    act3: [
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
    act4: [
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
    act5: [
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
    act6: [
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
    act7: [
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
    attract: [
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
    ending: [
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
    enterInitials: [
        "fadeIndex",
        "fadeState",
        "dotsOffset",
        "redOffset",
        "editingIndex",
        "initials",
        "blinkingInitials",
        "editVisible",
        "blinkTimer",
        "enterPressed",
        "newScoreOf"
    ],
    hallOfFame: ["pressEnterDelay", "pressEnterVisible", "dotsOffset", "redOffset", "enterPressed", "fadeIndex", "fadeState", "ticks", "countDown"],
    intro: [
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
    selectWorld: [
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
    ]
};

const MODE_IDS: ModeId[] = [
    "act1",
    "act2",
    "act3",
    "act4",
    "act5",
    "act6",
    "act7",
    "attract",
    "ending",
    "enterInitials",
    "hallOfFame",
    "intro",
    "playing",
    "selectWorld"
];

const MUSIC_IDS: MusicId[] = [
    "act:0",
    "act:1",
    "act:2",
    "gameOver",
    "highScore",
    "intro",
    "levelSelect",
    "stage:0",
    "stage:1",
    "stage:2",
    "stage:3",
    "training"
];

const SNAPSHOT_KEYS = ["version", "appVersion", "savedAt", "mainFields", "mode", "music", "random", "robotInputs", "submittedScore"] as const;
const MODE_SNAPSHOT_KEYS = ["id", "fields"] as const;
const PLAYING_MODE_SNAPSHOT_KEYS = ["id", "fields", "eatenGhostIndex", "fruitTarget", "ghosts", "inputRobotIndex", "mspacman"] as const;
const THING_SNAPSHOT_KEYS = ["fields"] as const;
const FRUIT_TARGET_SNAPSHOT_KEYS = ["fields", "exitPath"] as const;
const MUSIC_SNAPSHOT_KEYS = ["id", "looped", "paused", "playing", "playbackRate", "position", "volume"] as const;
const RANDOM_SNAPSHOT_KEYS = ["seed0", "seed1", "seed2"] as const;
const ROBOT_INPUT_SNAPSHOT_KEYS = ["index"] as const;

const BOOLEAN_FIELD_NAMES = new Set<string>([
    "paused",
    "fadeMusicFlag",
    "uploadComplete",
    "demoMode",
    "pellotDampensSpeed",
    "corneringEnhancesSpeed",
    "speedBoost",
    "blue",
    "eyeBalls",
    "inHome",
    "exitingHome",
    "enteringHome",
    "goingAroundHome",
    "clockwise",
    "exiting",
    "eaten",
    "chaseMode",
    "ghostsBlue",
    "showGhostPoints",
    "energizersVisible",
    "finished",
    "finishedWhite",
    "fruitTargetPresent",
    "redEnergizerPresent",
    "greenEnergizerPresent",
    "playerKilledFlag",
    "playerSpiraling",
    "gameOver",
    "bumped",
    "showHeart",
    "stringDone",
    "pressEnterVisible",
    "ghostsVisible",
    "enterPressed",
    "juniorReturning",
    "juniorFruits",
    "editVisible",
    "selecting"
]);

const STRING_FIELD_NAMES = new Set<string>(["stageMessage", "initials", "blinkingInitials", "newScoreOf"]);
const NUMBER_ARRAY_FIELD_NAMES = new Set<string>(["regionCounts"]);

const INTEGER_FIELD_RANGES = new Map<string, readonly [number, number]>([
    ["worldIndex", [0, 3]],
    ["stageIndex", [0, 7]],
    ["demoIndex", [0, 3]],
    ["direction", [0, 3]],
    ["ghostIndex", [0, 3]],
    ["fruitIndex", [0, 6]],
    ["ghostPointsIndex", [-1, 3]],
    ["editingIndex", [0, 2]],
    ["selection", [0, 3]]
]);

const MATRIX_FIELD_VALIDATORS: Record<string, (value: unknown) => boolean> = {
    tileMap: (value) => isValidNumberMatrix(value, 31, 28, (entry) => isIntegerInRange(entry, 0, 49)),
    typeMap: (value) => isValidNumberMatrix(value, 31, 28, (entry) => isIntegerInRange(entry, 0, 3)),
    energizerLocations: (value) => isValidEnergizerLocations(value),
    fruitData: (value) => isValidNumberMatrix(value, 7, 2, isFiniteNumber)
};

export function isValidMsPacManGameStateSnapshot(value: unknown): value is MsPacManGameStateSnapshot {
    const snapshot = asRecord(value);
    if (!snapshot || !hasExactKeys(snapshot, SNAPSHOT_KEYS)) {
        return false;
    }
    if (snapshot.version !== GAME_STATE_VERSION || typeof snapshot.appVersion !== "string" || typeof snapshot.savedAt !== "string") {
        return false;
    }
    if (!isValidFieldBag(snapshot.mainFields, MAIN_FIELDS) || !isValidModeSnapshot(snapshot.mode)) {
        return false;
    }
    if (snapshot.music !== null && !isValidMusicSnapshot(snapshot.music)) {
        return false;
    }
    if (!isValidRandomSnapshot(snapshot.random) || !isValidRobotInputs(snapshot.robotInputs)) {
        return false;
    }
    return snapshot.submittedScore === null || isValidSubmittedScoreSnapshot(snapshot.submittedScore);
}

export function isFutureMsPacManGameStateSnapshot(value: unknown): boolean {
    const snapshot = asRecord(value);
    return snapshot !== null && typeof snapshot.version === "number" && Number.isInteger(snapshot.version) && snapshot.version > GAME_STATE_VERSION;
}

function isValidModeSnapshot(value: unknown): value is CurrentModeSnapshot {
    const snapshot = asRecord(value);
    if (!snapshot || !isModeId(snapshot.id)) {
        return false;
    }
    if (snapshot.id === "playing") {
        return (
            hasExactKeys(snapshot, PLAYING_MODE_SNAPSHOT_KEYS) &&
            isValidFieldBag(snapshot.fields, PLAYING_MODE_FIELDS) &&
            isNullableIntegerInRange(snapshot.eatenGhostIndex, 0, 3) &&
            isNullableIntegerInRange(snapshot.inputRobotIndex, 0, 3) &&
            isValidThingSnapshot(snapshot.mspacman, MSPACMAN_FIELDS) &&
            isValidGhostSnapshots(snapshot.ghosts) &&
            isValidFruitTargetSnapshot(snapshot.fruitTarget)
        );
    }

    const fields = MODE_FIELDS[snapshot.id];
    return fields !== undefined && hasExactKeys(snapshot, MODE_SNAPSHOT_KEYS) && isValidFieldBag(snapshot.fields, fields);
}

function isValidThingSnapshot(value: unknown, fields: readonly string[]): boolean {
    const snapshot = asRecord(value);
    return snapshot !== null && hasExactKeys(snapshot, THING_SNAPSHOT_KEYS) && isValidFieldBag(snapshot.fields, fields);
}

function isValidGhostSnapshots(value: unknown): boolean {
    if (!Array.isArray(value) || value.length !== 4) {
        return false;
    }
    for (let i = 0; i < value.length; i++) {
        if (!isValidThingSnapshot(value[i], GHOST_FIELDS)) {
            return false;
        }
    }
    return true;
}

function isValidFruitTargetSnapshot(value: unknown): value is FruitTargetSnapshot {
    const snapshot = asRecord(value);
    return (
        snapshot !== null &&
        hasExactKeys(snapshot, FRUIT_TARGET_SNAPSHOT_KEYS) &&
        isValidFieldBag(snapshot.fields, FRUIT_TARGET_FIELDS) &&
        (snapshot.exitPath === null || isValidNumberMatrix(snapshot.exitPath, 31, 28, (entry) => isIntegerInRange(entry, 0, 3)))
    );
}

function isValidMusicSnapshot(value: unknown): value is MusicSnapshot {
    const snapshot = asRecord(value);
    return (
        snapshot !== null &&
        hasExactKeys(snapshot, MUSIC_SNAPSHOT_KEYS) &&
        isMusicId(snapshot.id) &&
        typeof snapshot.looped === "boolean" &&
        typeof snapshot.paused === "boolean" &&
        typeof snapshot.playing === "boolean" &&
        isPositiveFiniteNumber(snapshot.playbackRate) &&
        isNonNegativeFiniteNumber(snapshot.position) &&
        isFiniteNumberInRange(snapshot.volume, 0, 1)
    );
}

function isValidRandomSnapshot(value: unknown): value is RandomSnapshot {
    const snapshot = asRecord(value);
    return (
        snapshot !== null &&
        hasExactKeys(snapshot, RANDOM_SNAPSHOT_KEYS) &&
        isIntegerInRange(snapshot.seed0, 0, 65535) &&
        isIntegerInRange(snapshot.seed1, 0, 65535) &&
        isIntegerInRange(snapshot.seed2, 0, 65535)
    );
}

function isValidRobotInputs(value: unknown): value is RobotInputSnapshot[] {
    if (!Array.isArray(value) || value.length !== 4) {
        return false;
    }
    for (let i = 0; i < value.length; i++) {
        const snapshot = asRecord(value[i]);
        if (snapshot === null || !hasExactKeys(snapshot, ROBOT_INPUT_SNAPSHOT_KEYS) || !isIntegerInRange(snapshot.index, 0, 100000)) {
            return false;
        }
    }
    return true;
}

function isValidSubmittedScoreSnapshot(value: unknown): value is SubmittedScoreSnapshot {
    return isValidSubmittedScoreTuple(value);
}

function isValidFieldBag(value: unknown, fields: readonly string[]): value is JsonRecord {
    const record = asRecord(value);
    if (record === null || !hasExactKeys(record, fields)) {
        return false;
    }
    for (const field of fields) {
        if (!isValidFieldValue(field, record[field])) {
            return false;
        }
    }
    return true;
}

function isValidFieldValue(field: string, value: unknown): boolean {
    const matrixValidator = MATRIX_FIELD_VALIDATORS[field];
    if (matrixValidator !== undefined) {
        return matrixValidator(value);
    }
    if (NUMBER_ARRAY_FIELD_NAMES.has(field)) {
        return isValidNumberArray(value);
    }
    if (BOOLEAN_FIELD_NAMES.has(field)) {
        return typeof value === "boolean";
    }
    if (STRING_FIELD_NAMES.has(field)) {
        return typeof value === "string";
    }

    const integerRange = INTEGER_FIELD_RANGES.get(field);
    if (integerRange !== undefined) {
        return isIntegerInRange(value, integerRange[0], integerRange[1]);
    }
    return isFiniteNumber(value);
}

function isValidNumberArray(value: unknown): boolean {
    if (!Array.isArray(value) || value.length === 0 || value.length > 31 * 28) {
        return false;
    }
    for (let i = 0; i < value.length; i++) {
        if (!isNonNegativeInteger(value[i])) {
            return false;
        }
    }
    return true;
}

function isValidNumberMatrix(value: unknown, rows: number, columns: number, entryValidator: (value: unknown) => boolean): boolean {
    if (!Array.isArray(value) || value.length !== rows) {
        return false;
    }
    for (let row = 0; row < rows; row++) {
        const entries = value[row];
        if (!Array.isArray(entries) || entries.length !== columns) {
            return false;
        }
        for (let column = 0; column < columns; column++) {
            if (!entryValidator(entries[column])) {
                return false;
            }
        }
    }
    return true;
}

function isValidEnergizerLocations(value: unknown): boolean {
    if (!Array.isArray(value) || value.length !== 4) {
        return false;
    }
    for (let row = 0; row < value.length; row++) {
        const entries = value[row];
        if (!Array.isArray(entries) || entries.length !== 2) {
            return false;
        }
        if (!isIntegerInRange(entries[0], 0, 27) || !isIntegerInRange(entries[1], 0, 30)) {
            return false;
        }
    }
    return true;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
    const ownKeys = Object.keys(record);
    if (ownKeys.length !== keys.length) {
        return false;
    }

    const expectedKeys = new Set<string>(keys);
    for (const key of ownKeys) {
        if (!expectedKeys.has(key)) {
            return false;
        }
    }
    return true;
}

function isModeId(value: unknown): value is ModeId {
    return typeof value === "string" && (MODE_IDS as readonly string[]).includes(value);
}

function isMusicId(value: unknown): value is MusicId {
    return typeof value === "string" && (MUSIC_IDS as readonly string[]).includes(value);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeFiniteNumber(value: unknown): boolean {
    return isFiniteNumber(value) && value >= 0;
}

function isPositiveFiniteNumber(value: unknown): boolean {
    return isFiniteNumber(value) && value > 0;
}

function isFiniteNumberInRange(value: unknown, min: number, max: number): boolean {
    return isFiniteNumber(value) && value >= min && value <= max;
}

function isNonNegativeInteger(value: unknown): boolean {
    return isIntegerInRange(value, 0, Number.MAX_SAFE_INTEGER);
}

function isIntegerInRange(value: unknown, min: number, max: number): boolean {
    return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isNullableIntegerInRange(value: unknown, min: number, max: number): boolean {
    return value === null || isIntegerInRange(value, min, max);
}

export class MsPacManGameStateSerializer {
    public createSnapshot(main: Main, appVersion: string): MsPacManGameStateSnapshot {
        if (!main.isStateSaveReady()) {
            throw new Error("Game state is not ready to save.");
        }

        return {
            version: GAME_STATE_VERSION,
            appVersion,
            savedAt: new Date().toISOString(),
            mainFields: this.captureFields(main, MAIN_FIELDS),
            mode: this.captureCurrentMode(main),
            music: this.captureMusic(main),
            random: this.captureRandom(main),
            robotInputs: main.robotInputs.map((input) => this.captureRobotInput(input)),
            submittedScore: this.captureSubmittedScore(main)
        };
    }

    public restoreSnapshot(main: Main, gc: GameContainer, snapshot: MsPacManGameStateSnapshot): void {
        if (!this.isSupportedSnapshot(snapshot)) {
            throw new Error("Unsupported saved game state.");
        }

        const mode = main.getModeForStateRestore(snapshot.mode.id);
        main.stopAllSounds();
        this.restoreFields(main, snapshot.mainFields, MAIN_FIELDS);
        if (snapshot.mode.id === "playing") {
            this.setField(main, "demoMode", false);
        }

        main.initModeForRestore(mode, gc);
        this.restoreFields(main, snapshot.mainFields, MAIN_FIELDS);
        this.restoreRandom(main, snapshot.random);
        this.restoreRobotInputs(main, snapshot.robotInputs);
        this.restoreSubmittedScore(main, snapshot.submittedScore ?? null);
        this.restoreCurrentMode(main, snapshot.mode);
        this.restoreMusic(main, gc, snapshot.music);
        main.setBrowserSuspended(false);
        main.input.clearKeyPressedRecord();
        main.resetNextFrameTime();
    }

    public isSupportedSnapshot(snapshot: unknown): snapshot is MsPacManGameStateSnapshot {
        return isValidMsPacManGameStateSnapshot(snapshot);
    }

    private captureCurrentMode(main: Main): CurrentModeSnapshot {
        const id = main.getCurrentModeIdForState();
        if (id === "playing") {
            return this.capturePlayingMode(main.getPlayingModeForState());
        }

        return {
            id,
            fields: this.captureFields(main.mode, MODE_FIELDS[id] ?? [])
        };
    }

    private restoreCurrentMode(main: Main, snapshot: CurrentModeSnapshot): void {
        if (snapshot.id === "playing") {
            this.restorePlayingMode(main, snapshot as PlayingModeSnapshot);
            return;
        }

        const fields = MODE_FIELDS[snapshot.id];
        if (fields === undefined) {
            throw new Error(`Unsupported mode for restore: ${snapshot.id}`);
        }
        this.restoreFields(main.getModeForStateRestore(snapshot.id), snapshot.fields, fields);
        if (snapshot.id === "enterInitials") {
            this.restoreSubmittedInitials(main, snapshot);
        }
    }

    private capturePlayingMode(mode: PlayingMode): PlayingModeSnapshot {
        return {
            id: "playing",
            fields: this.captureFields(mode, PLAYING_MODE_FIELDS),
            eatenGhostIndex: mode.eatenGhost === null ? null : mode.ghosts.indexOf(mode.eatenGhost),
            fruitTarget: this.captureFruitTarget(mode.fruitTarget),
            ghosts: mode.ghosts.map((ghost) => ({
                fields: this.captureFields(ghost, GHOST_FIELDS)
            })),
            inputRobotIndex: this.capturePlayingRobotInputIndex(mode),
            mspacman: {
                fields: this.captureFields(mode.mspacman, MSPACMAN_FIELDS)
            }
        };
    }

    private restorePlayingMode(main: Main, snapshot: PlayingModeSnapshot): void {
        const mode = main.getPlayingModeForState();
        this.rebindPlayingMode(mode, main, snapshot.inputRobotIndex);
        this.restoreFields(mode, snapshot.fields, PLAYING_MODE_FIELDS);
        this.restoreFields(mode.mspacman, snapshot.mspacman.fields, MSPACMAN_FIELDS);
        this.rebindThing(mode.mspacman, mode);
        this.setField(mode.mspacman, "input", this.getField(mode, "input"));

        for (let i = 0; i < mode.ghosts.length; i++) {
            const ghost = mode.ghosts[i];
            const ghostSnapshot = snapshot.ghosts[i];
            if (!ghost || !ghostSnapshot) {
                continue;
            }
            this.restoreFields(ghost, ghostSnapshot.fields, GHOST_FIELDS);
            this.rebindThing(ghost, mode);
            this.setField(ghost, "sprites", main.ghostSprites[ghost.ghostIndex]);
        }

        this.restoreFruitTarget(mode, snapshot.fruitTarget);
        mode.eatenGhost = snapshot.eatenGhostIndex === null ? null : (mode.ghosts[snapshot.eatenGhostIndex] ?? null);
        this.rebindPlayingMode(mode, main, snapshot.inputRobotIndex);
    }

    private captureFruitTarget(fruitTarget: object): FruitTargetSnapshot {
        const exitPath = this.getField(fruitTarget, "exitPath");
        return {
            fields: this.captureFields(fruitTarget, FRUIT_TARGET_FIELDS),
            exitPath: Array.isArray(exitPath) ? (this.cloneJson(exitPath as JsonValue) as number[][]) : null
        };
    }

    private restoreFruitTarget(mode: PlayingMode, snapshot: FruitTargetSnapshot): void {
        this.restoreFields(mode.fruitTarget, snapshot.fields, FRUIT_TARGET_FIELDS);
        this.rebindThing(mode.fruitTarget, mode);
        this.setField(mode.fruitTarget, "exitPath", snapshot.exitPath === null ? undefined : this.cloneJson(snapshot.exitPath as unknown as JsonValue));
    }

    private capturePlayingRobotInputIndex(mode: PlayingMode): number | null {
        for (let i = 0; i < mode.main.robotInputs.length; i++) {
            if (this.getField(mode, "input") === mode.main.robotInputs[i]) {
                return i;
            }
        }
        return null;
    }

    private rebindPlayingMode(mode: PlayingMode, main: Main, inputRobotIndex: number | null): void {
        const stage = main.stages[main.worldIndex][main.stageIndex];
        const input = main.demoMode && inputRobotIndex !== null ? main.robotInputs[inputRobotIndex] : main.input;

        mode.main = main;
        mode.input = input;
        mode.tiles = main.tiles[main.stageIndex];
        mode.regionMap = stage.regionMap;
        mode.homeTree = stage.homeTree;
        mode.leftExitMaps = stage.leftExitMaps;
        mode.rightExitMaps = stage.rightExitMaps;
        this.setField(mode.mspacman, "input", input);
    }

    private rebindThing(thing: object, mode: PlayingMode): void {
        this.setField(thing, "playingMode", mode);
        this.setField(thing, "main", mode.main);
    }

    private restoreSubmittedInitials(main: Main, snapshot: ModeSnapshot): void {
        const enterPressed = snapshot.fields.enterPressed;
        const initials = snapshot.fields.initials;
        if (enterPressed !== true || typeof initials !== "string") {
            return;
        }

        this.restoreSubmittedScore(main, {
            initials,
            score: main.score,
            world: main.worldIndex
        });
        this.setField(main, "uploadComplete", true);
    }

    private captureSubmittedScore(main: Main): SubmittedScoreSnapshot | null {
        if (main.submittedScore === null || !isValidSubmittedScoreSnapshot(main.submittedScore)) {
            return null;
        }

        return {
            initials: main.submittedScore.initials,
            score: main.submittedScore.score,
            world: main.submittedScore.world
        };
    }

    private restoreSubmittedScore(main: Main, snapshot: SubmittedScoreSnapshot | null): void {
        if (snapshot === null) {
            return;
        }

        if (!isValidSubmittedScoreSnapshot(snapshot)) {
            return;
        }

        const rows = main.highScores[snapshot.world] ?? [];
        const initials = normalizeHighScoreInitials(snapshot.initials);
        if (rows.some((row) => row.score === snapshot.score && row.initials === initials)) {
            main.submittedScore = {
                initials,
                score: snapshot.score,
                world: snapshot.world
            };
            return;
        }

        main.accessScoresDatabase(true, snapshot.world, snapshot.score, initials);
    }

    private captureMusic(main: Main): MusicSnapshot | null {
        const music = main.currentMusic;
        if (music === null) {
            return null;
        }

        const id = this.musicIdForMusic(main, music);
        if (id === null) {
            return null;
        }

        const looped = Boolean(this.getField(music, "looped"));

        return {
            id,
            looped,
            paused: Boolean(this.getField(music, "paused")),
            playing: music.playing(),
            playbackRate: this.numberField(music, "playbackRate", 1),
            position: this.normalizeMusicPosition(music, music.getPosition(), looped),
            volume: music.getVolume()
        };
    }

    private restoreMusic(main: Main, gc: GameContainer, snapshot: MusicSnapshot | null): void {
        this.stopAudioForMusicRestore(main);
        if (snapshot === null) {
            main.currentMusic = null;
            gc.setMusicOn(!main.paused);
            return;
        }

        const music = this.musicForId(main, snapshot.id);
        const position = this.normalizeMusicPosition(music, snapshot.position, snapshot.looped);
        main.currentMusic = music;
        music.setVolume(snapshot.volume);
        music.setPosition(position);
        if ((snapshot.playing || snapshot.paused) && !main.demoMode) {
            gc.setMusicOn(false);
            if (snapshot.looped) {
                music.loop(snapshot.playbackRate, snapshot.volume);
            } else {
                music.play(snapshot.playbackRate, snapshot.volume);
            }
            this.seekRestoredMusic(main, gc, music, position, snapshot);
        } else {
            music.stop();
            music.setPosition(position);
            main.currentMusic = music;
            gc.setMusicOn(!main.paused);
        }
        music.setVolume(snapshot.volume);
    }

    private stopAudioForMusicRestore(main: Main): void {
        if (main.currentMusic !== null) {
            main.currentMusic.stop();
        }
        main.stopAllSoundEffects();
    }

    private seekRestoredMusic(main: Main, gc: GameContainer, music: Music, position: number, snapshot: MusicSnapshot): void {
        void music
            .ready()
            .then(() => {
                globalThis.setTimeout(() => {
                    if (main.currentMusic !== music) {
                        gc.setMusicOn(!main.paused);
                        return;
                    }

                    music.setPosition(this.normalizeMusicPosition(music, position, snapshot.looped));
                    music.setVolume(snapshot.volume);
                    if (snapshot.paused) {
                        music.pause();
                    }
                    gc.setMusicOn(!main.paused);
                }, 0);
            })
            .catch(() => {
                if (main.currentMusic === music) {
                    gc.setMusicOn(!main.paused);
                }
            });
    }

    private normalizeMusicPosition(music: Music, position: number, looped: boolean): number {
        const sanitized = Number.isFinite(position) ? Math.max(0, position) : 0;
        if (!looped) {
            return sanitized;
        }

        const buffer = this.getField(music, "buffer") as { duration?: unknown } | null;
        const duration = typeof buffer?.duration === "number" ? buffer.duration : 0;
        if (!Number.isFinite(duration) || duration <= 0) {
            return sanitized;
        }

        return sanitized % duration;
    }

    private captureRandom(main: Main): RandomSnapshot {
        return {
            seed0: this.numberField(main.random, "seed0", 0),
            seed1: this.numberField(main.random, "seed1", 0),
            seed2: this.numberField(main.random, "seed2", 0)
        };
    }

    private restoreRandom(main: Main, snapshot: RandomSnapshot): void {
        this.setField(main.random, "seed0", snapshot.seed0);
        this.setField(main.random, "seed1", snapshot.seed1);
        this.setField(main.random, "seed2", snapshot.seed2);
    }

    private captureRobotInput(input: object): RobotInputSnapshot {
        return {
            index: this.numberField(input, "index", 0)
        };
    }

    private restoreRobotInputs(main: Main, snapshots: RobotInputSnapshot[]): void {
        for (let i = 0; i < main.robotInputs.length; i++) {
            const snapshot = snapshots[i];
            if (!snapshot || !main.robotInputs[i]) {
                continue;
            }
            this.setField(main.robotInputs[i], "index", snapshot.index);
        }
    }

    private captureFields(target: object, fields: readonly string[]): JsonRecord {
        const bag = target as FieldBag;
        const snapshot: JsonRecord = {};
        for (const field of fields) {
            const value = bag[field];
            if (value !== undefined) {
                snapshot[field] = this.toJson(value);
            }
        }
        return snapshot;
    }

    private restoreFields(target: object, fields: JsonRecord, expectedFields: readonly string[]): void {
        const bag = target as FieldBag;
        for (const field of expectedFields) {
            const value = fields[field];
            bag[field] = this.cloneJson(value);
        }
    }

    private toJson(value: unknown): JsonValue {
        if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            return value as JsonValue;
        }
        if (Array.isArray(value)) {
            return value.map((entry) => this.toJson(entry));
        }
        if (typeof value === "object") {
            const record: JsonRecord = {};
            for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
                if (entry !== undefined && typeof entry !== "function") {
                    record[key] = this.toJson(entry);
                }
            }
            return record;
        }
        throw new Error(`Unsupported snapshot value: ${String(value)}`);
    }

    private cloneJson<T extends JsonValue>(value: T): T {
        return JSON.parse(JSON.stringify(value)) as T;
    }

    private getField(target: object, field: string): unknown {
        return (target as FieldBag)[field];
    }

    private setField(target: object, field: string, value: unknown): void {
        (target as FieldBag)[field] = value;
    }

    private numberField(target: object, field: string, fallback: number): number {
        const value = this.getField(target, field);
        return typeof value === "number" && Number.isFinite(value) ? value : fallback;
    }

    private musicIdForMusic(main: Main, music: Music): MusicId | null {
        for (let i = 0; i < main.actMusic.length; i++) {
            if (music === main.actMusic[i]) {
                return `act:${i}` as MusicId;
            }
        }
        for (let i = 0; i < main.stageMusic.length; i++) {
            if (music === main.stageMusic[i]) {
                return `stage:${i}` as MusicId;
            }
        }
        if (music === main.gameOverMusic) {
            return "gameOver";
        }
        if (music === main.highScoreMusic) {
            return "highScore";
        }
        if (music === main.introMusic) {
            return "intro";
        }
        if (music === main.levelSelectMusic) {
            return "levelSelect";
        }
        if (music === main.trainingMusic) {
            return "training";
        }
        return null;
    }

    private musicForId(main: Main, id: MusicId): Music {
        switch (id) {
            case "act:0":
                return main.actMusic[0];
            case "act:1":
                return main.actMusic[1];
            case "act:2":
                return main.actMusic[2];
            case "gameOver":
                return main.gameOverMusic;
            case "highScore":
                return main.highScoreMusic;
            case "intro":
                return main.introMusic;
            case "levelSelect":
                return main.levelSelectMusic;
            case "stage:0":
                return main.stageMusic[0];
            case "stage:1":
                return main.stageMusic[1];
            case "stage:2":
                return main.stageMusic[2];
            case "stage:3":
                return main.stageMusic[3];
            case "training":
                return main.trainingMusic;
        }
    }
}
