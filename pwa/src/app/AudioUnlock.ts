import { BrowserAudioLifecycle, DevicePixelRatioMonitor } from "slick2d-ts";

const AUDIO_UNLOCK_TIMEOUT_MS = 3000;
const browserAudioLifecycle = BrowserAudioLifecycle.get();
const devicePixelRatioMonitor = new DevicePixelRatioMonitor(() => window.dispatchEvent(new Event("resize")));

browserAudioLifecycle.install();
devicePixelRatioMonitor.start();

/** Attempt activation in the user gesture; unavailable audio must not block play. */
export async function unlockGameAudio(): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            browserAudioLifecycle.resume(),
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
