import type { Music, Sound } from "slick2d-ts";
import type { Main } from "./Main";

const SPEAKING_ROWS = [0, 1] as const;
const SPEAKING_INDEXES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export type MusicId =
    | "act:0"
    | "act:1"
    | "act:2"
    | "gameOver"
    | "highScore"
    | "intro"
    | "levelSelect"
    | "stage:0"
    | "stage:1"
    | "stage:2"
    | "stage:3"
    | "training";

export type SoundId =
    | "atePellot"
    | "ateEnergizer"
    | "ateGhost"
    | "ateFruit"
    | "fruitAppeared"
    | "blueGhosts"
    | "clapping"
    | "extraLife"
    | "died"
    | "pressedEnter"
    | `speaking:${(typeof SPEAKING_ROWS)[number]}:${(typeof SPEAKING_INDEXES)[number]}`;

export type RegisteredMusic = Readonly<{ id: MusicId; music: Music }>;
export type RegisteredSound = Readonly<{ id: SoundId; sound: Sound }>;

const MUSIC_IDS: readonly MusicId[] = [
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

const DIRECT_SOUND_IDS: readonly SoundId[] = [
    "atePellot",
    "ateEnergizer",
    "ateGhost",
    "ateFruit",
    "fruitAppeared",
    "blueGhosts",
    "clapping",
    "extraLife",
    "died",
    "pressedEnter"
];

export function registeredMusic(main: Main): readonly RegisteredMusic[] {
    return [
        { id: "act:0", music: main.actMusic[0] },
        { id: "act:1", music: main.actMusic[1] },
        { id: "act:2", music: main.actMusic[2] },
        { id: "gameOver", music: main.gameOverMusic },
        { id: "highScore", music: main.highScoreMusic },
        { id: "intro", music: main.introMusic },
        { id: "levelSelect", music: main.levelSelectMusic },
        { id: "stage:0", music: main.stageMusic[0] },
        { id: "stage:1", music: main.stageMusic[1] },
        { id: "stage:2", music: main.stageMusic[2] },
        { id: "stage:3", music: main.stageMusic[3] },
        { id: "training", music: main.trainingMusic }
    ];
}

export function musicForId(main: Main, id: MusicId): Music {
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

export function isMusicId(value: unknown): value is MusicId {
    return typeof value === "string" && (MUSIC_IDS as readonly string[]).includes(value);
}

export function registeredSounds(main: Main): readonly RegisteredSound[] {
    const candidates: Array<Readonly<{ id: SoundId; sound: Sound | undefined }>> = [
        { id: "atePellot", sound: main.atePellotSound },
        { id: "ateEnergizer", sound: main.ateEnergizerSound },
        { id: "ateGhost", sound: main.ateGhostSound },
        { id: "ateFruit", sound: main.ateFruitSound },
        { id: "fruitAppeared", sound: main.fruitAppearedSound },
        { id: "blueGhosts", sound: main.blueGhostsSound },
        { id: "clapping", sound: main.clappingSound },
        { id: "extraLife", sound: main.extraLifeSound },
        { id: "died", sound: main.diedSound },
        { id: "pressedEnter", sound: main.pressedEnterSound }
    ];

    for (const row of SPEAKING_ROWS) {
        for (const index of SPEAKING_INDEXES) {
            candidates.push({ id: `speaking:${row}:${index}`, sound: main.speaking?.[row]?.[index] });
        }
    }

    const initialized = candidates.filter((entry): entry is RegisteredSound => entry.sound !== undefined && entry.sound !== null);
    // Production Main constructs all 30 effects synchronously before startupLoadingComplete.
    // An entirely absent registry is permitted only for structural serializer test doubles.
    // A partially initialized runtime registry is always a bug and must fail loudly.
    if (initialized.length !== 0 && initialized.length !== candidates.length) {
        const missing = candidates.filter((entry) => entry.sound === undefined || entry.sound === null).map((entry) => entry.id);
        throw new Error(`Sound registry is partially initialized: ${missing.join(", ")}`);
    }

    assertUniqueSoundObjects(initialized);
    return initialized;
}

export function soundForId(main: Main, id: SoundId): Sound {
    switch (id) {
        case "atePellot":
            return main.atePellotSound;
        case "ateEnergizer":
            return main.ateEnergizerSound;
        case "ateGhost":
            return main.ateGhostSound;
        case "ateFruit":
            return main.ateFruitSound;
        case "fruitAppeared":
            return main.fruitAppearedSound;
        case "blueGhosts":
            return main.blueGhostsSound;
        case "clapping":
            return main.clappingSound;
        case "extraLife":
            return main.extraLifeSound;
        case "died":
            return main.diedSound;
        case "pressedEnter":
            return main.pressedEnterSound;
    }

    const [, rowText, indexText] = id.split(":");
    const row = Number(rowText);
    const index = Number(indexText);
    if ((row !== 0 && row !== 1) || !Number.isInteger(index) || index < 0 || index > 9) {
        throw new Error(`Unsupported Sound id: ${id}`);
    }
    return main.speaking[row][index];
}

export function isSoundId(value: unknown): value is SoundId {
    if (typeof value !== "string") {
        return false;
    }
    if ((DIRECT_SOUND_IDS as readonly string[]).includes(value)) {
        return true;
    }
    return /^speaking:([01]):([0-9])$/.test(value);
}

function assertUniqueSoundObjects(entries: readonly RegisteredSound[]): void {
    const owners = new Set<Sound>();
    for (const { id, sound } of entries) {
        if (owners.has(sound)) {
            throw new Error(`A Sound object is registered under more than one stable id: ${id}`);
        }
        owners.add(sound);
    }
}
