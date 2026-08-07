import { HighScore } from "./HighScore";

interface RemoteHighScore {
    world: number;
    score: number;
    initials: string;
}

const PROTOCOL_VERSION = 1;
const HIGH_SCORE_URL = __HIGH_SCORE_API_URL__;
const HMAC_KEY_HEX = __HIGH_SCORE_HMAC_KEY_HEX__;
const MAX_RESPONSE_BYTES = 8192;
const MAX_SCORE = 2147483647;
const WORLD_COUNT = 4;
const ROWS_PER_WORLD = 5;
const REQUEST_TIMEOUT_MS = 5000;
const INITIALS_PATTERN = /^[A-Z ]{3}$/;
const HMAC_KEY_PATTERN = /^[0-9a-f]{64}$/;

let hmacKeyPromise: Promise<CryptoKey | null> | null = null;

export class HighScoreService {
    public static async downloadScores(highScores: HighScore[][]): Promise<boolean> {
        const scores = await requestScores("GET");
        if (scores === null) {
            return false;
        }
        applyRemoteScores(highScores, scores);
        return true;
    }

    public static async submitScore(highScores: HighScore[][], world: number, score: number, initials: string): Promise<boolean> {
        if (!isWorld(world) || !isPlausibleScore(score) || !isAllowedInitials(initials)) {
            return false;
        }

        const key = await getHmacKey();
        if (key === null) {
            return false;
        }

        const candidate = { world, score, initials };
        const checksum = await calculateChecksum(key, candidate);
        const scores = await requestScores("POST", {
            protocolVersion: PROTOCOL_VERSION,
            ...candidate,
            checksum
        });
        if (scores === null) {
            return false;
        }

        applyRemoteScores(highScores, scores);
        return true;
    }
}

async function requestScores(method: "GET" | "POST", body?: unknown): Promise<RemoteHighScore[] | null> {
    try {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        const headers: Record<string, string> = {
            "MsPacMan-Protocol-Version": String(PROTOCOL_VERSION)
        };
        if (method === "POST") {
            headers["Content-Type"] = "application/json";
        }
        try {
            const response = await fetch(HIGH_SCORE_URL, {
                method,
                cache: "no-store",
                credentials: "omit",
                headers,
                body: method === "POST" ? JSON.stringify(body) : undefined,
                signal: controller.signal
            });

            if (!response.ok || response.headers.get("MsPacMan-Protocol-Version") !== String(PROTOCOL_VERSION)) {
                return null;
            }
            if (!isJsonContentType(response.headers.get("Content-Type"))) {
                return null;
            }
            const text = await readBoundedText(response, MAX_RESPONSE_BYTES);
            return validateScoresResponse(JSON.parse(text) as unknown);
        } finally {
            window.clearTimeout(timeout);
        }
    } catch {
        return null;
    }
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
    if (!response.body) {
        throw new Error("Missing response body.");
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let byteCount = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        if (value !== undefined) {
            byteCount += value.byteLength;
            if (byteCount > maxBytes) {
                throw new Error("High-score response was too large.");
            }
            chunks.push(value);
        }
    }

    const bytes = new Uint8Array(byteCount);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
}

function validateScoresResponse(value: unknown): RemoteHighScore[] | null {
    if (!isRecord(value) || !hasExactKeys(value, ["protocolVersion", "scores"])) {
        return null;
    }
    if (value.protocolVersion !== PROTOCOL_VERSION || !Array.isArray(value.scores)) {
        return null;
    }
    const scores = validateScoreTable(value.scores);
    return scores;
}

function validateScoreTable(value: unknown[]): RemoteHighScore[] | null {
    if (value.length > WORLD_COUNT * ROWS_PER_WORLD) {
        return null;
    }

    const counts = new Array<number>(WORLD_COUNT).fill(0);
    const tuples = new Set<string>();
    const scores: RemoteHighScore[] = [];
    let previousWorld = -1;
    let previousScore = MAX_SCORE + 1;

    for (const entry of value) {
        if (!isRecord(entry) || !hasExactKeys(entry, ["world", "score", "initials"])) {
            return null;
        }
        if (!isWorld(entry.world) || !isPlausibleScore(entry.score) || !isAllowedInitials(entry.initials)) {
            return null;
        }

        const score = {
            world: entry.world,
            score: entry.score,
            initials: entry.initials
        };
        counts[score.world]++;
        if (counts[score.world] > ROWS_PER_WORLD) {
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

function applyRemoteScores(highScores: HighScore[][], remoteScores: RemoteHighScore[]): void {
    for (let world = 0; world < WORLD_COUNT; world++) {
        if (!highScores[world]) {
            highScores[world] = [];
        }
        for (let row = 0; row < ROWS_PER_WORLD; row++) {
            highScores[world][row] = new HighScore();
        }
    }

    const indexes = new Array<number>(WORLD_COUNT).fill(0);
    for (const remoteScore of remoteScores) {
        const row = indexes[remoteScore.world]++;
        const highScore = new HighScore();
        highScore.score = remoteScore.score;
        highScore.initials = remoteScore.initials;
        highScores[remoteScore.world][row] = highScore;
    }
}

async function getHmacKey(): Promise<CryptoKey | null> {
    if (hmacKeyPromise === null) {
        hmacKeyPromise = importHmacKey();
    }
    return hmacKeyPromise;
}

async function importHmacKey(): Promise<CryptoKey | null> {
    if (!HMAC_KEY_PATTERN.test(HMAC_KEY_HEX)) {
        return null;
    }
    const keyBytes = hexToBytes(HMAC_KEY_HEX);
    const keyData = keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer;
    return crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
}

async function calculateChecksum(key: CryptoKey, candidate: RemoteHighScore): Promise<string> {
    const message = `mspacman-score|${PROTOCOL_VERSION}|${candidate.world}|${candidate.score}|${candidate.initials}`;
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
    return bytesToHex(new Uint8Array(signature));
}

function hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Number.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
    let value = "";
    for (const byte of bytes) {
        value += byte.toString(16).padStart(2, "0");
    }
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    const actual = Object.keys(value);
    return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isWorld(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < WORLD_COUNT;
}

function isPlausibleScore(value: unknown): value is number {
    return typeof value === "number"
        && Number.isInteger(value)
        && value > 0
        && value <= MAX_SCORE
        && value % 10 === 0;
}

function isAllowedInitials(value: unknown): value is string {
    return typeof value === "string" && INITIALS_PATTERN.test(value);
}

function isJsonContentType(value: string | null): boolean {
    return value !== null && value.toLowerCase().split(";")[0].trim() === "application/json";
}
