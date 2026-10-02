import type { MusicPlaybackSnapshot, SoundPlaybackSnapshot } from "slick2d-ts";
import type { MusicId, SoundId } from "../AudioRegistry";

// Current save schema: only this exact format is supported; earlier internal schemas are not migrated.
export const GAME_STATE_VERSION = 12;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonRecord;
export type JsonRecord = { [key: string]: JsonValue };

export type ModeId =
    "act1" | "act2" | "act3" | "act4" | "act5" | "act6" | "act7" | "attract" | "ending" | "enterInitials" | "hallOfFame" | "intro" | "playing" | "selectWorld";

export interface RandomSnapshot {
    seed0: number;
    seed1: number;
    seed2: number;
}

export interface MusicSnapshot {
    id: MusicId;
    playback: MusicPlaybackSnapshot;
}

export interface SoundSnapshot {
    id: SoundId;
    playback: SoundPlaybackSnapshot;
}

export interface RobotInputSnapshot {
    index: number;
}

export interface ModeSnapshot {
    id: Exclude<ModeId, "playing">;
    fields: JsonRecord;
}

export interface ThingSnapshot {
    fields: JsonRecord;
}

export interface FruitTargetSnapshot extends ThingSnapshot {
    exitPath: number[][] | null;
}

export interface PlayingModeSnapshot {
    id: "playing";
    fields: JsonRecord;
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
    soundEffects: SoundSnapshot[];
    random: RandomSnapshot;
    robotInputs: RobotInputSnapshot[];
}
