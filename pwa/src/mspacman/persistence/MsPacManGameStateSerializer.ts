import { Music, isMusicPlaybackSnapshot, isSoundPlaybackSnapshot, type GameContainer, type SoundPlaybackSnapshot } from "slick2d-ts";
import { isMusicId, isSoundId, musicForId, registeredMusic, registeredSounds } from "../AudioRegistry";
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
    type MusicSnapshot,
    type PlayingModeSnapshot,
    type RandomSnapshot,
    type RobotInputSnapshot,
    type SoundSnapshot,
    type SubmittedScoreSnapshot
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
const SNAPSHOT_KEYS = ["version", "appVersion", "savedAt", "mainFields", "mode", "music", "soundEffects", "random", "robotInputs", "submittedScore"] as const;
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
    "enterPressed",
    "juniorReturning",
    "juniorFruits",
    "editVisible",
    "selecting"
]);
const STRING_FIELD_NAMES = new Set<string>(["stageMessage", "initials", "blinkingInitials", "newScoreOf"]);
const NUMBER_ARRAY_FIELD_NAMES = new Set<string>(["regionCounts"]);
const INTEGER_FIELD_RANGES = new Map<string, readonly [number, number]>([
    ["ghostsVisible", [0, 4]],
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
    const mainFields = snapshot.mainFields;
    const mode = snapshot.mode;
    if (!isValidFieldBag(mainFields, MAIN_FIELDS) || !isValidModeSnapshot(mode)) {
        return false;
    }
    const music = snapshot.music;
    const gameplayPaused = mainFields.paused === true;
    if (gameplayPaused && mode.id !== "playing") {
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
    if (!isValidRandomSnapshot(snapshot.random) || !isValidRobotInputs(snapshot.robotInputs)) {
        return false;
    }
    return snapshot.submittedScore === null || isValidSubmittedScoreSnapshot(snapshot.submittedScore);
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
    return Array.isArray(value) && value.length === 4 && value.every((entry) => isValidThingSnapshot(entry, GHOST_FIELDS));
}

function isValidFruitTargetSnapshot(value: unknown): value is FruitTargetSnapshot {
    const snapshot = asRecord(value);
    return (
        snapshot !== null &&
        hasExactKeys(snapshot, FRUIT_TARGET_SNAPSHOT_KEYS) &&
        isValidFieldBag(snapshot.fields, FRUIT_TARGET_FIELDS) &&
        (snapshot.exitPath === null || isValidNumberMatrix(snapshot.exitPath, 31, 28, (entry) => isIntegerInRange(entry, 0, 4)))
    );
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
    if (!Array.isArray(value) || value.length !== 4) {
        return false;
    }
    return value.every((entry) => {
        const snapshot = asRecord(entry);
        return snapshot !== null && hasExactKeys(snapshot, ROBOT_INPUT_SNAPSHOT_KEYS) && isIntegerInRange(snapshot.index, 0, 100000);
    });
}

function isValidSubmittedScoreSnapshot(value: unknown): value is SubmittedScoreSnapshot {
    return isValidSubmittedScoreTuple(value);
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

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
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
            soundEffects: this.captureSoundEffects(main),
            random: this.captureRandom(main),
            robotInputs: main.robotInputs.map((input) => this.captureRobotInput(input)),
            submittedScore: this.captureSubmittedScore(main)
        };
    }

    /** Restore completes synchronously; logical audio is installed before the shell commits its prepared playback generation. */
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
        this.restoreSubmittedScore(main, snapshot.submittedScore);
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
        this.restoreSubmittedScore(main, { initials, score: main.score, world: main.worldIndex });
        this.setField(main, "uploadComplete", true);
    }

    private captureSubmittedScore(main: Main): SubmittedScoreSnapshot | null {
        if (main.submittedScore === null || !isValidSubmittedScoreSnapshot(main.submittedScore)) {
            return null;
        }
        return { initials: main.submittedScore.initials, score: main.submittedScore.score, world: main.submittedScore.world };
    }

    private restoreSubmittedScore(main: Main, snapshot: SubmittedScoreSnapshot | null): void {
        if (snapshot === null || !isValidSubmittedScoreSnapshot(snapshot)) {
            return;
        }
        const rows = main.highScores[snapshot.world] ?? [];
        const initials = normalizeHighScoreInitials(snapshot.initials);
        if (rows.some((row) => row.score === snapshot.score && row.initials === initials)) {
            main.submittedScore = { initials, score: snapshot.score, world: snapshot.world };
            return;
        }
        main.accessScoresDatabase(true, snapshot.world, snapshot.score, initials);
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
