import { Music, isMusicPlaybackSnapshot, isSoundPlaybackSnapshot, type GameContainer, type SoundPlaybackSnapshot } from "slick2d-ts";
import { isMusicId, isSoundId, musicForId, registeredMusic, registeredSounds } from "../AudioRegistry";
import { DEMO_LENGTHS } from "../DemoMetadata";
import type { Main } from "../Main";
import { EnterInitialsMode } from "../EnterInitialsMode";
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
    type MusicSnapshot,
    type PlayingModeSnapshot,
    type RandomSnapshot,
    type RobotInputSnapshot,
    type SoundSnapshot
} from "./GameStateSnapshot";
import { FRUIT_TARGET_FIELDS, GHOST_FIELDS, MAIN_FIELDS, MODE_FIELDS, MSPACMAN_FIELDS, PLAYING_MODE_FIELDS } from "./StateFieldPolicy";

type FieldBag = Record<string, unknown>;

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
const SNAPSHOT_KEYS = ["version", "appVersion", "savedAt", "mainFields", "mode", "music", "soundEffects", "random", "robotInputs"] as const;
const MODE_SNAPSHOT_KEYS = ["id", "fields"] as const;
const PLAYING_MODE_SNAPSHOT_KEYS = ["id", "fields", "eatenGhostIndex", "fruitTarget", "ghosts", "inputRobotIndex", "mspacman"] as const;
const THING_SNAPSHOT_KEYS = ["fields"] as const;
const FRUIT_TARGET_SNAPSHOT_KEYS = ["fields", "exitPath"] as const;
const MUSIC_SNAPSHOT_KEYS = ["id", "playback"] as const;
const SOUND_SNAPSHOT_KEYS = ["id", "playback"] as const;
const RANDOM_SNAPSHOT_KEYS = ["seed0", "seed1", "seed2"] as const;
const ROBOT_INPUT_SNAPSHOT_KEYS = ["index"] as const;
const MAX_SOUND_SNAPSHOTS = 30;
const MAX_SOUND_VOICES = 62;
const EMPTY_SOUND_PLAYBACK: SoundPlaybackSnapshot = Object.freeze({ voices: Object.freeze([]), activeVoiceIndex: null });
const BOOLEAN_FIELD_NAMES = new Set<string>([
    "paused",
    "fadeMusicFlag",
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
    "enterPressed",
    "juniorReturning",
    "juniorFruits",
    "editVisible",
    "selecting"
]);
const STRING_FIELD_NAMES = new Set<string>(["stageMessage", "initials", "blinkingInitials", "newScoreOf"]);
const NUMBER_ARRAY_FIELD_NAMES = new Set<string>(["regionCounts"]);
const INTEGER_FIELD_RANGES = new Map<string, readonly [number, number]>([
    ["highScoreQualificationCutoff", [0, 2_147_483_647]],
    ["ghostsVisible", [0, 4]],
    ["worldIndex", [0, 3]],
    ["stageIndex", [0, 8]],
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
    const mainFields = snapshot.mainFields;
    const mode = snapshot.mode;
    if (!isValidFieldBag(mainFields, MAIN_FIELDS) || !isValidMainFieldState(mainFields) || !isValidModeSnapshot(mode)) {
        return false;
    }
    if (!isValidStageIndexForMode(mainFields.stageIndex, mode.id)) {
        return false;
    }
    const music = snapshot.music;
    const gameplayPaused = mainFields.paused === true;
    const demoMode = mainFields.demoMode === true;
    if (gameplayPaused && mode.id !== "playing") {
        return false;
    }
    if (demoMode) {
        const demoIndex = mainFields.demoIndex;
        if (mode.id !== "playing" || gameplayPaused || mode.inputRobotIndex === null || !isIntegerInRange(demoIndex, 0, DEMO_LENGTHS.length - 1)) {
            return false;
        }
        const activeDemoIndex = (demoIndex + DEMO_LENGTHS.length - 1) % DEMO_LENGTHS.length;
        if (
            mode.inputRobotIndex !== activeDemoIndex ||
            mainFields.stageIndex !== activeDemoIndex ||
            mainFields.worldIndex !== activeDemoIndex ||
            mainFields.lives !== 5
        ) {
            return false;
        }
    } else if (mode.id === "playing" && mode.inputRobotIndex !== null) {
        return false;
    }
    if (music !== null) {
        if (!isValidMusicSnapshot(music)) {
            return false;
        }
        if (music.playback.transport === "paused" && !gameplayPaused) {
            return false;
        }
        if (gameplayPaused && music.playback.transport === "playing") {
            return false;
        }
    }
    if (!isValidSoundEffects(snapshot.soundEffects)) {
        return false;
    }
    return isValidRandomSnapshot(snapshot.random) && isValidRobotInputs(snapshot.robotInputs);
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
            isValidPlayingModeFieldState(snapshot.fields) &&
            isNullableIntegerInRange(snapshot.eatenGhostIndex, 0, 3) &&
            isNullableIntegerInRange(snapshot.inputRobotIndex, 0, 3) &&
            isValidThingSnapshot(snapshot.mspacman, MSPACMAN_FIELDS, "mspacman") &&
            isValidGhostSnapshots(snapshot.ghosts) &&
            isValidFruitTargetSnapshot(snapshot.fruitTarget) &&
            isValidPlayingObjectRelationships(snapshot as unknown as PlayingModeSnapshot)
        );
    }
    const fields = MODE_FIELDS[snapshot.id];
    if (fields === undefined || !hasExactKeys(snapshot, MODE_SNAPSHOT_KEYS) || !isValidFieldBag(snapshot.fields, fields)) {
        return false;
    }
    return isValidStandaloneModeFieldState(snapshot.id, snapshot.fields);
}

function isValidEnterInitialsState(fields: Record<string, unknown>): boolean {
    const initials = fields.initials;
    const editingIndex = fields.editingIndex;
    const blinkTimer = fields.blinkTimer;
    const enterPressed = fields.enterPressed;
    return (
        typeof initials === "string" &&
        initials.length === 3 &&
        /^[A-Z ]{3}$/.test(initials) &&
        isIntegerInRange(editingIndex, 0, 2) &&
        isIntegerInRange(blinkTimer, 0, 44) &&
        typeof enterPressed === "boolean" &&
        (!enterPressed || editingIndex === 2)
    );
}

function isValidThingSnapshot(value: unknown, fields: readonly string[], kind: "mspacman" | "ghost" | "fruit"): boolean {
    const snapshot = asRecord(value);
    return (
        snapshot !== null &&
        hasExactKeys(snapshot, THING_SNAPSHOT_KEYS) &&
        isValidFieldBag(snapshot.fields, fields) &&
        isValidThingFieldState(snapshot.fields, kind)
    );
}

function isValidGhostSnapshots(value: unknown): boolean {
    return (
        Array.isArray(value) &&
        value.length === 4 &&
        value.every((entry, index) => {
            const snapshot = asRecord(entry);
            return isValidThingSnapshot(entry, GHOST_FIELDS, "ghost") && snapshot !== null && asRecord(snapshot.fields)?.ghostIndex === index;
        })
    );
}

function isValidFruitTargetSnapshot(value: unknown): value is FruitTargetSnapshot {
    const snapshot = asRecord(value);
    if (
        snapshot === null ||
        !hasExactKeys(snapshot, FRUIT_TARGET_SNAPSHOT_KEYS) ||
        !isValidFieldBag(snapshot.fields, FRUIT_TARGET_FIELDS) ||
        !isValidThingFieldState(snapshot.fields, "fruit") ||
        !(snapshot.exitPath === null || isValidNumberMatrix(snapshot.exitPath, 31, 28, (entry) => isIntegerInRange(entry, 0, 4)))
    ) {
        return false;
    }
    return snapshot.fields.exiting !== true || snapshot.exitPath !== null;
}

function isValidMainFieldState(fields: Record<string, unknown>): boolean {
    return (
        isIntegerInRange(fields.worldIndex, 0, 3) &&
        isIntegerInRange(fields.stageIndex, 0, 8) &&
        isIntegerInRange(fields.score, 0, 2_147_483_647) &&
        isIntegerInRange(fields.highScoreQualificationCutoff, 0, 2_147_483_647) &&
        isIntegerInRange(fields.lives, 0, 6) &&
        typeof fields.paused === "boolean" &&
        isFiniteNumberInRange(fields.musicVolume, 0, 1) &&
        isFiniteNumberInRange(fields.musicVolumeFadeStep, 0, 1) &&
        typeof fields.fadeMusicFlag === "boolean" &&
        isIntegerInRange(fields.demoIndex, 0, 3) &&
        typeof fields.demoMode === "boolean"
    );
}

function isValidPlayingModeFieldState(fields: Record<string, unknown>): boolean {
    const pelletCount = fields.pelletCount;
    const pelletsRemaining = fields.pelletsRemaining;
    const regionCounts = fields.regionCounts;
    const spawnFlags = [fields.fruitTargetPresent, fields.redEnergizerPresent, fields.greenEnergizerPresent].filter((value) => value === true).length;
    return (
        isFiniteNumberInRange(fields.pelletCountFraction, 0, 1, false) &&
        isIntegerInRange(pelletCount, 1, 31 * 28) &&
        isIntegerInRange(pelletsRemaining, 0, pelletCount) &&
        Array.isArray(regionCounts) &&
        regionCounts.length > 0 &&
        regionCounts.length <= 31 * 28 &&
        regionCounts.every((value) => isIntegerInRange(value, 0, 4)) &&
        isIntegerInRange(fields.exitIndex, 1, 4) &&
        isIntegerInRange(fields.exitDelay, 0, 10_000) &&
        typeof fields.chaseMode === "boolean" &&
        isIntegerInRange(fields.chaseModeToggleDelay, 0, 20 * 91) &&
        typeof fields.ghostsBlue === "boolean" &&
        (fields.ghostsBlueOffset === 0 || fields.ghostsBlueOffset === 2) &&
        isIntegerInRange(fields.ghostsBlueTimer, 0, 100_000) &&
        typeof fields.showGhostPoints === "boolean" &&
        isIntegerInRange(fields.showGhostPointsTimer, 0, 91) &&
        isIntegerInRange(fields.ghostPointsIndex, -1, 3) &&
        typeof fields.energizersVisible === "boolean" &&
        isIntegerInRange(fields.energizersVisibleTimer, 0, 22) &&
        typeof fields.finished === "boolean" &&
        isIntegerInRange(fields.finishedTimer, 0, 600) &&
        typeof fields.finishedWhite === "boolean" &&
        isIntegerInRange(fields.finishedBlinkTimer, 0, 22) &&
        typeof fields.fruitTargetPresent === "boolean" &&
        isIntegerInRange(fields.fruitTargetTimer, 0, 10 * 91) &&
        typeof fields.redEnergizerPresent === "boolean" &&
        typeof fields.greenEnergizerPresent === "boolean" &&
        spawnFlags <= 1 &&
        isIntegerInRange(fields.energizerTimer, 0, 7 * 91) &&
        typeof fields.playerKilledFlag === "boolean" &&
        isIntegerInRange(fields.musicFadeOutTimer, 0, 91) &&
        typeof fields.playerSpiraling === "boolean" &&
        isIntegerInRange(fields.spiralTimer, 0, 2 * 91) &&
        isIntegerInRange(fields.readyTimer, 0, 91) &&
        typeof fields.stageMessage === "string" &&
        /^STAGE [1-8] OF 8$/.test(fields.stageMessage) &&
        isFiniteNumberInRange(fields.fruitOdds, 0, 1) &&
        isFiniteNumberInRange(fields.redPelletOdds, 0, 1) &&
        fields.redPelletOdds <= fields.fruitOdds &&
        isIntegerInRange(fields.exitDelayTarget, 1, 3 * 91) &&
        isIntegerInRange(fields.fadeIndex, 0, 22) &&
        isIntegerInRange(fields.fadeState, 0, 2) &&
        isIntegerInRange(fields.fadeReason, 0, 2) &&
        typeof fields.gameOver === "boolean" &&
        isIntegerInRange(fields.gameOverTimer, 0, 5 * 91)
    );
}

function isValidPlayingObjectRelationships(snapshot: PlayingModeSnapshot): boolean {
    const showGhostPoints = snapshot.fields.showGhostPoints === true;
    if ((snapshot.eatenGhostIndex !== null) !== showGhostPoints) {
        return false;
    }
    if (snapshot.eatenGhostIndex !== null) {
        const eaten = snapshot.ghosts[snapshot.eatenGhostIndex];
        if (eaten === undefined || eaten.fields.eyeBalls !== true) {
            return false;
        }
    }
    return true;
}

function isValidThingFieldState(fields: unknown, kind: "mspacman" | "ghost" | "fruit"): boolean {
    const record = asRecord(fields);
    if (
        record === null ||
        !isIntegerInRange(record.x, -64, 512) ||
        !isIntegerInRange(record.y, -64, 544) ||
        !isFiniteNumberInRange(record.speed, 0, 10) ||
        !isFiniteNumberInRange(record.speedRemainder, 0, 1, true) ||
        !isIntegerInRange(record.direction, 0, 3)
    ) {
        return false;
    }
    if (kind === "mspacman") {
        return (
            isIntegerInRange(record.spriteIndex, 0, 3) &&
            isIntegerInRange(record.spriteIndexIncrementor, 0, 5) &&
            typeof record.pellotDampensSpeed === "boolean" &&
            isIntegerInRange(record.pellotDampensSpeedCount, 0, 10) &&
            typeof record.corneringEnhancesSpeed === "boolean" &&
            isIntegerInRange(record.corneringEnhancesSpeedCount, 0, 10) &&
            typeof record.speedBoost === "boolean" &&
            isIntegerInRange(record.speedBoostTimer, 0, 7 * 91)
        );
    }
    if (kind === "ghost") {
        return (
            typeof record.blue === "boolean" &&
            typeof record.eyeBalls === "boolean" &&
            isIntegerInRange(record.ghostIndex, 0, 3) &&
            isIntegerInRange(record.spriteIndex, 0, 1) &&
            isIntegerInRange(record.spriteIndexIncrementor, 0, 14) &&
            isIntegerInRange(record.targetX, -4096, 4096) &&
            isIntegerInRange(record.targetY, -4096, 4096) &&
            typeof record.inHome === "boolean" &&
            typeof record.exitingHome === "boolean" &&
            typeof record.enteringHome === "boolean"
        );
    }
    return (
        isIntegerInRange(record.fruitIndex, 0, 6) &&
        isIntegerInRange(record.yOffset, -16, 16) &&
        isFiniteNumber(record.yOffsetAngle) &&
        typeof record.goingAroundHome === "boolean" &&
        typeof record.clockwise === "boolean" &&
        isIntegerInRange(record.aroundHomeIndex, 0, 4) &&
        typeof record.exiting === "boolean" &&
        isIntegerInRange(record.eatenTimer, 0, 90) &&
        typeof record.eaten === "boolean"
    );
}

function isValidStandaloneModeFieldState(id: Exclude<ModeId, "playing">, fields: Record<string, unknown>): boolean {
    if (Object.hasOwn(fields, "fadeIndex") && !isIntegerInRange(fields.fadeIndex, 0, 22)) return false;
    if (Object.hasOwn(fields, "fadeState") && !isIntegerInRange(fields.fadeState, 0, 2)) return false;
    if (Object.hasOwn(fields, "fadeIndex2") && !isIntegerInRange(fields.fadeIndex2, 0, 22)) return false;
    if (Object.hasOwn(fields, "fadeState2") && !isIntegerInRange(fields.fadeState2, 0, 2)) return false;
    if (Object.hasOwn(fields, "topClapperIndex") && !isIntegerInRange(fields.topClapperIndex, 0, 2)) return false;
    if (Object.hasOwn(fields, "substate") && !isIntegerInRange(fields.substate, 0, 4)) return false;
    if (Object.hasOwn(fields, "timer") && !isIntegerInRange(fields.timer, 0, 1_000_000)) return false;
    if (Object.hasOwn(fields, "ghostSpriteIndex") && !isIntegerInRange(fields.ghostSpriteIndex, 0, 1)) return false;
    if (Object.hasOwn(fields, "ghostSpriteIndexIncrementor") && !isIntegerInRange(fields.ghostSpriteIndexIncrementor, 0, 14)) return false;
    if (Object.hasOwn(fields, "chompSpriteIndex") && !isIntegerInRange(fields.chompSpriteIndex, 0, 3)) return false;
    if (Object.hasOwn(fields, "chompSpriteIndexIncrementor") && !isIntegerInRange(fields.chompSpriteIndexIncrementor, 0, 5)) return false;
    if (Object.hasOwn(fields, "stringIndex") && !isIntegerInRange(fields.stringIndex, 0, 4096)) return false;
    if (Object.hasOwn(fields, "stringTimer") && !isIntegerInRange(fields.stringTimer, 0, 2 * 91)) return false;
    if (Object.hasOwn(fields, "tone") && !isIntegerInRange(fields.tone, 0, 1)) return false;
    if (Object.hasOwn(fields, "mspacmanIndex") && !isIntegerInRange(fields.mspacmanIndex, 0, 2)) return false;
    if (Object.hasOwn(fields, "pacmanIndex") && !isIntegerInRange(fields.pacmanIndex, 0, 2)) return false;

    switch (id) {
        case "act1":
            return isIntegerInRange(fields.state, 0, 2);
        case "act2":
            return isIntegerInRange(fields.state, 0, 5);
        case "act3":
            return isIntegerInRange(fields.state, 0, 3);
        case "act4":
        case "act5":
        case "act7":
            return isIntegerInRange(fields.state, 0, 1) && (!Object.hasOwn(fields, "dialogIndex") || isIntegerInRange(fields.dialogIndex, 0, 2));
        case "act6":
            return isIntegerInRange(fields.state, 0, 2);
        case "attract":
            return (
                isIntegerInRange(fields.state, 0, 3) &&
                isIntegerInRange(fields.pressEnterDelay, 0, 35) &&
                isIntegerInRange(fields.ghostsVisible, 0, 4) &&
                isIntegerInRange(fields.ticks, 0, 3387) &&
                isIntegerInRange(fields.countDown, 0, 60)
            );
        case "ending":
            return (
                isIntegerInRange(fields.state, 0, 3) &&
                isIntegerInRange(fields.dialogIndex, 0, 14) &&
                isIntegerInRange(fields.delay, 0, 2 * 91) &&
                isFiniteNumberInRange(fields.creditsY, -4096, 4096)
            );
        case "enterInitials":
            return isValidEnterInitialsState(fields);
        case "hallOfFame":
            return isIntegerInRange(fields.pressEnterDelay, 0, 35) && isIntegerInRange(fields.ticks, 0, 911) && isIntegerInRange(fields.countDown, 0, 60);
        case "intro":
            return true;
        case "selectWorld":
            return isIntegerInRange(fields.selection, 0, 3) && isIntegerInRange(fields.selectIndex, 0, 22) && isIntegerInRange(fields.countDown, 0, 60);
    }
}

function isValidMusicSnapshot(value: unknown): value is MusicSnapshot {
    const snapshot = asRecord(value);
    return (
        snapshot !== null &&
        hasExactKeys(snapshot, MUSIC_SNAPSHOT_KEYS) &&
        isMusicId(snapshot.id) &&
        isMusicPlaybackSnapshot(snapshot.playback) &&
        snapshot.playback.transport !== "stopped"
    );
}

function isValidSoundEffects(value: unknown): value is SoundSnapshot[] {
    if (!Array.isArray(value) || value.length > MAX_SOUND_SNAPSHOTS) {
        return false;
    }
    const ids = new Set<string>();
    let voiceCount = 0;
    for (const entry of value) {
        const snapshot = asRecord(entry);
        if (snapshot === null || !hasExactKeys(snapshot, SOUND_SNAPSHOT_KEYS) || !isSoundId(snapshot.id) || ids.has(snapshot.id)) {
            return false;
        }
        if (!isSoundPlaybackSnapshot(snapshot.playback) || snapshot.playback.voices.length === 0) {
            return false;
        }
        ids.add(snapshot.id);
        voiceCount += snapshot.playback.voices.length;
        if (voiceCount > MAX_SOUND_VOICES) {
            return false;
        }
    }
    return true;
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
    if (!Array.isArray(value) || value.length !== DEMO_LENGTHS.length) {
        return false;
    }
    return value.every((entry, index) => {
        const snapshot = asRecord(entry);
        const maximum = DEMO_LENGTHS[index];
        return maximum !== undefined && snapshot !== null && hasExactKeys(snapshot, ROBOT_INPUT_SNAPSHOT_KEYS) && isIntegerInRange(snapshot.index, 0, maximum);
    });
}

function isValidFieldBag(value: unknown, fields: readonly string[]): value is JsonRecord {
    const record = asRecord(value);
    return record !== null && hasExactKeys(record, fields) && fields.every((field) => isValidFieldValue(field, record[field]));
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
    return integerRange !== undefined ? isIntegerInRange(value, integerRange[0], integerRange[1]) : isFiniteNumber(value);
}

function isValidNumberArray(value: unknown): boolean {
    return Array.isArray(value) && value.length > 0 && value.length <= 31 * 28 && value.every((entry) => isIntegerInRange(entry, 0, Number.MAX_SAFE_INTEGER));
}

function isValidNumberMatrix(value: unknown, rows: number, columns: number, entryValidator: (value: unknown) => boolean): boolean {
    return Array.isArray(value) && value.length === rows && value.every((row) => Array.isArray(row) && row.length === columns && row.every(entryValidator));
}

function isValidEnergizerLocations(value: unknown): boolean {
    return (
        Array.isArray(value) &&
        value.length === 4 &&
        value.every((row) => Array.isArray(row) && row.length === 2 && isIntegerInRange(row[0], 0, 27) && isIntegerInRange(row[1], 0, 30))
    );
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
    const ownKeys = Object.keys(record);
    return ownKeys.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(record, key));
}

function isModeId(value: unknown): value is ModeId {
    return typeof value === "string" && (MODE_IDS as readonly string[]).includes(value);
}

export function isValidStageIndexForMode(stageIndex: unknown, modeId: ModeId): boolean {
    if (!isIntegerInRange(stageIndex, 0, 8)) {
        return false;
    }
    switch (modeId) {
        case "playing":
            return stageIndex <= 7;
        case "act1":
            return stageIndex === 1;
        case "act2":
            return stageIndex === 2;
        case "act3":
            return stageIndex === 3;
        case "act4":
            return stageIndex === 4;
        case "act5":
            return stageIndex === 5;
        case "act6":
            return stageIndex === 6;
        case "act7":
            return stageIndex === 7;
        case "ending":
            return stageIndex === 8;
        case "attract":
        case "intro":
            return stageIndex === 0;
        case "enterInitials":
        case "hallOfFame":
        case "selectWorld":
            return true;
    }
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function isFiniteNumberInRange(value: unknown, min: number, max: number, exclusiveMax: boolean = false): value is number {
    return isFiniteNumber(value) && value >= min && (exclusiveMax ? value < max : value <= max);
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isNullableIntegerInRange(value: unknown, min: number, max: number): boolean {
    return value === null || isIntegerInRange(value, min, max);
}

export function isValidSnapshotForLoadedResources(main: Main, snapshot: MsPacManGameStateSnapshot): boolean {
    if (snapshot.mode.id !== "playing") {
        return true;
    }
    const worldIndex = snapshot.mainFields.worldIndex;
    const stageIndex = snapshot.mainFields.stageIndex;
    if (!isIntegerInRange(worldIndex, 0, 3) || !isIntegerInRange(stageIndex, 0, 7)) {
        return false;
    }
    const stage = main.stages?.[worldIndex]?.[stageIndex];
    if (stage === undefined) {
        return false;
    }
    const fields = snapshot.mode.fields;
    if (
        !Number.isInteger(stage.regionCount) ||
        stage.regionCount <= 0 ||
        !Number.isInteger(stage.pelletCount) ||
        stage.pelletCount <= 0 ||
        !Array.isArray(fields.regionCounts) ||
        fields.regionCounts.length !== stage.regionCount ||
        fields.pelletCount !== stage.pelletCount ||
        fields.stageMessage !== `STAGE ${stageIndex + 1} OF 8`
    ) {
        return false;
    }
    if (!isValidStageEnergizerLocations(stage.tileMap, fields.energizerLocations)) {
        return false;
    }
    for (let i = 0; i < snapshot.mode.ghosts.length; i++) {
        if (snapshot.mode.ghosts[i]?.fields.ghostIndex !== i) {
            return false;
        }
    }
    const fruit = snapshot.mode.fruitTarget;
    if (fruit.exitPath !== null) {
        const sideCandidates = fruit.fields.clockwise === true ? stage.rightExitMaps : stage.leftExitMaps;
        const allCandidates = [...stage.leftExitMaps, ...stage.rightExitMaps];
        const candidates = fruit.fields.exiting === true ? sideCandidates : allCandidates;
        if (!Array.isArray(candidates) || !candidates.some((candidate) => numberMatricesEqual(candidate, fruit.exitPath))) {
            return false;
        }
    }
    return fruit.fields.exiting !== true || fruit.exitPath !== null;
}

function isValidStageEnergizerLocations(tileMap: unknown, saved: unknown): boolean {
    if (!Array.isArray(tileMap) || !Array.isArray(saved)) {
        return false;
    }
    const expected: number[][] = [];
    for (let y = 0; y < tileMap.length; y++) {
        const row = tileMap[y];
        if (!Array.isArray(row)) {
            return false;
        }
        for (let x = 0; x < row.length; x++) {
            if (row[x] === 49) {
                expected.push([x, y]);
            }
        }
    }
    return numberMatricesEqual(expected, saved);
}

function numberMatricesEqual(a: unknown, b: unknown): boolean {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
        return false;
    }
    for (let y = 0; y < a.length; y++) {
        const rowA = a[y];
        const rowB = b[y];
        if (!Array.isArray(rowA) || !Array.isArray(rowB) || rowA.length !== rowB.length) {
            return false;
        }
        for (let x = 0; x < rowA.length; x++) {
            if (rowA[x] !== rowB[x]) {
                return false;
            }
        }
    }
    return true;
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
            soundEffects: this.captureSoundEffects(main),
            random: this.captureRandom(main),
            robotInputs: main.robotInputs.map((input) => this.captureRobotInput(input))
        };
    }

    /** Restore completes synchronously; logical audio is installed before the shell commits its prepared playback generation. */
    public restoreSnapshot(main: Main, gc: GameContainer, snapshot: MsPacManGameStateSnapshot): void {
        if (!this.isSupportedSnapshot(snapshot) || !isValidSnapshotForLoadedResources(main, snapshot)) {
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
        this.restoreCurrentMode(main, snapshot.mode);
        Music.resetPlaybackState();
        this.restoreMusic(main, snapshot.music);
        this.restoreSoundEffects(main, snapshot.soundEffects);
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
        return { id, fields: this.captureFields(main.mode, MODE_FIELDS[id] ?? []) };
    }

    private restoreCurrentMode(main: Main, snapshot: CurrentModeSnapshot): void {
        if (snapshot.id === "playing") {
            this.restorePlayingMode(main, snapshot);
            return;
        }
        const fields = MODE_FIELDS[snapshot.id];
        if (fields === undefined) {
            throw new Error(`Unsupported mode for restore: ${snapshot.id}`);
        }
        const mode = main.getModeForStateRestore(snapshot.id);
        this.restoreFields(mode, snapshot.fields, fields);
        if (snapshot.id === "enterInitials") {
            if (!(mode instanceof EnterInitialsMode)) {
                throw new Error("Enter Initials save state did not restore into EnterInitialsMode.");
            }
            mode.reconcileStateAfterRestore();
            this.restoreSubmittedInitials(main, snapshot);
        }
    }

    private capturePlayingMode(mode: PlayingMode): PlayingModeSnapshot {
        return {
            id: "playing",
            fields: this.captureFields(mode, PLAYING_MODE_FIELDS),
            eatenGhostIndex: mode.eatenGhost === null ? null : mode.ghosts.indexOf(mode.eatenGhost),
            fruitTarget: this.captureFruitTarget(mode.fruitTarget),
            ghosts: mode.ghosts.map((ghost) => ({ fields: this.captureFields(ghost, GHOST_FIELDS) })),
            inputRobotIndex: this.capturePlayingRobotInputIndex(mode),
            mspacman: { fields: this.captureFields(mode.mspacman, MSPACMAN_FIELDS) }
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
        // The browser request that originally submitted these initials cannot
        // survive a page lifetime. Rebuild only the local leaderboard mutation;
        // accessScoresDatabase() is synchronous and does not perform network I/O.
        main.accessScoresDatabase(true, main.worldIndex, main.score, initials);
        this.setField(main, "uploadComplete", true);
    }

    private captureMusic(main: Main): MusicSnapshot | null {
        const active: MusicSnapshot[] = [];
        for (const { id, music } of registeredMusic(main)) {
            const playback = music.capturePlaybackState();
            if (playback.transport !== "stopped") {
                active.push({ id, playback });
            }
        }
        if (active.length > 1) {
            throw new Error(`Multiple registered Music transports are active: ${active.map((entry) => entry.id).join(", ")}`);
        }
        return active[0] ?? null;
    }

    private restoreMusic(main: Main, snapshot: MusicSnapshot | null): void {
        if (snapshot === null) {
            main.currentMusic = null;
            return;
        }
        const music = musicForId(main, snapshot.id);
        music.restorePlaybackState(main.demoMode ? { ...snapshot.playback, transport: "stopped", fade: null } : snapshot.playback);
        main.currentMusic = music;
    }

    private captureSoundEffects(main: Main): SoundSnapshot[] {
        const snapshots: SoundSnapshot[] = [];
        for (const { id, sound } of registeredSounds(main)) {
            const playback = sound.capturePlaybackState();
            if (playback.voices.length !== 0) {
                snapshots.push({ id, playback });
            }
        }
        return snapshots;
    }

    private restoreSoundEffects(main: Main, snapshots: SoundSnapshot[]): void {
        const byId = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot.playback] as const));
        for (const { id, sound } of registeredSounds(main)) {
            sound.restorePlaybackState(byId.get(id) ?? EMPTY_SOUND_PLAYBACK);
        }
    }

    private captureRandom(main: Main): RandomSnapshot {
        return main.random.getState();
    }

    private restoreRandom(main: Main, snapshot: RandomSnapshot): void {
        main.random.setState(snapshot);
    }

    private captureRobotInput(input: { getState(): RobotInputSnapshot }): RobotInputSnapshot {
        return input.getState();
    }

    private restoreRobotInputs(main: Main, snapshots: RobotInputSnapshot[]): void {
        for (let i = 0; i < main.robotInputs.length; i++) {
            const snapshot = snapshots[i];
            if (snapshot && main.robotInputs[i]) {
                main.robotInputs[i].setState(snapshot);
            }
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
            bag[field] = this.cloneJson(fields[field]);
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
}
