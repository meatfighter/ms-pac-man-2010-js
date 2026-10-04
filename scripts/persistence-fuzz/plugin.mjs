import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
const normalizedDirectory = directory.replaceAll("\\", "/");
const prefix = "/__persistence_fuzz__/";
const modules = new Set(["browser.mjs", "adapter.mjs", "compare.mjs", "prng.mjs"]);
/** This plugin is installed only by the test worker, never by a release config. */
export function persistenceFuzzPlugin() {
    return {
        name: "local-persistence-fuzz-fixture",
        apply: "serve",
        enforce: "pre",
        resolveId(source, importer) {
            const clean = source.split("?")[0];
            if (clean.startsWith(prefix) && modules.has(clean.slice(prefix.length))) return join(directory, clean.slice(prefix.length)).replaceAll("\\", "/");
            if (importer?.replaceAll("\\", "/").startsWith(normalizedDirectory) && source.startsWith("./") && modules.has(source.slice(2)))
                return join(directory, source.slice(2)).replaceAll("\\", "/");
            return null;
        },
        configureServer(server) {
            server.middlewares.use(async (request, response, next) => {
                if (request.url?.split("?")[0] !== `${prefix}index.html`) return next();
                response.statusCode = 200;
                response.setHeader("Content-Type", "text/html; charset=utf-8");
                response.setHeader("Cache-Control", "no-store");
                response.end(
                    await server.transformIndexHtml(
                        request.url,
                        `<!doctype html><html><head><meta charset="utf-8"><title>Persistence fuzz — local test only</title><style>body{margin:0;background:#111;color:white}#game-host{width:800px;height:750px}canvas{outline:0}</style></head><body><button id="start">Start isolated trial</button><div id="game-host"></div><script type="module" src="${prefix}browser.mjs"></script></body></html>`
                    )
                );
            });
        }
    };
}
export function controlledAudioSource() {
    return readFileSync(join(directory, "controlled-audio.js"), "utf8");
}
