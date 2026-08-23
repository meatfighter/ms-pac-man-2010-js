import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type PluginOption } from "vite";

interface VersionInfo {
    readonly version: string;
    readonly buildStamp: string;
}

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const distRootDir =
    process.env.MSPACMAN_INTERNAL_DIST_DIR !== undefined && process.env.MSPACMAN_INTERNAL_DIST_DIR !== ""
        ? resolve(process.env.MSPACMAN_INTERNAL_DIST_DIR)
        : join(rootDir, "..", "dist");
const pwaDistDir = join(distRootDir, "pwa");
const thirdPartyNoticesPath = join(rootDir, "..", "THIRD_PARTY_NOTICES.md");
const versionInfo = JSON.parse(readFileSync(new URL("../version.json", import.meta.url), "utf8")) as VersionInfo;
const encodedBuildStamp = encodeURIComponent(versionInfo.buildStamp);
const SERVICE_WORKER_VERSION_TOKEN = "__SERVICE_WORKER_VERSION__";
const SERVICE_WORKER_VERSION_PLACEHOLDER = JSON.stringify(SERVICE_WORKER_VERSION_TOKEN);
const DEFAULT_HIGH_SCORE_API_URL = "/api/ms-pac-man-2010/scores";
const HIGH_SCORE_API_PREFIX = "/api/ms-pac-man-2010/";
const HMAC_KEY_PATTERN = /^[0-9a-f]{64}$/;

interface HighScoreBuildConfig {
    readonly apiUrl: string;
    readonly cacheBust: string;
    readonly encodedCacheBust: string;
    readonly hmacKeyHex: string;
}

function resolveHighScoreBuildConfig(command: string, mode: string): HighScoreBuildConfig {
    const apiUrl = process.env.MSPACMAN_SCORE_API_URL ?? DEFAULT_HIGH_SCORE_API_URL;
    const hmacKeyHex = process.env.MSPACMAN_HMAC_KEY_HEX ?? "";
    const releaseBuild = command === "build" && mode === "release";

    validateHighScoreApiUrl(apiUrl, releaseBuild);
    validateHighScoreHmacKey(hmacKeyHex, releaseBuild);
    const cacheBust = createCacheBust(hmacKeyHex);
    const expectedCacheBust = process.env.MSPACMAN_CACHE_VERSION;
    if (expectedCacheBust !== undefined && expectedCacheBust !== "" && expectedCacheBust !== cacheBust) {
        throw new Error("MSPACMAN_CACHE_VERSION does not match the selected PWA HMAC key and build stamp.");
    }

    return {
        apiUrl,
        cacheBust,
        encodedCacheBust: encodeURIComponent(cacheBust),
        hmacKeyHex
    };
}

function validateHighScoreApiUrl(apiUrl: string, releaseBuild: boolean): void {
    if (!apiUrl.startsWith("/") || apiUrl.startsWith("//")) {
        throw new Error("Browser score API URLs must be same-origin paths; cross-origin score APIs are unsupported.");
    }
    const parsed = new URL(apiUrl, "https://ms-pac-man.invalid");
    if (parsed.origin !== "https://ms-pac-man.invalid" || !parsed.pathname.startsWith(HIGH_SCORE_API_PREFIX) || parsed.search !== "" || parsed.hash !== "") {
        throw new Error("MSPACMAN_SCORE_API_URL must be a same-origin /api/ms-pac-man-2010/ path without query or fragment.");
    }
    if (releaseBuild && apiUrl !== DEFAULT_HIGH_SCORE_API_URL) {
        throw new Error("Release PWA builds use the fixed same-origin /api/ms-pac-man-2010/scores endpoint.");
    }
}

function validateHighScoreHmacKey(hmacKeyHex: string, releaseBuild: boolean): void {
    if (hmacKeyHex !== "" && !HMAC_KEY_PATTERN.test(hmacKeyHex)) {
        throw new Error("MSPACMAN_HMAC_KEY_HEX must be exactly 64 lowercase hexadecimal characters.");
    }
    if (releaseBuild && hmacKeyHex === "") {
        throw new Error("MSPACMAN_HMAC_KEY_HEX is required for release PWA builds.");
    }
}

function createCacheBust(hmacKeyHex: string): string {
    const suffix = hmacKeyHex === "" ? "unsigned" : `k${createHmacFingerprint(hmacKeyHex)}`;
    return `${versionInfo.version}-${versionInfo.buildStamp}-${suffix}`;
}

function createHmacFingerprint(hmacKeyHex: string): string {
    return createHash("sha256").update(Buffer.from(hmacKeyHex, "hex")).digest("hex").slice(0, 12);
}

function renderVersionPlaceholders(text: string, encodedCacheBust: string): string {
    return text.replaceAll("%APP_VERSION%", versionInfo.version).replaceAll("%BUILD_STAMP%", encodedBuildStamp).replaceAll("%CACHE_VERSION%", encodedCacheBust);
}

function appendCacheBustQuery(url: string, encodedCacheBust: string): string {
    if (/[?&]v=/.test(url)) {
        return url;
    }
    return `${url}${url.includes("?") ? "&" : "?"}v=${encodedCacheBust}`;
}

function versionBuiltAssetReferences(html: string, encodedCacheBust: string): string {
    return html.replace(
        /\b(src|href)="([^"]*\/assets\/[^"]+\.(?:js|css)(?:\?[^"]*)?)"/g,
        (_match, attribute: string, url: string) => `${attribute}="${appendCacheBustQuery(url, encodedCacheBust)}"`
    );
}

function placeInitialStylesheetsBeforeModuleScripts(html: string): string {
    const headCloseTag = "</head>";
    const headCloseIndex = html.indexOf(headCloseTag);
    if (headCloseIndex < 0) {
        return html;
    }

    const stylesheetTags: string[] = [];
    const moduleScriptTags: string[] = [];
    const head = html
        .slice(0, headCloseIndex)
        .replace(/\s*<link\b(?=[^>]*\brel="stylesheet")(?=[^>]*\bhref="[^"]*\/assets\/[^"]+\.css(?:\?[^"]*)?")[^>]*>/g, (tag) => {
            stylesheetTags.push(tag.trim());
            return "";
        })
        .replace(/\s*<script\b(?=[^>]*\btype="module")(?=[^>]*\bsrc="[^"]*\/assets\/[^"]+\.js(?:\?[^"]*)?")[^>]*><\/script>/g, (tag) => {
            moduleScriptTags.push(tag.trim());
            return "";
        })
        .trimEnd();

    if (stylesheetTags.length === 0 || moduleScriptTags.length === 0) {
        return html;
    }

    const initialAssetTags = [...stylesheetTags, ...moduleScriptTags].map((tag) => `        ${tag}`).join("\n");
    return `${head}\n${initialAssetTags}\n    ${headCloseTag}${html.slice(headCloseIndex + headCloseTag.length)}`;
}

function renderVersionedHtml(html: string, encodedCacheBust: string): string {
    return placeInitialStylesheetsBeforeModuleScripts(versionBuiltAssetReferences(renderVersionPlaceholders(html, encodedCacheBust), encodedCacheBust));
}

function collectPrecacheResources(dir: string, baseDir = dir): string[] {
    const resources: string[] = [];
    for (const entry of readdirSync(dir).sort((a, b) => a.localeCompare(b))) {
        const path = join(dir, entry);
        const stat = lstatSync(path);
        if (stat.isSymbolicLink()) {
            throw new Error(`PWA release precache must not include symbolic links or junctions: ${relative(baseDir, path).replaceAll("\\", "/")}`);
        }
        if (stat.isDirectory()) {
            resources.push(...collectPrecacheResources(path, baseDir));
            continue;
        }
        if (!stat.isFile()) {
            throw new Error(`PWA release precache contains an unsupported filesystem entry: ${relative(baseDir, path).replaceAll("\\", "/")}`);
        }

        const ref = relative(baseDir, path).replaceAll("\\", "/");
        if (ref === "sw.js") {
            continue;
        }
        resources.push(`./${ref}`);
    }
    return resources;
}

function renderServiceWorker(sw: string, pwaDistDir: string, cacheBust: string): string {
    const resources = Array.from(new Set(["./", ...collectPrecacheResources(pwaDistDir)]));
    return sw
        .replaceAll(SERVICE_WORKER_VERSION_PLACEHOLDER, JSON.stringify(cacheBust))
        .replace(/const APP_STATIC_RESOURCES = \[[^\]]*\];/, `const APP_STATIC_RESOURCES = ${JSON.stringify(resources, null, 4)};`);
}

function versionedHtmlPlugin(config: HighScoreBuildConfig): PluginOption {
    return {
        name: "versioned-html",
        transformIndexHtml: {
            order: "post",
            handler(html: string): string {
                return renderVersionedHtml(html, config.encodedCacheBust);
            }
        }
    };
}

function versionedStaticAssetsPlugin(command: string, config: HighScoreBuildConfig): PluginOption {
    return {
        name: "versioned-static-assets",
        generateBundle(_options, bundle): void {
            for (const asset of Object.values(bundle)) {
                if (asset.type !== "asset" || typeof asset.source !== "string") {
                    continue;
                }

                asset.source = renderVersionPlaceholders(asset.source, config.encodedCacheBust);
            }
        },
        closeBundle(): void {
            if (command !== "build") {
                return;
            }

            const manifestPath = join(pwaDistDir, "manifest.webmanifest");
            if (existsSync(manifestPath)) {
                writeFileSync(manifestPath, renderVersionPlaceholders(readFileSync(manifestPath, "utf8"), config.encodedCacheBust));
            }

            const indexPath = join(pwaDistDir, "index.html");
            if (existsSync(indexPath)) {
                writeFileSync(indexPath, renderVersionedHtml(readFileSync(indexPath, "utf8"), config.encodedCacheBust));
            }

            if (existsSync(thirdPartyNoticesPath)) {
                writeFileSync(join(pwaDistDir, "THIRD_PARTY_NOTICES.txt"), readFileSync(thirdPartyNoticesPath, "utf8"));
            }

            const serviceWorkerPath = join(pwaDistDir, "sw.js");
            if (existsSync(serviceWorkerPath)) {
                writeFileSync(
                    serviceWorkerPath,
                    renderServiceWorker(
                        renderVersionPlaceholders(readFileSync(serviceWorkerPath, "utf8"), config.encodedCacheBust),
                        pwaDistDir,
                        config.cacheBust
                    )
                );
            }
        }
    };
}

export default defineConfig(({ command, mode }) => {
    const highScoreBuildConfig = resolveHighScoreBuildConfig(command, mode);

    return {
        root: rootDir,
        base: command === "build" ? "./" : "/",
        plugins: [versionedHtmlPlugin(highScoreBuildConfig), versionedStaticAssetsPlugin(command, highScoreBuildConfig)],
        define: {
            __APP_VERSION__: JSON.stringify(versionInfo.version),
            __BUILD_STAMP__: JSON.stringify(versionInfo.buildStamp),
            __CACHE_BUST__: JSON.stringify(highScoreBuildConfig.cacheBust),
            __HIGH_SCORE_API_URL__: JSON.stringify(highScoreBuildConfig.apiUrl),
            __HIGH_SCORE_HMAC_KEY_HEX__: JSON.stringify(highScoreBuildConfig.hmacKeyHex)
        },
        build: {
            outDir: pwaDistDir,
            emptyOutDir: true,
            target: "es2022",
            sourcemap: false
        },
        server: {
            port: 5173,
            strictPort: false
        },
        preview: {
            port: 4173,
            strictPort: false
        }
    };
});
