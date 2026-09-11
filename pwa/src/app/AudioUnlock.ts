import { PlaybackSession, type PlaybackAttempt } from "slick2d-ts/slick/openal/PlaybackSession";

export type GameAudioAttempt = PlaybackAttempt;

// Install decode-only preparation before any runtime loader begins preloading.
// The engine owns deadlines, cancellation, generation tokens, and silent fallback.
const playback = new PlaybackSession();
let latestAttempt: GameAudioAttempt | null = null;

/** Call synchronously from New Game/Continue, before the activation's first await. */
export function beginGameAudio(): GameAudioAttempt {
    const attempt = playback.begin();
    if (latestAttempt === null || attempt.id > latestAttempt.id) {
        latestAttempt = attempt;
    }
    return attempt;
}

export function isGameAudioCurrent(attempt: GameAudioAttempt): boolean {
    return playback.isCurrent(attempt);
}

/** Identity only: a failed attempt can clean up its shell, but never its replacement. */
export function isGameAudioLatest(attempt: GameAudioAttempt): boolean {
    return latestAttempt === attempt;
}

/** Commit only after game initialization and logical save restoration have finished. */
export function commitGameAudio(attempt: GameAudioAttempt): Promise<boolean> {
    return playback.commit(attempt);
}

/** A stale continuation may retire its own attempt, never a replacement's playback. */
export function releaseGameAudio(attempt?: GameAudioAttempt): void {
    if (attempt === undefined || latestAttempt === attempt) {
        latestAttempt = null;
        playback.cancel();
    }
}

export function setGameAudioInterruptionHandler(handler: ((reason: string) => void) | null): void {
    playback.setInterruptionHandler(handler);
}
