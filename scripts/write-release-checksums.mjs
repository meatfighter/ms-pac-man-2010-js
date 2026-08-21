import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { distDir } from "./build-utils.mjs";

const checksumManifestName = "checksums.sha256";
const checksumManifestPath = join(distDir, checksumManifestName);

if (!existsSync(distDir)) {
    throw new Error("dist/ does not exist. Build release artifacts before writing checksums.");
}

const entries = [];
for (const path of listFiles(distDir)) {
    const relativePath = relative(distDir, path).replaceAll("\\", "/");
    if (relativePath === checksumManifestName) {
        continue;
    }
    entries.push(`${sha256File(path)}  ${relativePath}`);
}

writeFileSync(checksumManifestPath, `${entries.sort((a, b) => a.localeCompare(b)).join("\n")}\n`);
console.log(`Wrote ${relative(process.cwd(), checksumManifestPath)}`);

function listFiles(dir) {
    const files = [];
    collectFiles(dir, files);
    return files;
}

function collectFiles(dir, files) {
    for (const entry of readdirSync(dir).sort((a, b) => a.localeCompare(b))) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
            collectFiles(path, files);
        } else if (stat.isFile()) {
            files.push(path);
        }
    }
}

function sha256File(path) {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
}
