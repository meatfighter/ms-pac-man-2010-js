const VERSION = "__SERVICE_WORKER_VERSION__";
/* global __RESOURCE_VERSIONS__, __INSTALL_ICON_VERSIONS__ */
const RESOURCE_VERSIONS = __RESOURCE_VERSIONS__;
const INSTALL_ICON_VERSIONS = __INSTALL_ICON_VERSIONS__;
const CACHE_SCOPE_ID = createCacheScopeId();
const CACHE_PREFIX = `ms-pac-man-2010-pwa|${CACHE_SCOPE_ID}|`;
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
    return encodeURIComponent(new URL(self.registration.scope).pathname);
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

function relativeResourcePath(url) {
    const scope = new URL(self.registration.scope);
    if (url.origin !== self.location.origin || !url.href.startsWith(scope.href)) {
        return null;
    }
    return decodeURIComponent(url.pathname.slice(scope.pathname.length)).replace(/^\/+/, "");
}

function resourceVersionForUrl(url) {
    const relativePath = relativeResourcePath(url);
    if (relativePath === null) {
        return VERSION;
    }
    return RESOURCE_VERSIONS[relativePath] ?? VERSION;
}

function installIconVersionForUrl(url) {
    const relativePath = relativeResourcePath(url);
    if (relativePath === null) {
        return null;
    }
    return INSTALL_ICON_VERSIONS[relativePath] ?? null;
}

function createCacheUrl(requestOrUrl) {
    const rawUrl = typeof requestOrUrl === "string" ? requestOrUrl : requestOrUrl.url;
    const url = new URL(rawUrl, self.registration.scope);

    if (url.origin === self.location.origin && url.href.startsWith(self.registration.scope) && !url.searchParams.has("v")) {
        url.searchParams.set("v", resourceVersionForUrl(url));
    }

    url.hash = "";
    return url.href;
}

async function matchCurrentCache(requestOrUrl) {
    const rawUrl = typeof requestOrUrl === "string" ? requestOrUrl : requestOrUrl.url;
    const requestUrl = new URL(rawUrl, self.registration.scope);
    const cacheUrl = createCacheUrl(requestOrUrl);
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(cacheUrl);
    if (cached) {
        return cached;
    }

    const installIconVersion = installIconVersionForUrl(requestUrl);
    if (installIconVersion !== null && requestUrl.searchParams.get("v") === installIconVersion) {
        return cache.match(cacheUrl, { ignoreSearch: true });
    }
    return undefined;
}

async function fetchOnce(request) {
    const response = await fetch(request);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return response;
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
        event.respondWith(fetchOnce(request).catch(() => matchCurrentCache(APP_INDEX)));
        return;
    }

    event.respondWith(
        matchCurrentCache(request).then((cached) => {
            return cached || fetchOnce(request);
        })
    );
});
