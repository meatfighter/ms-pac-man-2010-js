import type { GameContainer, Music } from "slick2d-ts";
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

const THING_FIELDS = [
    "x",
    "y",
    "speed",
    "speedRemainder",
    "direction"
] as const;

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
    hallOfFame: [
        "pressEnterDelay",
        "pressEnterVisible",
        "dotsOffset",
        "redOffset",
        "enterPressed",
        "fadeIndex",
        "fadeState",
        "ticks",
        "countDown"
    ],
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
        this.restoreFields(main, snapshot.mainFields);
        if (snapshot.mode.id === "playing") {
            this.setField(main, "demoMode", false);
        }

        main.initModeForRestore(mode, gc);
        this.restoreFields(main, snapshot.mainFields);
        this.restoreRandom(main, snapshot.random);
        this.restoreRobotInputs(main, snapshot.robotInputs);
        this.restoreSubmittedScore(main, snapshot.submittedScore ?? null);
        this.restoreCurrentMode(main, snapshot.mode);
        this.restoreMusic(main, gc, snapshot.music);
        main.setBrowserSuspended(false);
        gc.setMusicOn(!main.paused);
        main.input.clearKeyPressedRecord();
        main.resetNextFrameTime();
    }

    public isSupportedSnapshot(snapshot: MsPacManGameStateSnapshot): boolean {
        if (!snapshot || snapshot.version !== GAME_STATE_VERSION) {
            return false;
        }
        if (!snapshot.mode || !MODE_IDS.includes(snapshot.mode.id)) {
            return false;
        }
        if (snapshot.music !== null && !MUSIC_IDS.includes(snapshot.music.id)) {
            return false;
        }
        return true;
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

        this.restoreFields(main.getModeForStateRestore(snapshot.id), snapshot.fields);
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
        this.restoreFields(mode, snapshot.fields);
        this.restoreFields(mode.mspacman, snapshot.mspacman.fields);
        this.rebindThing(mode.mspacman, mode);
        this.setField(mode.mspacman, "input", this.getField(mode, "input"));

        for (let i = 0; i < mode.ghosts.length; i++) {
            const ghost = mode.ghosts[i];
            const ghostSnapshot = snapshot.ghosts[i];
            if (!ghost || !ghostSnapshot) {
                continue;
            }
            this.restoreFields(ghost, ghostSnapshot.fields);
            this.rebindThing(ghost, mode);
            this.setField(ghost, "sprites", main.ghostSprites[ghost.ghostIndex]);
        }

        this.restoreFruitTarget(mode, snapshot.fruitTarget);
        mode.eatenGhost = snapshot.eatenGhostIndex === null ? null : mode.ghosts[snapshot.eatenGhostIndex] ?? null;
        this.rebindPlayingMode(mode, main, snapshot.inputRobotIndex);
    }

    private captureFruitTarget(fruitTarget: object): FruitTargetSnapshot {
        const exitPath = this.getField(fruitTarget, "exitPath");
        return {
            fields: this.captureFields(fruitTarget, FRUIT_TARGET_FIELDS),
            exitPath: Array.isArray(exitPath) ? this.cloneJson(exitPath as JsonValue) as number[][] : null
        };
    }

    private restoreFruitTarget(mode: PlayingMode, snapshot: FruitTargetSnapshot): void {
        this.restoreFields(mode.fruitTarget, snapshot.fields);
        this.rebindThing(mode.fruitTarget, mode);
        this.setField(
            mode.fruitTarget,
            "exitPath",
            snapshot.exitPath === null ? undefined : this.cloneJson(snapshot.exitPath as unknown as JsonValue)
        );
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

        if (main.uploadComplete) {
            this.restoreSubmittedScore(main, {
                initials,
                score: main.score,
                world: main.worldIndex
            });
        } else {
            main.accessScoresDatabaseAsync(true, main.worldIndex, main.score, initials);
        }
    }

    private captureSubmittedScore(main: Main): SubmittedScoreSnapshot | null {
        if (main.score <= 0) {
            return null;
        }

        const rows = main.highScores[main.worldIndex] ?? [];
        const row = rows.find((score) => score.score === main.score);
        if (!row) {
            return null;
        }

        return {
            initials: row.initials,
            score: row.score,
            world: main.worldIndex
        };
    }

    private restoreSubmittedScore(main: Main, snapshot: SubmittedScoreSnapshot | null): void {
        if (snapshot === null) {
            return;
        }

        const rows = main.highScores[snapshot.world] ?? [];
        const initials = snapshot.initials.padEnd(3, " ").substring(0, 3);
        if (rows.some((row) => row.score === snapshot.score && row.initials === initials)) {
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

        return {
            id,
            looped: Boolean(this.getField(music, "looped")),
            paused: Boolean(this.getField(music, "paused")),
            playing: music.playing(),
            playbackRate: this.numberField(music, "playbackRate", 1),
            position: music.getPosition(),
            volume: music.getVolume()
        };
    }

    private restoreMusic(main: Main, gc: GameContainer, snapshot: MusicSnapshot | null): void {
        this.stopAudioForMusicRestore(main);
        if (snapshot === null) {
            main.currentMusic = null;
            return;
        }

        const music = this.musicForId(main, snapshot.id);
        main.currentMusic = music;
        music.setVolume(snapshot.volume);
        music.setPosition(snapshot.position);
        if ((snapshot.playing || snapshot.paused) && !main.demoMode) {
            if (snapshot.looped) {
                music.loop(snapshot.playbackRate, snapshot.volume);
            } else {
                music.play(snapshot.playbackRate, snapshot.volume);
            }
            music.setPosition(snapshot.position);
            if (snapshot.paused) {
                music.pause();
            }
        } else {
            music.stop();
            music.setPosition(snapshot.position);
            main.currentMusic = music;
        }
        music.setVolume(snapshot.volume);
        gc.setMusicOn(!main.paused);
    }

    private stopAudioForMusicRestore(main: Main): void {
        if (main.currentMusic !== null) {
            main.currentMusic.stop();
        }
        main.stopAllSoundEffects();
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

    private restoreFields(target: object, fields: JsonRecord): void {
        const bag = target as FieldBag;
        for (const [field, value] of Object.entries(fields)) {
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
