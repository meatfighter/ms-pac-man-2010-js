import { PwaAudioManager } from "slick2d-ts/slick/openal/PwaAudioManager";

const AUDIO_UNLOCK_TIMEOUT_MS = 3000;
const pwaAudioManager = PwaAudioManager.get();
let activationGeneration = 0;

export type GameAudioActivation = "ready" | "unavailable" | "superseded";

// Install decode-only boot preparation before any runtime loader starts audio preload.
pwaAudioManager.install();

/**
 * Create a fresh playback generation from the current user activation.
 * Audio failure permits silent gameplay; a superseded activation must not resume it.
 */
export async function unlockGameAudio(): Promise<GameAudioActivation> {
    const generation = ++activationGeneration;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let failure: unknown;
    try {
        // Keep construction and native resume inside the original user activation.
        const activation = pwaAudioManager.beginPlaybackGeneration();
        const unlocked = await Promise.race([
            activation,
            new Promise<boolean>((resolve) => {
                timeout = setTimeout(() => resolve(false), AUDIO_UNLOCK_TIMEOUT_MS);
            })
        ]);
        if (generation !== activationGeneration) {
            return "superseded";
        }
        if (unlocked) {
            return "ready";
        }
    } catch (error) {
        failure = error;
    } finally {
        clearTimeout(timeout);
    }
    if (generation !== activationGeneration) {
        return "superseded";
    }
    console.warn("Unable to start a fresh Web Audio playback generation; continuing without audio.", failure);
    pwaAudioManager.endPlaybackGeneration();
    return "unavailable";
}

/** Retire playback and invalidate pending activations while retaining decoded AudioBuffers. */
export function releaseGameAudio(): void {
    activationGeneration++;
    pwaAudioManager.endPlaybackGeneration();
}
