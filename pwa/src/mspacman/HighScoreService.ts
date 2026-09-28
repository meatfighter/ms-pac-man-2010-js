import {
    SCORE_DURABILITY_HEADER,
    SCORE_DURABILITY_VALUE,
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

export interface HighScoreRequestContext {
    readonly onRetryAfter?: (delayMs: number) => void;
    readonly signal?: AbortSignal;
    readonly isCurrent?: () => boolean;
}

interface ActiveRequestScope {
    readonly onRetryAfter: ((delayMs: number) => void) | undefined;
    readonly signal: AbortSignal;
    isCurrent(): boolean;
}

export class HighScoreService {
    public static getEndpointId(): string {
        return new URL(HIGH_SCORE_URL, location.href).href;
    }

    public static async downloadScores(context: HighScoreRequestContext = {}): Promise<RemoteHighScore[] | null> {
        return runScoreOperation(context, (scope) => requestScores("GET", undefined, scope));
    }

    public static async submitScore(world: number, score: number, initials: string, context: HighScoreRequestContext = {}): Promise<RemoteHighScore[] | null> {
        return runScoreOperation(context, async (scope) => {
            if (!isWorld(world) || !isPlausibleScore(score) || !isAllowedInitials(initials) || !scope.isCurrent()) {
                return null;
            }

            const key = await awaitWithAbort(getHmacKey(), scope.signal);
            if (key === null || !scope.isCurrent()) {
                return null;
            }

            const candidate = { world, score, initials };
            const checksum = await awaitWithAbort(calculateChecksum(key, candidate), scope.signal);
            if (!scope.isCurrent()) {
                return null;
            }
            return requestScores(
                "POST",
                {
                    protocolVersion: PROTOCOL_VERSION,
                    ...candidate,
                    checksum
                },
                scope
            );
        });
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

async function runScoreOperation(
    context: HighScoreRequestContext,
    operation: (scope: ActiveRequestScope) => Promise<RemoteHighScore[] | null>
): Promise<RemoteHighScore[] | null> {
    const controller = new AbortController();
    const externalSignal = context.signal;
    const abortFromCaller = (): void => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) {
        controller.abort(externalSignal.reason);
    } else {
        externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
    }
    const timeout = window.setTimeout(() => controller.abort(new DOMException("High-score request timed out.", "TimeoutError")), REQUEST_TIMEOUT_MS);
    const scope: ActiveRequestScope = {
        signal: controller.signal,
        onRetryAfter: context.onRetryAfter,
        isCurrent: () => !controller.signal.aborted && (context.isCurrent?.() ?? true)
    };

    try {
        if (!scope.isCurrent()) {
            return null;
        }
        const result = await operation(scope);
        return scope.isCurrent() ? result : null;
    } catch {
        return null;
    } finally {
        window.clearTimeout(timeout);
        externalSignal?.removeEventListener("abort", abortFromCaller);
    }
}

async function requestScores(method: "GET" | "POST", body: unknown, scope: ActiveRequestScope): Promise<RemoteHighScore[] | null> {
    if (!scope.isCurrent()) {
        return null;
    }

    const headers: Record<string, string> = {
        "MsPacMan-Protocol-Version": String(PROTOCOL_VERSION)
    };
    if (method === "POST") {
        headers["Content-Type"] = "application/json";
    }
    const request: RequestInit = {
        method,
        cache: "no-store",
        credentials: "omit",
        headers,
        signal: scope.signal
    };
    if (method === "POST") {
        request.body = JSON.stringify(body);
    }
    if (!scope.isCurrent()) {
        return null;
    }

    const response = await fetch(HIGH_SCORE_URL, request);
    if (!scope.isCurrent()) {
        discardResponse(response);
        return null;
    }
    if (response.status === 429 || response.status === 503) {
        const value = response.headers.get("Retry-After");
        let delay: number | null = null;
        if (value !== null) {
            if (/^\d+$/.test(value.trim())) delay = Number(value.trim()) * 1000;
            else {
                const at = Date.parse(value);
                if (Number.isFinite(at)) delay = Math.max(0, at - Date.now());
            }
        }
        if (delay !== null && Number.isFinite(delay)) {
            try {
                scope.onRetryAfter?.(Math.min(3_600_000, Math.max(0, delay)));
            } catch {
                /* Retry metadata must not prevent response-body disposal. */
            }
        }
    }
    if (response.status !== 200 || response.headers.get("MsPacMan-Protocol-Version") !== String(PROTOCOL_VERSION)) {
        discardResponse(response);
        return null;
    }
    if (method === "POST" && response.headers.get(SCORE_DURABILITY_HEADER) !== SCORE_DURABILITY_VALUE) {
        discardResponse(response);
        return null;
    }
    if (!isJsonContentType(response.headers.get("Content-Type"))) {
        discardResponse(response);
        return null;
    }
    const text = await readBoundedText(response, MAX_RESPONSE_BYTES, scope);
    if (!scope.isCurrent()) {
        return null;
    }
    return validateScoresResponse(JSON.parse(text) as unknown);
}

async function readBoundedText(response: Response, maxBytes: number, scope: ActiveRequestScope): Promise<string> {
    if (!response.body) {
        throw new Error("Missing response body.");
    }

    const reader = response.body.getReader();
    let complete = false;
    try {
        const chunks: Uint8Array[] = [];
        let byteCount = 0;
        while (scope.isCurrent()) {
            const result = await awaitWithAbort(reader.read(), scope.signal);
            const { done, value } = result;
            if (!scope.isCurrent()) {
                throw new DOMException("High-score request retired.", "AbortError");
            }
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
        if (!scope.isCurrent()) {
            throw new DOMException("High-score request retired.", "AbortError");
        }

        const bytes = new Uint8Array(byteCount);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        }
        complete = true;
        return new TextDecoder().decode(bytes);
    } finally {
        if (!complete) {
            try {
                void reader.cancel().catch(() => undefined);
            } catch {
                /* Best effort. */
            }
        }
        try {
            reader.releaseLock();
        } catch {
            /* Aborted read cleanup cannot hide the original failure. */
        }
    }
}

async function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
        const onAbort = (): void => {
            cleanup();
            reject(signal.reason ?? new DOMException("High-score request aborted.", "AbortError"));
        };
        const cleanup = (): void => {
            signal.removeEventListener("abort", onAbort);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
        promise.then(
            (value) => {
                cleanup();
                resolve(value);
            },
            (error: unknown) => {
                cleanup();
                reject(error);
            }
        );
    });
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

function discardResponse(response: Response): void {
    try {
        if (response.body !== null && !response.body.locked) void response.body.cancel().catch(() => undefined);
    } catch {
        /* Best-effort disposal cannot hide the original failure. */
    }
}
