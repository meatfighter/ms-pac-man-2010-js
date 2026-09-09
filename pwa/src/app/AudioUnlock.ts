import { BrowserAudioLifecycle, SoundStore } from "slick2d-ts";

const AUDIO_UNLOCK_TIMEOUT_MS = 3000;
const browserAudioLifecycle = BrowserAudioLifecycle.get();

browserAudioLifecycle.install();

/** Attempt activation in the user gesture; unavailable audio must not block play. */
export async function unlockGameAudio(): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            SoundStore.get().unlock(),
            new Promise<void>((resolve) => {
                timeout = setTimeout(() => {
                    console.warn("Audio activation is still pending; continuing without waiting.");
                    resolve();
                }, AUDIO_UNLOCK_TIMEOUT_MS);
            })
        ]);
    } finally {
        clearTimeout(timeout);
    }
}
