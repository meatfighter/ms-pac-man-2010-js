import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { runInNewContext } from "node:vm";
import { distDir, versionPath } from "./build-utils.mjs";
import { createCacheIdentity, readEnvHmacKey } from "./hmac-config.mjs";

const pwaDistDir = join(distDir, "pwa");
const assetsDir = join(pwaDistDir, "assets");
const serviceWorkerPath = join(pwaDistDir, "sw.js");
const indexPath = join(pwaDistDir, "index.html");
const relocationTestBases = [
    "https://example.invalid/ms-pac-man-2010/pwa/",
    "https://example.invalid/ms-pac-man-2010-staging/pwa/",
    "https://example.invalid/foo/bar/baz/pwa/"
];

async function main() {
    assert.ok(existsSync(pwaDistDir), "dist/pwa does not exist. Run npm run build:pwa first.");
    assert.ok(existsSync(serviceWorkerPath), "dist/pwa/sw.js was not generated.");
    assert.ok(existsSync(indexPath), "dist/pwa/index.html was not generated.");

    const versionInfo = JSON.parse(readFileSync(versionPath, "utf8"));
    assert.equal(typeof versionInfo.version, "string", "version.json must contain a version string.");
    assert.equal(typeof versionInfo.buildStamp, "string", "version.json must contain a buildStamp string.");
    const cacheBust = readExpectedCacheBust(versionInfo);

    const serviceWorker = readFileSync(serviceWorkerPath, "utf8");
    const indexHtml = readFileSync(indexPath, "utf8");
    const manifest = readFileSync(join(pwaDistDir, "manifest.webmanifest"), "utf8");
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
    assertIndexAssetReferencesAreStamped(indexHtml, cacheBust);
    assertManifestAssetReferencesAreStamped(manifest, cacheBust);
    await assertRelocatablePwaBuild(indexHtml, manifest, serviceWorker, resources, cacheBust);

    console.log(`PWA build verified: ${builtAssets.length} built assets are precached.`);
}

function readExpectedCacheBust(versionInfo) {
    const cacheVersionOverride = process.env.MSPACMAN_CACHE_VERSION;
    if (cacheVersionOverride !== undefined && cacheVersionOverride !== "") {
        return cacheVersionOverride;
    }

    const hmacKeyHex = process.env.MSPACMAN_HMAC_KEY_HEX === undefined || process.env.MSPACMAN_HMAC_KEY_HEX === "" ? "" : readEnvHmacKey();
    return createCacheIdentity(versionInfo, hmacKeyHex);
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
        createExpectedCacheName("https://example.invalid/pwa/", cacheBust),
        "Current worker source loaded through a stale script URL must still open the current cache namespace."
    );

    const currentIndex = new URL(worker.APP_INDEX);
    assert.equal(currentIndex.searchParams.get("v"), cacheBust, "APP_INDEX must use the current-version cache key.");

    for (const resource of worker.APP_STATIC_RESOURCES) {
        const url = new URL(worker.createCacheUrl(resource));
        assert.equal(url.searchParams.get("v"), cacheBust, `Install-time precache URL is missing the current version: ${resource}`);
    }

    await dispatchServiceWorkerInstall(worker);
    assert.deepEqual(
        worker.openedCacheNames,
        [createExpectedCacheName("https://example.invalid/pwa/", cacheBust)],
        "Install must only open the current worker cache namespace."
    );
    assert.equal(
        worker.openedCacheNames.includes(createExpectedCacheName("https://example.invalid/pwa/", staleScriptUrlVersion)),
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
    assertLosslessScopeIds(serviceWorker, cacheBust);
    await assertScopeSpecificCacheIsolation(serviceWorker, cacheBust);
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

async function assertRelocatablePwaBuild(indexHtml, manifestText, serviceWorker, resources, cacheBust) {
    const manifest = JSON.parse(manifestText);
    for (const base of relocationTestBases) {
        assertIndexReferencesResolveWithinScope(indexHtml, base, cacheBust);
        assertManifestResolvesWithinScope(manifest, base, cacheBust);
        assertServiceWorkerResolvesWithinScope(serviceWorker, resources, base, cacheBust);
        await assertHighScoreApiBypassesServiceWorkerCache(serviceWorker, base);
    }
}

function assertIndexReferencesResolveWithinScope(html, base, cacheBust) {
    const refs = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
    const assetRefs = refs.filter((ref) => /(?:^|\/)assets\/.+\.(?:js|css)(?:\?|$)/.test(ref));
    assert.ok(assetRefs.length > 0, "index.html does not reference generated JS/CSS assets.");
    assert.ok(
        refs.some((ref) => ref.includes("manifest.webmanifest")),
        "index.html does not reference the PWA manifest."
    );

    for (const ref of refs) {
        assert.ok(ref !== undefined);
        if (ref.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(ref)) {
            continue;
        }
        assert.equal(ref.startsWith("/"), false, `index.html contains a root-relative static reference: ${ref}`);
        const url = new URL(ref, base);
        assert.ok(url.href.startsWith(base), `index.html reference does not resolve under ${base}: ${ref}`);
        if (/\.(?:js|css|png|svg|webmanifest)$/.test(url.pathname)) {
            assert.equal(url.searchParams.get("v"), cacheBust, `index.html reference is missing the release cache-bust query: ${ref}`);
        }
    }
}

function assertManifestResolvesWithinScope(manifest, base, cacheBust) {
    const manifestUrl = new URL("./manifest.webmanifest", base).href;
    const scope = new URL(manifest.scope, manifestUrl).href;
    const startUrl = new URL(manifest.start_url, manifestUrl);
    const idUrl = new URL(manifest.id, manifestUrl).href;

    assert.equal(scope, base, `Manifest scope must resolve to the current PWA directory for ${base}.`);
    assert.ok(startUrl.href.startsWith(scope), `Manifest start_url must remain inside scope for ${base}.`);
    assert.equal(startUrl.searchParams.get("v"), cacheBust, `Manifest start_url is missing the release cache-bust query for ${base}.`);
    assert.ok(idUrl.startsWith(scope), `Manifest id must resolve inside the current PWA scope for ${base}.`);
    assert.ok(Array.isArray(manifest.icons), "PWA manifest must contain an icons array.");

    for (const icon of manifest.icons) {
        const iconUrl = new URL(icon.src, manifestUrl);
        assert.ok(iconUrl.href.startsWith(scope), `Manifest icon must resolve inside the current PWA scope for ${base}: ${icon.src}`);
        assert.equal(iconUrl.searchParams.get("v"), cacheBust, `Manifest icon is missing the release cache-bust query: ${icon.src}`);
    }
}

function assertServiceWorkerResolvesWithinScope(serviceWorker, resources, base, cacheBust) {
    const worker = createServiceWorkerHarness(serviceWorker, "1.0.0-stale-script-url", base);
    assert.equal(worker.CACHE_NAME, createExpectedCacheName(base, cacheBust), `Cache name must include a scope-specific namespace for ${base}.`);
    assert.equal(worker.CACHE_PREFIX, createExpectedCachePrefix(base), `Cache prefix must be scope-specific for ${base}.`);
    assert.equal(worker.APP_INDEX, worker.createCacheUrl("./index.html"), `APP_INDEX must be resolved from the current scope for ${base}.`);
    assert.equal(new URL(worker.APP_INDEX).href.startsWith(base), true, `APP_INDEX must resolve under ${base}.`);
    assert.equal(new URL(worker.APP_INDEX).searchParams.get("v"), cacheBust, `APP_INDEX must use the current release cache key for ${base}.`);

    const serviceWorkerUrl = new URL(`./sw.js?v=${encodeURIComponent(cacheBust)}`, base);
    assert.equal(serviceWorkerUrl.href, `${base}sw.js?v=${encodeURIComponent(cacheBust)}`, `Service worker URL must resolve under ${base}.`);
    assert.equal(new URL("./", serviceWorkerUrl).href, base, `Service worker default scope must be the current PWA directory for ${base}.`);
    assert.equal(new URL("/api/ms-pac-man-2010/scores", base).href, "https://example.invalid/api/ms-pac-man-2010/scores");

    for (const resource of resources) {
        const cacheUrl = new URL(worker.createCacheUrl(resource));
        assert.ok(cacheUrl.href.startsWith(base), `Precache resource must resolve under ${base}: ${resource}`);
        assert.equal(cacheUrl.searchParams.get("v"), cacheBust, `Precache resource is missing the release cache key: ${resource}`);
    }
}

async function assertHighScoreApiBypassesServiceWorkerCache(serviceWorker, base) {
    const worker = createServiceWorkerHarness(serviceWorker, "1.0.0-current", base);
    const event = await dispatchServiceWorkerFetch(worker, {
        method: "GET",
        mode: "cors",
        url: new URL("/api/ms-pac-man-2010/scores", base).href
    });
    assert.equal(event.respondWithCalls, 0, "High-score API requests must bypass service-worker response handling.");
    assert.deepEqual(worker.openedCacheNames, [], "High-score API requests must not open Cache Storage.");
}

async function assertScopeSpecificCacheIsolation(serviceWorker, cacheBust) {
    const stageScope = "https://example.invalid/stage/pwa/";
    const productionScope = "https://example.invalid/production/pwa/";
    const stageWorker = createServiceWorkerHarness(serviceWorker, cacheBust, stageScope);
    const productionWorker = createServiceWorkerHarness(serviceWorker, cacheBust, productionScope);

    assert.notEqual(stageWorker.CACHE_PREFIX, productionWorker.CACHE_PREFIX, "Different PWA scopes must have different cache prefixes.");
    assert.notEqual(stageWorker.CACHE_NAME, productionWorker.CACHE_NAME, "Different PWA scopes must have different cache names.");

    const stageOldCache = `${stageWorker.CACHE_PREFIX}old`;
    const productionOldCache = `${productionWorker.CACHE_PREFIX}old`;
    const legacyGlobalCache = `ms-pac-man-2010-pwa-${cacheBust}`;

    const stageActivationWorker = createServiceWorkerHarness(serviceWorker, cacheBust, stageScope, [
        stageWorker.CACHE_NAME,
        stageOldCache,
        productionWorker.CACHE_NAME,
        productionOldCache,
        legacyGlobalCache
    ]);
    await dispatchServiceWorkerActivate(stageActivationWorker);
    assert.deepEqual(stageActivationWorker.deletedCacheNames, [stageOldCache], "Staging activation must only delete stale caches for the staging scope.");

    const productionActivationWorker = createServiceWorkerHarness(serviceWorker, cacheBust, productionScope, [
        stageWorker.CACHE_NAME,
        stageOldCache,
        productionWorker.CACHE_NAME,
        productionOldCache,
        legacyGlobalCache
    ]);
    await dispatchServiceWorkerActivate(productionActivationWorker);
    assert.deepEqual(
        productionActivationWorker.deletedCacheNames,
        [productionOldCache],
        "Production activation must only delete stale caches for the production scope."
    );
}

function createExpectedCacheName(scope, version) {
    return `${createExpectedCachePrefix(scope)}${version}`;
}

function createExpectedCachePrefix(scope) {
    return `ms-pac-man-2010-pwa-${createExpectedCacheScopeId(scope)}-`;
}

function createExpectedCacheScopeId(scope) {
    return encodeURIComponent(new URL(scope).pathname);
}

function assertLosslessScopeIds(serviceWorker, cacheBust) {
    const scopes = ["https://example.invalid/a/b/", "https://example.invalid/a_b/", "https://example.invalid/a+b/"];
    const workers = scopes.map((scope) => createServiceWorkerHarness(serviceWorker, cacheBust, scope));
    assert.deepEqual(
        workers.map((worker) => worker.CACHE_SCOPE_ID),
        scopes.map((scope) => createExpectedCacheScopeId(scope)),
        "Service-worker scope ids must be the encoded scope path."
    );
    assert.equal(new Set(workers.map((worker) => worker.CACHE_SCOPE_ID)).size, scopes.length, "Distinct scope paths must not collide.");
    assert.equal(new Set(workers.map((worker) => worker.CACHE_PREFIX)).size, scopes.length, "Distinct scope paths must produce distinct cache prefixes.");
}

function createServiceWorkerHarness(serviceWorker, scriptUrlVersion, scope = "https://example.invalid/pwa/", cacheKeys = []) {
    const listeners = new Map();
    const openedCacheNames = [];
    const addAllUrls = [];
    const deletedCacheNames = [];
    const runtimeState = {
        skipWaitingCalls: 0
    };
    const context = {
        URL,
        caches: {
            delete(cacheName) {
                deletedCacheNames.push(cacheName);
                return Promise.resolve(true);
            },
            keys() {
                return Promise.resolve([...cacheKeys]);
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
            location: new URL(`./sw.js?v=${encodeURIComponent(scriptUrlVersion)}`, scope),
            registration: {
                scope
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
    CACHE_PREFIX,
    CACHE_NAME,
    CACHE_SCOPE_ID,
    VERSION,
    createCacheUrl
};`,
        context
    );

    return {
        ...context.self.__pwaVerifier,
        addAllUrls,
        deletedCacheNames,
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

async function dispatchServiceWorkerActivate(worker) {
    const listeners = worker.eventListeners.get("activate") ?? [];
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

async function dispatchServiceWorkerFetch(worker, request) {
    const listeners = worker.eventListeners.get("fetch") ?? [];
    const result = {
        respondWithCalls: 0
    };
    const responsePromises = [];
    for (const listener of listeners) {
        listener({
            request,
            respondWith(promise) {
                result.respondWithCalls++;
                responsePromises.push(Promise.resolve(promise).catch(() => undefined));
            }
        });
    }
    await Promise.all(responsePromises);
    return result;
}

function replaceEmbeddedServiceWorkerVersion(serviceWorker, version) {
    const replaced = serviceWorker.replace(/^const VERSION = ".*";$/m, `const VERSION = ${JSON.stringify(version)};`);
    assert.notEqual(replaced, serviceWorker, "Verifier could not replace the embedded service-worker version.");
    return replaced;
}

await main();
