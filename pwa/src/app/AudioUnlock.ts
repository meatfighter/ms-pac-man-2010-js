import { AppGameContainer } from "slick2d-ts/slick/AppGameContainer";
import { PwaAudioManager } from "slick2d-ts/slick/openal/PwaAudioManager";

const AUDIO_UNLOCK_TIMEOUT_MS = 3000;
const pwaAudioManager = PwaAudioManager.get();

/** AppGameContainer.destroy() is terminal; make repeated stale cleanup calls harmless in the PWA. */
function installIdempotentContainerDestroy(): void {
    const prototype = AppGameContainer.prototype as AppGameContainer & { __pwaIdempotentDestroyInstalled?: boolean };
    if (prototype.__pwaIdempotentDestroyInstalled) {
        return;
    }
    const originalDestroy = AppGameContainer.prototype.destroy;
    const destroyed = new WeakSet<AppGameContainer>();
    AppGameContainer.prototype.destroy = function (this: AppGameContainer): void {
        if (destroyed.has(this)) {
            return;
        }
        destroyed.add(this);
        originalDestroy.call(this);
    };
    Object.defineProperty(prototype, "__pwaIdempotentDestroyInstalled", { value: true });
}

installIdempotentContainerDestroy();
// Install decode-only boot preparation before any runtime loader starts audio preload.
pwaAudioManager.install();

/**
 * Create a fresh playback generation from the current user activation.
 * Audio failure must not prevent the game itself from starting.
 */
export async function unlockGameAudio(): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const activation = pwaAudioManager.beginPlaybackGeneration();
    try {
        const unlocked = await Promise.race([
            activation,
            new Promise<boolean>((resolve) => {
                timeout = setTimeout(() => resolve(false), AUDIO_UNLOCK_TIMEOUT_MS);
            })
        ]);
        if (!unlocked) {
            console.warn("Unable to start a fresh Web Audio playback generation; continuing without audio.");
            pwaAudioManager.endPlaybackGeneration();
        }
    } finally {
        clearTimeout(timeout);
    }
}

/** Retire the current playback generation while retaining boot-decoded AudioBuffers. */
export function releaseGameAudio(): void {
    pwaAudioManager.endPlaybackGeneration();
}
