import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pwaDistDir = join(rootDir, "dist", "pwa");
const assetsDir = join(pwaDistDir, "assets");
const serviceWorkerPath = join(pwaDistDir, "sw.js");
const indexPath = join(pwaDistDir, "index.html");
const versionPath = join(rootDir, "version.json");

async function main() {
    assert.ok(existsSync(pwaDistDir), "dist/pwa does not exist. Run npm run build:pwa first.");
    assert.ok(existsSync(serviceWorkerPath), "dist/pwa/sw.js was not generated.");
    assert.ok(existsSync(indexPath), "dist/pwa/index.html was not generated.");

    const versionInfo = JSON.parse(readFileSync(versionPath, "utf8"));
    const cacheBust = `${versionInfo.version}-${versionInfo.buildStamp}`;
    assert.equal(typeof versionInfo.version, "string", "version.json must contain a version string.");
    assert.equal(typeof versionInfo.buildStamp, "string", "version.json must contain a buildStamp string.");

    const serviceWorker = readFileSync(serviceWorkerPath, "utf8");
    const resources = readPrecacheResources(serviceWorker);
    assertPrecacheResourceTree(resources);

    const builtAssets = listBuiltAssets();
    assert.ok(
        builtAssets.some((asset) => asset.endsWith(".js")),
        "dist/pwa/assets does not contain a built JS asset."
    );
    assert.ok(
        builtAssets.some((asset) => asset.endsWith(".css")),
        "dist/pwa/assets does not contain a built CSS asset."
    );

    for (const asset of builtAssets) {
        assert.ok(resources.includes(asset), `Service worker precache is missing built asset ${asset}.`);
    }

    assertApiBypassPrecedesCacheHandling(serviceWorker);
    await assertVersionedServiceWorkerCacheKeys(serviceWorker, cacheBust);
    assertServiceWorkerLifecycle(serviceWorker);
    assertImmutableServiceWorkerRuntimeCache(serviceWorker);
    assertIndexAssetReferencesAreStamped(readFileSync(indexPath, "utf8"), cacheBust);
    assertManifestAssetReferencesAreStamped(readFileSync(join(pwaDistDir, "manifest.webmanifest"), "utf8"), cacheBust);

    console.log(`PWA build verified: ${builtAssets.length} built assets are precached.`);
}

function readPrecacheResources(serviceWorker) {
    const match = /const APP_STATIC_RESOURCES = (\[[\s\S]*?\]);/.exec(serviceWorker);
    assert.ok(match !== null && match[1] !== undefined, "Could not find APP_STATIC_RESOURCES in dist/pwa/sw.js.");
    const resources = JSON.parse(match[1]);
    assert.ok(Array.isArray(resources), "APP_STATIC_RESOURCES must be an array.");
    for (const resource of resources) {
        assert.equal(typeof resource, "string", "APP_STATIC_RESOURCES entries must be strings.");
    }
    return resources;
}

function assertPrecacheResourceTree(resources) {
    const expectedResources = ["./", ...listGeneratedPwaResources()];
    assert.deepEqual(resources, Array.from(new Set(resources)), "APP_STATIC_RESOURCES must not contain duplicate entries.");

    const actual = new Set(resources);
    const expected = new Set(expectedResources);
    for (const resource of expectedResources) {
        assert.ok(actual.has(resource), `Service worker precache is missing generated PWA file ${resource}.`);
    }
    for (const resource of resources) {
        assert.ok(expected.has(resource), `Service worker precache lists a file that was not generated: ${resource}.`);
    }
}

function listGeneratedPwaResources() {
    const resources = [];
    collectGeneratedPwaResources(pwaDistDir, resources);
    return resources.sort((a, b) => a.localeCompare(b));
}

function collectGeneratedPwaResources(dir, resources) {
    for (const entry of readdirSync(dir).sort((a, b) => a.localeCompare(b))) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
            collectGeneratedPwaResources(path, resources);
            continue;
        }
        const resource = `./${relative(pwaDistDir, path).replaceAll("\\", "/")}`;
        if (resource === "./sw.js") {
            continue;
        }
        resources.push(resource);
    }
}

function listBuiltAssets() {
    assert.ok(existsSync(assetsDir), "dist/pwa/assets does not exist.");
    const assets = [];
    collectAssets(assetsDir, assets);
    return assets.sort((a, b) => a.localeCompare(b));
}

function collectAssets(dir, assets) {
    for (const entry of readdirSync(dir).sort((a, b) => a.localeCompare(b))) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
            collectAssets(path, assets);
            continue;
        }
        if (!/\.(?:css|js)$/.test(entry)) {
            continue;
        }
        assets.push(`./${relative(pwaDistDir, path).replaceAll("\\", "/")}`);
    }
}

function assertApiBypassPrecedesCacheHandling(serviceWorker) {
    const apiBypassIndex = serviceWorker.indexOf('url.pathname.startsWith("/api/ms-pac-man-2010/")');
    const cacheGuardIndex = serviceWorker.indexOf("if (!canUseCacheApi(request))");
    assert.ok(apiBypassIndex >= 0, "Service worker no longer explicitly bypasses the high-score API.");
    assert.ok(cacheGuardIndex >= 0, "Service worker cache handling guard was not found.");
    assert.ok(apiBypassIndex < cacheGuardIndex, "High-score API bypass must run before Cache API handling.");
}

async function assertVersionedServiceWorkerCacheKeys(serviceWorker, cacheBust) {
    assert.ok(serviceWorker.includes("function createCacheUrl"), "Service worker must normalize app cache keys.");
    assert.ok(
        serviceWorker.includes("APP_STATIC_RESOURCES.map((url) => createCacheUrl(url))"),
        "Service worker install precache must use versioned cache keys."
    );
    assert.ok(serviceWorker.includes(`const VERSION = ${JSON.stringify(cacheBust)};`), "Service worker must embed the current build cache version.");
    assert.equal(
        serviceWorker.includes("new URL(self.location.href).searchParams.get"),
        false,
        "Service worker internal version must not be derived from its registration URL."
    );
    assert.ok(serviceWorker.includes("cache.match(createCacheUrl(requestOrUrl))"), "Service worker runtime cache reads must use normalized cache keys.");
    assert.ok(serviceWorker.includes('!url.searchParams.has("v")'), "Service worker must preserve explicitly supplied build versions.");
    assert.ok(serviceWorker.includes('url.searchParams.set("v", VERSION)'), "Service worker must stamp unversioned app resource cache keys.");
    assert.equal(serviceWorker.includes("IGNORED_CACHE_SEARCH_PARAMS"), false, "Service worker must not strip build-stamp cache keys.");
    assert.equal(serviceWorker.includes('searchParams.delete("v")'), false, "Service worker must not delete build-stamp cache keys.");
    assert.equal(serviceWorker.includes("ignoreSearch"), false, "Service worker should use normalized cache keys instead of ignoreSearch.");

    const staleScriptUrlVersion = "1.0.0-stale-script-url";
    const worker = createServiceWorkerHarness(serviceWorker, staleScriptUrlVersion);
    assert.equal(worker.VERSION, cacheBust, "Current worker source loaded through a stale script URL must still use the embedded current version.");
    assert.equal(
        worker.CACHE_NAME,
        `ms-pac-man-2010-pwa-${cacheBust}`,
        "Current worker source loaded through a stale script URL must still open the current cache namespace."
    );

    const currentIndex = new URL(worker.APP_INDEX);
    assert.equal(currentIndex.searchParams.get("v"), cacheBust, "APP_INDEX must use the current-version cache key.");

    for (const resource of worker.APP_STATIC_RESOURCES) {
        const url = new URL(worker.createCacheUrl(resource));
        assert.equal(url.searchParams.get("v"), cacheBust, `Install-time precache URL is missing the current version: ${resource}`);
    }

    await dispatchServiceWorkerInstall(worker);
    assert.deepEqual(worker.openedCacheNames, [`ms-pac-man-2010-pwa-${cacheBust}`], "Install must only open the current worker cache namespace.");
    assert.equal(
        worker.openedCacheNames.includes(`ms-pac-man-2010-pwa-${staleScriptUrlVersion}`),
        false,
        "A stale script URL must not open the stale cache namespace."
    );
    assert.equal(worker.skipWaitingCalls, 0, "Install must not call self.skipWaiting().");
    assert.ok(worker.addAllUrls.length > 0, "Install must precache the generated PWA resources.");
    for (const urlText of worker.addAllUrls) {
        const url = new URL(urlText);
        assert.equal(url.searchParams.get("v"), cacheBust, `Install precache request must use the embedded current version: ${urlText}`);
    }

    const oldVersion = "1.0.0-old";
    const newVersion = "1.0.0-new";
    const oldWorker = createServiceWorkerHarness(replaceEmbeddedServiceWorkerVersion(serviceWorker, oldVersion), newVersion);
    const newWorker = createServiceWorkerHarness(replaceEmbeddedServiceWorkerVersion(serviceWorker, newVersion), oldVersion);
    const oldCachedResource = oldWorker.createCacheUrl("./images/example.png");
    const newRequestResource = oldWorker.createCacheUrl(`./images/example.png?v=${newVersion}`);
    assert.notEqual(oldCachedResource, newRequestResource, "An old worker must not alias a new-version resource request to its old cache entry.");
    assert.equal(
        newWorker.createCacheUrl(`./images/example.png?v=${newVersion}`),
        newWorker.createCacheUrl("./images/example.png"),
        "A current-version request must match the current worker's precached resource."
    );

    const ordinaryResource = worker.createCacheUrl("./images/example.png");
    const queriedResource = worker.createCacheUrl("./images/example.png?palette=maze");
    assert.notEqual(queriedResource, ordinaryResource, "Unrelated query parameters must not alias ordinary precached resources.");
    assert.equal(new URL(queriedResource).searchParams.get("palette"), "maze", "Unrelated query parameters must be preserved.");
}

function assertServiceWorkerLifecycle(serviceWorker) {
    assert.equal(serviceWorker.includes("self.skipWaiting()"), false, "Generated service worker must not skip the waiting phase during install.");
    assert.ok(serviceWorker.includes("self.clients.claim()"), "Service worker should still claim clients after normal activation.");
}

function assertImmutableServiceWorkerRuntimeCache(serviceWorker) {
    assert.equal(serviceWorker.includes("cache.put("), false, "Service worker must not overwrite precached resources at runtime.");
    assert.equal(serviceWorker.includes("remember("), false, "Service worker must not keep the old runtime cache-write helper.");
    assert.ok(
        serviceWorker.includes("fetch(request).catch(() => matchCurrentCache(APP_INDEX))"),
        "Navigation fallback must fetch first and fall back to cached APP_INDEX without replacing APP_INDEX."
    );
    assert.ok(
        serviceWorker.includes("return cached || fetch(request);"),
        "Non-navigation requests must return current-cache hits directly and fetch uncached requests without overwriting precached assets."
    );
}

function assertIndexAssetReferencesAreStamped(html, cacheBust) {
    const assetRefs = [...html.matchAll(/\b(?:src|href)="([^"]*\/assets\/[^"]+\.(?:js|css)(?:\?[^"]*)?)"/g)].map((match) => match[1]);
    assert.ok(assetRefs.length > 0, "index.html does not reference generated JS/CSS assets.");

    for (const ref of assetRefs) {
        assert.ok(ref !== undefined);
        const url = new URL(ref, "https://example.invalid");
        assert.equal(url.searchParams.get("v"), cacheBust, `Generated asset reference is missing the cache-bust query: ${ref}`);
    }
}

function assertManifestAssetReferencesAreStamped(manifest, cacheBust) {
    const parsed = JSON.parse(manifest);
    assert.equal(
        new URL(parsed.start_url, "https://example.invalid/pwa/").searchParams.get("v"),
        cacheBust,
        "Manifest start_url is missing the cache-bust query."
    );
    assert.ok(Array.isArray(parsed.icons), "PWA manifest must contain an icons array.");

    for (const icon of parsed.icons) {
        assert.equal(
            new URL(icon.src, "https://example.invalid/pwa/").searchParams.get("v"),
            cacheBust,
            `Manifest icon is missing the cache-bust query: ${icon.src}`
        );
    }
}

function createServiceWorkerHarness(serviceWorker, scriptUrlVersion) {
    const listeners = new Map();
    const openedCacheNames = [];
    const addAllUrls = [];
    const runtimeState = {
        skipWaitingCalls: 0
    };
    const context = {
        URL,
        caches: {
            delete() {
                return Promise.resolve(true);
            },
            keys() {
                return Promise.resolve([]);
            },
            open(cacheName) {
                openedCacheNames.push(cacheName);
                return Promise.resolve({
                    addAll(urls) {
                        addAllUrls.push(...urls.map(String));
                        return Promise.resolve();
                    },
                    match() {
                        return Promise.resolve(undefined);
                    }
                });
            }
        },
        fetch() {
            return Promise.reject(new Error("Service worker verifier network should not be used."));
        },
        self: {
            location: new URL(`https://example.invalid/pwa/sw.js?v=${encodeURIComponent(scriptUrlVersion)}`),
            registration: {
                scope: "https://example.invalid/pwa/"
            },
            clients: {
                claim() {
                    return Promise.resolve();
                }
            },
            addEventListener(type, listener) {
                const typedListeners = listeners.get(type) ?? [];
                typedListeners.push(listener);
                listeners.set(type, typedListeners);
                return undefined;
            },
            skipWaiting() {
                runtimeState.skipWaitingCalls++;
                return Promise.resolve();
            }
        }
    };

    runInNewContext(
        `${serviceWorker}
self.__pwaVerifier = {
    APP_INDEX,
    APP_STATIC_RESOURCES,
    CACHE_NAME,
    VERSION,
    createCacheUrl
};`,
        context
    );

    return {
        ...context.self.__pwaVerifier,
        addAllUrls,
        eventListeners: listeners,
        openedCacheNames,
        get skipWaitingCalls() {
            return runtimeState.skipWaitingCalls;
        }
    };
}

async function dispatchServiceWorkerInstall(worker) {
    const listeners = worker.eventListeners.get("install") ?? [];
    for (const listener of listeners) {
        const waitUntilPromises = [];
        listener({
            waitUntil(promise) {
                waitUntilPromises.push(Promise.resolve(promise));
            }
        });
        await Promise.all(waitUntilPromises);
    }
}

function replaceEmbeddedServiceWorkerVersion(serviceWorker, version) {
    const replaced = serviceWorker.replace(/^const VERSION = ".*";$/m, `const VERSION = ${JSON.stringify(version)};`);
    assert.notEqual(replaced, serviceWorker, "Verifier could not replace the embedded service-worker version.");
    return replaced;
}

await main();
