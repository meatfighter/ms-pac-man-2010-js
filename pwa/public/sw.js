const VERSION = "__SERVICE_WORKER_VERSION__";
/* global __RESOURCE_VERSIONS__, __INSTALL_ICON_VERSIONS__ */
const RESOURCE_VERSIONS = __RESOURCE_VERSIONS__;
const INSTALL_ICON_VERSIONS = __INSTALL_ICON_VERSIONS__;
const CACHE_SCOPE_ID = createCacheScopeId();
const CACHE_PREFIX = `ms-pac-man-2010-pwa|${CACHE_SCOPE_ID}|`;
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;
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

self.addEventListener("install", (event) => {
    event.waitUntil(installCurrentRelease(APP_STATIC_RESOURCES.map((url) => createCacheUrl(url))));
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
        const scopePath = new URL(self.registration.scope).pathname;
        const navigationPath = new URL(request.url).pathname;
        if (navigationPath !== scopePath && navigationPath !== scopePath + "index.html") return;
        event.respondWith(serveNavigation(request));
        return;
    }

    event.respondWith(
        readCacheBestEffort(() => matchCurrentCache(request)).then((cached) => {
            return cached || fetchOnce(request);
        })
    );
});

function discardResponse(response) {
    try {
        void response.body?.cancel().catch(() => undefined);
    } catch {
        /* Best-effort native cleanup. */
    }
}
function observeAbort(pending, signal) {
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        void pending.then(
            (value) => {
                signal.removeEventListener("abort", abort);
                resolve(value);
            },
            (error) => {
                signal.removeEventListener("abort", abort);
                reject(error);
            }
        );
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
    });
}
async function readCacheBestEffort(read) {
    let timer;
    try {
        return await Promise.race([
            Promise.resolve()
                .then(read)
                .catch(() => undefined),
            new Promise((resolve) => {
                timer = setTimeout(() => resolve(undefined), 2000);
            })
        ]);
    } finally {
        clearTimeout(timer);
    }
}
async function installCurrentRelease(urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Offline installation timed out")), 120000);
    const work = (async () => {
        const cache = await caches.open(CACHE_NAME);
        controller.signal.throwIfAborted();
        await cache.addAll(urls.map((url) => new Request(url, { signal: controller.signal, cache: "reload" })));
        controller.signal.throwIfAborted();
    })();
    try {
        await observeAbort(work, controller.signal);
    } finally {
        clearTimeout(timer);
    }
}
async function serveNavigation(request) {
    try {
        return await fetchNavigationDocument(request);
    } catch {
        const cached = await readCacheBestEffort(() => caches.match(createCacheUrl("./index.html"), { cacheName: CACHE_NAME }));
        return (
            cached ||
            new Response(
                '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Game unavailable</title><main><h1>Game unavailable</h1><p>Reconnect and reload to finish downloading the game.</p><a href="">Reload</a></main></html>',
                { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
            )
        );
    }
}
async function fetchNavigationDocument(request) {
    const controller = new AbortController();
    const abort = () => controller.abort(request.signal.reason);
    if (request.signal.aborted) abort();
    else request.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("Navigation timed out")), 8000);
    let reader;
    let complete = false;
    try {
        const pending = fetch(request, { signal: controller.signal }).then((response) => {
            if (controller.signal.aborted) {
                discardResponse(response);
                throw controller.signal.reason;
            }
            return response;
        });
        const response = await observeAbort(pending, controller.signal);
        if (response.type === "opaqueredirect") return response;
        if (response.redirected) {
            discardResponse(response);
            return Response.redirect(response.url, 302);
        }
        if (!response.ok || !/^text\/html(?:;|$)/i.test(response.headers.get("content-type") || "")) {
            discardResponse(response);
            throw new Error("Navigation response was not usable");
        }
        if (response.body === null) throw new Error("Navigation response had no body");
        reader = response.body.getReader();
        const chunks = [];
        let length = 0;
        for (;;) {
            const result = await observeAbort(reader.read(), controller.signal);
            if (result.done) break;
            length += result.value.byteLength;
            if (length > 1024 * 1024) throw new Error("Navigation document exceeded its limit");
            chunks.push(result.value);
        }
        complete = true;
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        }
        const headers = new Headers(response.headers);
        headers.delete("content-encoding");
        headers.delete("content-length");
        headers.delete("transfer-encoding");
        return new Response(bytes, { status: response.status, statusText: response.statusText, headers });
    } finally {
        clearTimeout(timer);
        request.signal.removeEventListener("abort", abort);
        if (!complete) {
            try {
                void reader?.cancel().catch(() => undefined);
            } catch {
                /* Best effort. */
            }
        }
        try {
            reader?.releaseLock();
        } catch {
            /* Cleanup cannot replace the result. */
        }
    }
}
/** Only bounds response headers; ResourceLoader owns game-resource body deadlines. */
async function fetchOnce(request) {
    const controller = new AbortController();
    const abort = () => controller.abort(request.signal.reason);
    if (request.signal.aborted) abort();
    else request.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("Resource headers timed out")), 30000);
    let handedOff = false;
    try {
        const response = await observeAbort(
            fetch(request, { signal: controller.signal }).then((response) => {
                if (controller.signal.aborted) {
                    discardResponse(response);
                    throw controller.signal.reason;
                }
                return response;
            }),
            controller.signal
        );
        if (!response.ok) {
            discardResponse(response);
            throw new Error("HTTP " + response.status);
        }
        handedOff = true;
        return response;
    } finally {
        clearTimeout(timer);
        if (!handedOff) request.signal.removeEventListener("abort", abort);
    }
}
