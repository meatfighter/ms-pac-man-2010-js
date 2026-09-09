const SERVICE_WORKER_STARTUP_TIMEOUT_MS = 3000;
let readinessPromise: Promise<void> | null = null;

export function registerServiceWorker(cacheBust: string): Promise<void> {
    readinessPromise ??= registerServiceWorkerOnce(cacheBust);
    return readinessPromise;
}

/** Lets resource preparation avoid racing the first service-worker install. */
export async function waitForServiceWorkerReadiness(): Promise<void> {
    await readinessPromise;
}

async function registerServiceWorkerOnce(cacheBust: string): Promise<void> {
    if (!("serviceWorker" in navigator) || location.protocol === "file:") {
        return;
    }
    if (import.meta.env.DEV) {
        await unregisterDevelopmentServiceWorker();
        return;
    }

    const serviceWorkerUrl = new URL(`./sw.js?v=${encodeURIComponent(cacheBust)}`, window.location.href);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let removeControllerListener: (() => void) | null = null;
    let expired = false;
    try {
        await Promise.race([
            (async () => {
                await navigator.serviceWorker.register(serviceWorkerUrl.href, { scope: "./" });
                if (expired) return;
                await navigator.serviceWorker.ready;
                if (expired || navigator.serviceWorker.controller !== null) return;
                await new Promise<void>((resolve) => {
                    const controlled = () => resolve();
                    removeControllerListener = () => {
                        navigator.serviceWorker.removeEventListener("controllerchange", controlled);
                        resolve();
                    };
                    navigator.serviceWorker.addEventListener("controllerchange", controlled);
                    if (navigator.serviceWorker.controller !== null) resolve();
                });
            })(),
            new Promise<void>((resolve) => {
                timeout = setTimeout(() => {
                    expired = true;
                    console.warn("Offline installation is still pending; continuing online.");
                    resolve();
                }, SERVICE_WORKER_STARTUP_TIMEOUT_MS);
            })
        ]);
    } catch (error) {
        console.warn("Unable to register the Ms. Pac-Man service worker.", error);
    } finally {
        expired = true;
        clearTimeout(timeout);
        removeControllerListener?.();
    }
}

async function unregisterDevelopmentServiceWorker(): Promise<void> {
    try {
        const appScope = new URL("./", window.location.href).href;
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.filter((registration) => registration.scope === appScope).map((registration) => registration.unregister()));
    } catch (error) {
        console.warn("Unable to unregister the development service worker.", error);
    }
}
