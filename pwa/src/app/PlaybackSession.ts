import { PlaybackSession, type PlaybackAttempt } from "slick2d-ts/slick/openal/PlaybackSession";

export type GameAudioAttempt = PlaybackAttempt;

// Install decode-only preparation before the runtime loader starts.
const playback = new PlaybackSession();
let latestAttempt: GameAudioAttempt | null = null;
let revision = 0;

/** Native construction/resume remains in the original New Game/Continue activation. */
export function beginGameAudio(): GameAudioAttempt {
    const currentRevision = ++revision;
    latestAttempt = null;
    const attempt = playback.begin();
    // Native construction or teardown may synchronously trigger departure/reentry.
    // Never republish the cancelled attempt after that event has returned.
    if (revision === currentRevision) {
        latestAttempt = attempt;
    }
    return attempt;
}

export function isGameAudioCurrent(attempt: GameAudioAttempt): boolean {
    return latestAttempt === attempt && playback.isCurrent(attempt);
}

/** Failed attempts still own their shell cleanup; cancelled/replaced attempts do not. */
export function isGameAudioLatest(attempt: GameAudioAttempt): boolean {
    return latestAttempt === attempt;
}

export function commitGameAudio(attempt: GameAudioAttempt): Promise<boolean> {
    return latestAttempt === attempt ? playback.commit(attempt) : Promise.resolve(false);
}

/** Synchronous exit retires the owned generation; stale continuations cannot cancel it. */
export function releaseGameAudio(attempt?: GameAudioAttempt): void {
    if (attempt !== undefined && latestAttempt !== attempt) {
        return;
    }
    revision++;
    latestAttempt = null;
    // cancel() also throws on a previously latched retirement failure.
    playback.cancel();
}

export function setGameAudioInterruptionHandler(handler: ((reason: string) => void) | null): void {
    playback.setInterruptionHandler(handler);
}
