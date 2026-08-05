const VERSION = "2026.08.05.2";
const CACHE_NAME = `ms-pac-man-2010-${VERSION}`;
const APP_STATIC_RESOURCES = [
    "/",
    "/index.html?v=2026080502",
    "/manifest.webmanifest?v=2026080502",
    "/icon.svg?v=2026080502"
];

self.addEventListener("install", (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(APP_STATIC_RESOURCES);
        await self.skipWaiting();
    })());
});

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
        await self.clients.claim();
    })());
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") {
        return;
    }
    const requestUrl = new URL(request.url);
    const networkFirst = request.mode === "navigate"
        || request.destination === "script"
        || request.destination === "style"
        || request.destination === "worker"
        || request.destination === "manifest"
        || requestUrl.pathname.startsWith("/src/")
        || requestUrl.pathname.startsWith("/@vite")
        || requestUrl.pathname.startsWith("/@fs/");

    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        if (networkFirst) {
            try {
                const response = await fetch(request);
                if (response.ok) {
                    await cache.put(request, response.clone());
                }
                return response;
            } catch {
                const cached = await cache.match(request);
                if (cached) {
                    return cached;
                }
                throw new Error(`Unable to fetch ${request.url}`);
            }
        }
        const cached = await cache.match(request);
        if (cached) {
            return cached;
        }
        const response = await fetch(request);
        if (response.ok) {
            await cache.put(request, response.clone());
        }
        return response;
    })());
});
