const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE_NAME = `ms-pac-man-2010-pwa-${VERSION}`;
const CACHE_PREFIXES = ["ms-pac-man-2010-", "ms-pac-man-2010-pwa-"];
const IGNORED_CACHE_SEARCH_PARAMS = new Set(["v"]);
const APP_INDEX = createCacheUrl("./index.html");
const APP_STATIC_RESOURCES = [
    "./",
    "./index.html",
    "./manifest.webmanifest",
    "./favicon.svg",
    "./favicon-16.png",
    "./favicon-32.png",
    "./favicon.png",
    "./apple-touch-icon.png",
    "./icon.svg",
    "./icon-192.png",
    "./icon-512.png"
];

function canUseCacheApi(request) {
    const url = new URL(request.url);
    return (
        request.method === "GET" &&
        url.origin === self.location.origin &&
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.href.startsWith(self.registration.scope)
    );
}

function createCacheUrl(requestOrUrl) {
    const rawUrl = typeof requestOrUrl === "string" ? requestOrUrl : requestOrUrl.url;
    const url = new URL(rawUrl, self.registration.scope);

    if (url.origin === self.location.origin && url.href.startsWith(self.registration.scope)) {
        for (const param of IGNORED_CACHE_SEARCH_PARAMS) {
            url.searchParams.delete(param);
        }
    }

    url.hash = "";
    return url.href;
}

function remember(request, response) {
    if (!response.ok) {
        return;
    }

    const cacheUrl = createCacheUrl(request);
    const copy = response.clone();
    caches
        .open(CACHE_NAME)
        .then((cache) => cache.put(cacheUrl, copy))
        .catch(() => undefined);
}

self.addEventListener("install", (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE_NAME);
            await cache.addAll(APP_STATIC_RESOURCES.map((url) => createCacheUrl(url)));
            await self.skipWaiting();
        })()
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        (async () => {
            const keys = await caches.keys();
            await Promise.all(
                keys.filter((key) => CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)) && key !== CACHE_NAME).map((key) => caches.delete(key))
            );
            await self.clients.claim();
        })()
    );
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
        event.respondWith(
            fetch(request)
                .then((response) => {
                    remember(APP_INDEX, response);
                    return response;
                })
                .catch(() => caches.match(APP_INDEX))
        );
        return;
    }

    event.respondWith(
        caches.match(createCacheUrl(request)).then((cached) => {
            const networked = fetch(request)
                .then((response) => {
                    remember(request, response);
                    return response;
                })
                .catch(() => cached);

            return cached || networked;
        })
    );
});
