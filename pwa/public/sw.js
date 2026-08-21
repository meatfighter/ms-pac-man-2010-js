const VERSION = "__SERVICE_WORKER_VERSION__";
const CACHE_SCOPE_ID = createCacheScopeId();
const CACHE_PREFIX = `ms-pac-man-2010-pwa-${CACHE_SCOPE_ID}-`;
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;
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

function createCacheScopeId() {
    return new URL(self.registration.scope).pathname.replace(/[^a-zA-Z0-9._-]/g, "_");
}

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

    if (url.origin === self.location.origin && url.href.startsWith(self.registration.scope) && !url.searchParams.has("v")) {
        url.searchParams.set("v", VERSION);
    }

    url.hash = "";
    return url.href;
}

async function matchCurrentCache(requestOrUrl) {
    const cache = await caches.open(CACHE_NAME);
    return cache.match(createCacheUrl(requestOrUrl));
}

self.addEventListener("install", (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE_NAME);
            await cache.addAll(APP_STATIC_RESOURCES.map((url) => createCacheUrl(url)));
        })()
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        (async () => {
            const keys = await caches.keys();
            await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)));
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
        event.respondWith(fetch(request).catch(() => matchCurrentCache(APP_INDEX)));
        return;
    }

    event.respondWith(
        matchCurrentCache(request).then((cached) => {
            return cached || fetch(request);
        })
    );
});
