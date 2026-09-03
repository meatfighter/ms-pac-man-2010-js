export async function registerServiceWorker(cacheBust: string): Promise<void> {
    if (!("serviceWorker" in navigator)) {
        return;
    }
    if (import.meta.env.DEV) {
        await unregisterDevelopmentServiceWorker();
        return;
    }
    try {
        await navigator.serviceWorker.register(`./sw.js?v=${encodeURIComponent(cacheBust)}`, {
            scope: "./"
        });
    } catch (error) {
        console.warn("Unable to register the Ms. Pac-Man service worker.", error);
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
