import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type PluginOption } from "vite";

interface VersionInfo {
    readonly version: string;
    readonly buildStamp: string;
}

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const versionInfo = JSON.parse(readFileSync(new URL("../version.json", import.meta.url), "utf8")) as VersionInfo;
const encodedBuildStamp = encodeURIComponent(versionInfo.buildStamp);
const highScoreApiUrl = process.env.MSPACMAN_SCORE_API_URL ?? "/api/ms-pac-man-2010/scores";
const highScoreHmacKeyHex = process.env.MSPACMAN_HMAC_KEY_HEX ?? "";

function renderVersionPlaceholders(text: string): string {
    return text
        .replaceAll("%APP_VERSION%", versionInfo.version)
        .replaceAll("%BUILD_STAMP%", encodedBuildStamp);
}

function appendBuildStampQuery(url: string): string {
    if (/[?&]v=/.test(url)) {
        return url;
    }
    return `${url}${url.includes("?") ? "&" : "?"}v=${encodedBuildStamp}`;
}

function versionBuiltAssetReferences(html: string): string {
    return html.replace(/\b(src|href)="([^"]*\/assets\/[^"]+\.(?:js|css)(?:\?[^"]*)?)"/g,
        (_match, attribute: string, url: string) => `${attribute}="${appendBuildStampQuery(url)}"`);
}

function placeAppModuleScriptAfterStaticBootHook(html: string): string {
    const scriptMatch = html.match(/[ \t]*<script\b(?=[^>]*\btype="module")(?=[^>]*\bsrc="[^"]+")[^>]*><\/script>\r?\n?/);
    if (!scriptMatch) {
        return html;
    }

    const scriptTag = scriptMatch[0].trim()
        .replace(/\s+id="[^"]*"/, "")
        .replace("<script", '<script id="app-module-script"');
    const withoutScript = html.replace(scriptMatch[0], "");
    return withoutScript.replace(/\r?\n[ \t]*<\/body>/, `\n        ${scriptTag}\n    </body>`);
}

function renderVersionedHtml(html: string): string {
    return versionBuiltAssetReferences(renderVersionPlaceholders(html));
}

function renderBuiltIndexHtml(html: string): string {
    return placeAppModuleScriptAfterStaticBootHook(renderVersionedHtml(html));
}

function versionedHtmlPlugin(): PluginOption {
    return {
        name: "versioned-html",
        transformIndexHtml: {
            order: "post",
            handler(html: string): string {
                return renderVersionedHtml(html);
            }
        }
    };
}

function versionedStaticAssetsPlugin(): PluginOption {
    return {
        name: "versioned-static-assets",
        generateBundle(_options, bundle): void {
            for (const asset of Object.values(bundle)) {
                if (asset.type !== "asset" || typeof asset.source !== "string") {
                    continue;
                }

                asset.source = renderVersionPlaceholders(asset.source);
            }
        },
        closeBundle(): void {
            const manifestPath = join(rootDir, "..", "dist", "pwa", "manifest.webmanifest");
            if (existsSync(manifestPath)) {
                writeFileSync(manifestPath, renderVersionPlaceholders(readFileSync(manifestPath, "utf8")));
            }

            const indexPath = join(rootDir, "..", "dist", "pwa", "index.html");
            if (existsSync(indexPath)) {
                writeFileSync(indexPath, renderBuiltIndexHtml(readFileSync(indexPath, "utf8")));
            }
        }
    };
}

export default defineConfig(({ command }) => ({
    root: rootDir,
    base: command === "build" ? "/pwa/" : "/",
    plugins: [
        versionedHtmlPlugin(),
        versionedStaticAssetsPlugin()
    ],
    define: {
        __APP_VERSION__: JSON.stringify(versionInfo.version),
        __BUILD_STAMP__: JSON.stringify(versionInfo.buildStamp),
        __HIGH_SCORE_API_URL__: JSON.stringify(highScoreApiUrl),
        __HIGH_SCORE_HMAC_KEY_HEX__: JSON.stringify(highScoreHmacKeyHex)
    },
    build: {
        outDir: "../dist/pwa",
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
}));
