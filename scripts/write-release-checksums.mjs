import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { distDir } from "./build-utils.mjs";
import { listFilesStrict } from "./release-io.mjs";

const checksumManifestName = "checksums.sha256";
const checksumManifestPath = join(distDir, checksumManifestName);

if (!existsSync(distDir)) {
    throw new Error("dist/ does not exist. Build release artifacts before writing checksums.");
}

const entries = [];
for (const path of listFilesStrict(distDir, "Release checksum input")) {
    const relativePath = relative(distDir, path).replaceAll("\\", "/");
    if (relativePath === checksumManifestName) {
        continue;
    }
    entries.push(`${sha256File(path)}  ${relativePath}`);
}

writeFileSync(checksumManifestPath, `${entries.sort((a, b) => a.localeCompare(b)).join("\n")}\n`);
console.log(`Wrote ${relative(process.cwd(), checksumManifestPath)}`);

function sha256File(path) {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
}
