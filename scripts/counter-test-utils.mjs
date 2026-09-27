import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, relative } from "node:path";
import { createServer } from "vite";

export async function withCounterModules(transforms, run) {
    const cacheDir = mkdtempSync(join(tmpdir(), "mspacman-counter-"));
    let server;
    try {
        server = await createServer({
            root: resolve("pwa"),
            cacheDir,
            appType: "custom",
            logLevel: "silent",
            server: { middlewareMode: true },
            plugins: [
                {
                    name: "counter-test-only-transform",
                    enforce: "pre",
                    transform(source, id) {
                        for (const [suffix, transform] of Object.entries(transforms))
                            if (id.replaceAll("\\", "/").endsWith(suffix + ".ts")) return transform(source);
                    }
                }
            ]
        });
        await run((path) => server.ssrLoadModule("/src/mspacman/" + path + ".ts"));
    } finally {
        if (server) await server.close();
        const rel = relative(tmpdir(), cacheDir);
        assert.ok(rel && !rel.startsWith("..") && !rel.includes(":"));
        rmSync(cacheDir, { recursive: true, force: true });
    }
}
export function replace(source, from, to) {
    assert.ok(source.includes(from), "mutation anchor: " + from);
    return source.replace(from, to);
}
