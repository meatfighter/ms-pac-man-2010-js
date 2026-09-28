export interface RemoteHighScore {
    world: number;
    score: number;
    initials: string;
}

export const PROTOCOL_VERSION = 1;
export const MAX_SCORE = 2147483647;
export const WORLD_COUNT = 4;
export const ROWS_PER_WORLD = 5;
export const INITIALS_PATTERN = /^[A-Z ]{3}$/;
export const HMAC_KEY_PATTERN = /^[0-9a-f]{64}$/;

export function normalizeHighScoreInitials(initials: string): string {
    return initials.padEnd(3, " ").substring(0, 3);
}

export function isWorld(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < WORLD_COUNT;
}

export function isPlausibleScore(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_SCORE && value % 10 === 0;
}

export function isAllowedInitials(value: unknown): value is string {
    return typeof value === "string" && INITIALS_PATTERN.test(value);
}

export function isValidSubmittedScoreTuple(value: unknown): value is RemoteHighScore {
    const score = asRecord(value);
    return (
        score !== null &&
        hasExactKeys(score, ["world", "score", "initials"]) &&
        isWorld(score.world) &&
        isPlausibleScore(score.score) &&
        isAllowedInitials(score.initials)
    );
}

export function validateScoresResponse(value: unknown): RemoteHighScore[] | null {
    const response = asRecord(value);
    if (response === null || !hasExactKeys(response, ["protocolVersion", "scores"])) {
        return null;
    }
    if (response.protocolVersion !== PROTOCOL_VERSION || !Array.isArray(response.scores)) {
        return null;
    }
    return validateScoreTable(response.scores);
}

export function validateScoreTable(value: unknown[]): RemoteHighScore[] | null {
    if (value.length > WORLD_COUNT * ROWS_PER_WORLD) {
        return null;
    }

    const counts = new Array<number>(WORLD_COUNT).fill(0);
    const tuples = new Set<string>();
    const scores: RemoteHighScore[] = [];
    let previousWorld = -1;
    let previousScore = MAX_SCORE + 1;

    for (const entry of value) {
        if (!isValidSubmittedScoreTuple(entry)) {
            return null;
        }

        const score = {
            world: entry.world,
            score: entry.score,
            initials: entry.initials
        };
        const worldCount = (counts[score.world] ?? 0) + 1;
        counts[score.world] = worldCount;
        if (worldCount > ROWS_PER_WORLD) {
            return null;
        }
        if (score.world < previousWorld) {
            return null;
        }
        if (score.world !== previousWorld) {
            previousWorld = score.world;
            previousScore = MAX_SCORE + 1;
        }
        if (score.score > previousScore) {
            return null;
        }
        previousScore = score.score;

        const tuple = `${score.world}|${score.score}|${score.initials}`;
        if (tuples.has(tuple)) {
            return null;
        }
        tuples.add(tuple);
        scores.push(score);
    }

    return scores;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    const actual = Object.keys(value);
    return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

export const SCORE_DURABILITY_HEADER = "MsPacMan-Score-Durable";
export const SCORE_DURABILITY_VALUE = "1";
