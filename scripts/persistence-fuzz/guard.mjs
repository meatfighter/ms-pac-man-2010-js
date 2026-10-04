import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { join, relative } from "node:path";
const banned = /__PERSISTENCE_FUZZ_ONLY__|__persistenceFuzz|__persistence_fuzz__\//;
/** Scan emitted files including service workers and maps; no runtime imports. */
export function assertNoFuzzInRelease(root) {
    function walk(directory) {
        for (const name of readdirSync(directory)) {
            const path = join(directory, name),
                stat = lstatSync(path);
            if (stat.isSymbolicLink()) throw new Error(`Release entry is a symlink: ${path}`);
            if (stat.isDirectory()) walk(path);
            else if (/\.(?:js|mjs|html|json|map|webmanifest|css)$/.test(name) && banned.test(readFileSync(path, "utf8")))
                throw new Error(`Test-only persistence fuzz code leaked into release: ${relative(root, path)}`);
        }
    }
    walk(root);
}
