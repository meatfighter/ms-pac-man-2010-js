const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE_NAME = `ms-pac-man-2010-pwa-${VERSION}`;
const CACHE_PREFIXES = [
    "ms-pac-man-2010-",
    "ms-pac-man-2010-pwa-"
];
const APP_STATIC_RESOURCES = [
    "./",
    "./index.html",
    "./manifest.webmanifest",
    "./favicon.png",
    "./icon.svg"
];

function canUseCacheApi(request) {
    const url = new URL(request.url);
    return request.method === "GET" && (url.protocol === "http:" || url.protocol === "https:");
}

function remember(request, response) {
    if (!response.ok) {
        return;
    }

    const copy = response.clone();
    caches.open(CACHE_NAME)
        .then((cache) => cache.put(request, copy))
        .catch(() => undefined);
}

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
        await Promise.all(keys
            .filter((key) => CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)));
        await self.clients.claim();
    })());
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/ms-pac-man-2010/")) {
        return;
    }

    if (!canUseCacheApi(request)) {
        return;
    }

    if (request.mode === "navigate") {
        event.respondWith(fetch(request)
            .then((response) => {
                remember("./index.html", response);
                return response;
            })
            .catch(() => caches.match("./index.html")));
        return;
    }

    event.respondWith(caches.match(request)
        .then((cached) => {
            const networked = fetch(request)
                .then((response) => {
                    remember(request, response);
                    return response;
                })
                .catch(() => cached);

            return cached || networked;
        }));
});
