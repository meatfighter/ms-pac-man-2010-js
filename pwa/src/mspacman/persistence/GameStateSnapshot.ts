import type { MusicPlaybackSnapshot } from "slick2d-ts";

// Development cutover: only this schema is supported; earlier test saves are not migrated.
export const GAME_STATE_VERSION = 5;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonRecord;
export type JsonRecord = { [key: string]: JsonValue };

export type ModeId =
    "act1" | "act2" | "act3" | "act4" | "act5" | "act6" | "act7" | "attract" | "ending" | "enterInitials" | "hallOfFame" | "intro" | "playing" | "selectWorld";

export type MusicId =
    "act:0" | "act:1" | "act:2" | "gameOver" | "highScore" | "intro" | "levelSelect" | "stage:0" | "stage:1" | "stage:2" | "stage:3" | "training";

export interface RandomSnapshot {
    seed0: number;
    seed1: number;
    seed2: number;
}

export interface MusicSnapshot {
    id: MusicId;
    playback: MusicPlaybackSnapshot;
}

export interface AudioSettingsSnapshot {
    musicOn: boolean;
    soundOn: boolean;
}

export interface RobotInputSnapshot {
    index: number;
}

export interface SubmittedScoreSnapshot {
    initials: string;
    score: number;
    world: number;
}

export interface ModeSnapshot {
    id: ModeId;
    fields: JsonRecord;
}

export interface ThingSnapshot {
    fields: JsonRecord;
}

export interface FruitTargetSnapshot extends ThingSnapshot {
    exitPath: number[][] | null;
}

export interface PlayingModeSnapshot extends ModeSnapshot {
    eatenGhostIndex: number | null;
    fruitTarget: FruitTargetSnapshot;
    ghosts: ThingSnapshot[];
    inputRobotIndex: number | null;
    mspacman: ThingSnapshot;
}

export type CurrentModeSnapshot = ModeSnapshot | PlayingModeSnapshot;

export interface MsPacManGameStateSnapshot {
    version: typeof GAME_STATE_VERSION;
    appVersion: string;
    savedAt: string;
    mainFields: JsonRecord;
    mode: CurrentModeSnapshot;
    music: MusicSnapshot | null;
    audioSettings: AudioSettingsSnapshot;
    random: RandomSnapshot;
    robotInputs: RobotInputSnapshot[];
    submittedScore: SubmittedScoreSnapshot | null;
}
