import { readCurrentJson, writeCurrentSnapshot } from "./BrowserPersistence.js";
import { isValidSubmittedScoreTuple, type RemoteHighScore } from "../mspacman/HighScoreProtocol.js";

export const MAX_PENDING_SCORES = 128;
export const MAX_OUTBOX_TEXT_LENGTH = 32_768;
export const MIN_POST_INTERVAL_MS = 7_000;
export const UNACKNOWLEDGED_ATTEMPT_DELAY_MS = 125_000;
export const MAX_RETRY_DELAY_MS = 3_600_000;

interface OutboxDocument {
    version: 1;
    endpoint: string;
    pending: RemoteHighScore[];
    notBefore: number;
    failures: number;
}

export function sameScore(a: RemoteHighScore, b: RemoteHighScore): boolean {
    return a.world === b.world && a.score === b.score && a.initials === b.initials;
}

function validDocument(value: unknown, endpoint: string): value is OutboxDocument {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const d = value as Record<string, unknown>;
    const keys = ["version", "endpoint", "pending", "notBefore", "failures"];
    if (Object.keys(d).length !== keys.length || !keys.every((key) => Object.hasOwn(d, key))) return false;
    if (d.version !== 1 || d.endpoint !== endpoint || !Array.isArray(d.pending) || d.pending.length > MAX_PENDING_SCORES) return false;
    if (typeof d.notBefore !== "number" || !Number.isSafeInteger(d.notBefore) || d.notBefore < 0) return false;
    if (typeof d.failures !== "number" || !Number.isInteger(d.failures) || d.failures < 0 || d.failures > 16) return false;
    const tuples = new Set<string>();
    for (const candidate of d.pending) {
        if (!isValidSubmittedScoreTuple(candidate)) return false;
        const key = JSON.stringify([candidate.world, candidate.score, candidate.initials]);
        if (tuples.has(key)) return false;
        tuples.add(key);
    }
    return true;
}

/** One in-memory view per held deployment lock. Never share it across ownership epochs. */
export class HighScoreOutbox {
    private state: OutboxDocument;

    public constructor(
        private readonly key: string,
        private readonly endpoint: string,
        private readonly authorized: () => boolean
    ) {
        this.state = readCurrentJson(key, MAX_OUTBOX_TEXT_LENGTH, (v): v is OutboxDocument => validDocument(v, endpoint)) ?? {
            version: 1,
            endpoint,
            pending: [],
            notBefore: 0,
            failures: 0
        };
    }

    public enqueue(candidate: RemoteHighScore): boolean {
        if (!this.authorized() || !isValidSubmittedScoreTuple(candidate)) return false;
        if (this.state.pending.some((entry) => sameScore(entry, candidate))) return true;
        if (this.state.pending.length >= MAX_PENDING_SCORES) {
            console.warn("High-score outbox is full; this submission was not queued.");
            return false;
        }
        return this.commit({ ...this.state, pending: [...this.state.pending, { ...candidate }] });
    }

    public first(): RemoteHighScore | null {
        const first = this.state.pending[0];
        return first === undefined ? null : { ...first };
    }

    public get failureCount(): number {
        return this.state.failures;
    }

    public delay(now: number): number {
        return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, this.state.notBefore - now));
    }

    /** Write ahead of every attempt, including repeats, to survive fast reload/takeover loops. */
    public reserveAttempt(now: number): boolean {
        return this.commit({ ...this.state, notBefore: now + UNACKNOWLEDGED_ATTEMPT_DELAY_MS });
    }

    public acknowledge(candidate: RemoteHighScore, now: number): boolean {
        return this.commit({
            ...this.state,
            pending: this.state.pending.filter((entry) => !sameScore(entry, candidate)),
            failures: 0,
            notBefore: now + MIN_POST_INTERVAL_MS
        });
    }

    public defer(now: number, delay: number): boolean {
        return this.commit({
            ...this.state,
            failures: Math.min(16, this.state.failures + 1),
            notBefore: now + Math.min(MAX_RETRY_DELAY_MS, Math.max(MIN_POST_INTERVAL_MS, delay))
        });
    }

    private commit(next: OutboxDocument): boolean {
        const result = writeCurrentSnapshot(
            "Ms. Pac-Man high-score outbox",
            this.key,
            next,
            (value) => validDocument(value, this.endpoint),
            MAX_OUTBOX_TEXT_LENGTH,
            this.authorized
        );
        if (!result.saved) return false;
        this.state = next;
        return true;
    }
}
