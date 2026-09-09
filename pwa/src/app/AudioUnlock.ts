import { BrowserAudioLifecycle, SoundStore } from "slick2d-ts";

const AUDIO_UNLOCK_TIMEOUT_MS = 3000;
type BrowserAudioLifecycleWithRecovery = ReturnType<typeof BrowserAudioLifecycle.get> & {
    armRecovery?: () => void;
    observeActiveContext?: () => void;
};
const browserAudioLifecycle = BrowserAudioLifecycle.get() as BrowserAudioLifecycleWithRecovery;

browserAudioLifecycle.install();

/** Attempt activation in the user gesture; unavailable audio must not block play. */
export async function unlockGameAudio(): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        const unlocked = await Promise.race([
            SoundStore.get().unlock(),
            new Promise<boolean>((resolve) => {
                timeout = setTimeout(() => {
                    console.warn("Audio activation is still pending; continuing without waiting.");
                    resolve(false);
                }, AUDIO_UNLOCK_TIMEOUT_MS);
            })
        ]);
        browserAudioLifecycle.observeActiveContext?.();
        if (!unlocked) {
            browserAudioLifecycle.armRecovery?.();
        }
    } finally {
        clearTimeout(timeout);
    }
}
