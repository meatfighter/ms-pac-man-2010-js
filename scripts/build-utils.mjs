import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const distDir =
    process.env.MSPACMAN_DIST_DIR !== undefined && process.env.MSPACMAN_DIST_DIR !== "" ? resolve(process.env.MSPACMAN_DIST_DIR) : join(rootDir, "dist");
export const versionPath = join(rootDir, "version.json");

export function readVersion() {
    return JSON.parse(readFileSync(versionPath, "utf8").replace(/^\uFEFF/, ""));
}

export function writeVersion(version) {
    writeFileSync(versionPath, `${JSON.stringify(version, null, 4)}\n`);
}

export function ensureDirectory(path) {
    mkdirSync(path, { recursive: true });
}

export function cleanDirectory(path) {
    rmSync(path, { recursive: true, force: true });
    ensureDirectory(path);
}

export function copyDirectory(source, target) {
    if (!existsSync(source)) {
        return;
    }
    cpSync(source, target, { recursive: true });
}

export function renderTemplate(template, replacements) {
    let rendered = template;
    for (const [key, value] of Object.entries(replacements)) {
        rendered = rendered.replaceAll(key, value);
    }
    return rendered;
}
