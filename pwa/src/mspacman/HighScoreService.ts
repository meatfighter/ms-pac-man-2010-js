import {
    HMAC_KEY_PATTERN,
    PROTOCOL_VERSION,
    type RemoteHighScore,
    isAllowedInitials,
    isPlausibleScore,
    isWorld,
    validateScoresResponse
} from "./HighScoreProtocol";

const HIGH_SCORE_URL = __HIGH_SCORE_API_URL__;
const HMAC_KEY_HEX = __HIGH_SCORE_HMAC_KEY_HEX__;
const MAX_RESPONSE_BYTES = 8192;
const REQUEST_TIMEOUT_MS = 5000;

let hmacKeyPromise: Promise<CryptoKey | null> | null = null;

export class HighScoreService {
    public static async downloadScores(): Promise<RemoteHighScore[] | null> {
        return requestScores("GET");
    }

    public static async submitScore(world: number, score: number, initials: string): Promise<RemoteHighScore[] | null> {
        try {
            if (!isWorld(world) || !isPlausibleScore(score) || !isAllowedInitials(initials)) {
                return null;
            }

            const key = await getHmacKey();
            if (key === null) {
                return null;
            }

            const candidate = { world, score, initials };
            const checksum = await calculateChecksum(key, candidate);
            return requestScores("POST", {
                protocolVersion: PROTOCOL_VERSION,
                ...candidate,
                checksum
            });
        } catch {
            return null;
        }
    }
}

export async function calculateScoreChecksumForTesting(keyHex: string, candidate: RemoteHighScore): Promise<string | null> {
    try {
        const key = await importHmacKey(keyHex);
        return key === null ? null : calculateChecksum(key, candidate);
    } catch {
        return null;
    }
}

export function resetHighScoreServiceForTesting(): void {
    hmacKeyPromise = null;
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
            const request: RequestInit = {
                method,
                cache: "no-store",
                credentials: "omit",
                headers,
                signal: controller.signal
            };
            if (method === "POST") {
                request.body = JSON.stringify(body);
            }
            const response = await fetch(HIGH_SCORE_URL, request);

            if (response.status !== 200 || response.headers.get("MsPacMan-Protocol-Version") !== String(PROTOCOL_VERSION)) {
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
                await reader.cancel().catch(() => undefined);
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

async function getHmacKey(): Promise<CryptoKey | null> {
    if (hmacKeyPromise === null) {
        hmacKeyPromise = importHmacKey(HMAC_KEY_HEX);
    }
    return hmacKeyPromise;
}

async function importHmacKey(keyHex: string): Promise<CryptoKey | null> {
    if (!HMAC_KEY_PATTERN.test(keyHex)) {
        return null;
    }
    try {
        const keyBytes = hexToBytes(keyHex);
        const keyData = keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer;
        return await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    } catch {
        return null;
    }
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

function isJsonContentType(value: string | null): boolean {
    if (value === null) {
        return false;
    }
    const [mediaType] = value.toLowerCase().split(";");
    return mediaType?.trim() === "application/json";
}
