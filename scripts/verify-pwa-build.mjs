import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pwaDistDir = join(rootDir, "dist", "pwa");
const assetsDir = join(pwaDistDir, "assets");
const serviceWorkerPath = join(pwaDistDir, "sw.js");
const indexPath = join(pwaDistDir, "index.html");
const versionPath = join(rootDir, "version.json");

function main() {
    assert.ok(existsSync(pwaDistDir), "dist/pwa does not exist. Run npm run build:pwa first.");
    assert.ok(existsSync(serviceWorkerPath), "dist/pwa/sw.js was not generated.");
    assert.ok(existsSync(indexPath), "dist/pwa/index.html was not generated.");

    const versionInfo = JSON.parse(readFileSync(versionPath, "utf8"));
    assert.equal(typeof versionInfo.buildStamp, "string", "version.json must contain a buildStamp string.");

    const serviceWorker = readFileSync(serviceWorkerPath, "utf8");
    const resources = readPrecacheResources(serviceWorker);
    const staticResources = ["./", "./index.html", "./manifest.webmanifest", "./favicon.svg", "./icon-192.png", "./icon-512.png"];

    for (const resource of staticResources) {
        assert.ok(resources.has(resource), `Service worker precache is missing ${resource}.`);
    }

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
        assert.ok(resources.has(asset), `Service worker precache is missing built asset ${asset}.`);
    }

    assertApiBypassPrecedesCacheHandling(serviceWorker);
    assertNormalizedServiceWorkerCacheKeys(serviceWorker);
    assertImmutableServiceWorkerRuntimeCache(serviceWorker);
    assertIndexAssetReferencesAreStamped(readFileSync(indexPath, "utf8"), versionInfo.buildStamp);

    console.log(`PWA build verified: ${builtAssets.length} built assets are precached.`);
}

function readPrecacheResources(serviceWorker) {
    const match = /const APP_STATIC_RESOURCES = (\[[\s\S]*?\]);/.exec(serviceWorker);
    assert.ok(match !== null && match[1] !== undefined, "Could not find APP_STATIC_RESOURCES in dist/pwa/sw.js.");
    const resources = JSON.parse(match[1]);
    assert.ok(Array.isArray(resources), "APP_STATIC_RESOURCES must be an array.");
    return new Set(resources);
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

function assertNormalizedServiceWorkerCacheKeys(serviceWorker) {
    assert.ok(
        serviceWorker.includes('const IGNORED_CACHE_SEARCH_PARAMS = new Set(["v"]);'),
        "Service worker must declare build-stamp query parameters that are ignored for cache keys."
    );
    assert.ok(serviceWorker.includes("function createCacheUrl"), "Service worker must normalize app cache keys.");
    assert.ok(
        serviceWorker.includes("APP_STATIC_RESOURCES.map((url) => createCacheUrl(url))"),
        "Service worker install precache must use normalized cache keys."
    );
    assert.ok(serviceWorker.includes("cache.match(createCacheUrl(requestOrUrl))"), "Service worker runtime cache reads must use normalized cache keys.");
    assert.equal(serviceWorker.includes("ignoreSearch"), false, "Service worker should use normalized cache keys instead of ignoreSearch.");
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

function assertIndexAssetReferencesAreStamped(html, buildStamp) {
    const assetRefs = [...html.matchAll(/\b(?:src|href)="([^"]*\/assets\/[^"]+\.(?:js|css)(?:\?[^"]*)?)"/g)].map((match) => match[1]);
    assert.ok(assetRefs.length > 0, "index.html does not reference generated JS/CSS assets.");

    for (const ref of assetRefs) {
        assert.ok(ref !== undefined);
        const url = new URL(ref, "https://example.invalid");
        assert.equal(url.searchParams.get("v"), buildStamp, `Generated asset reference is missing the build-stamp query: ${ref}`);
    }
}

main();
