import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const distDir =
    process.env.MSPACMAN_DIST_DIR !== undefined && process.env.MSPACMAN_DIST_DIR !== "" ? resolve(process.env.MSPACMAN_DIST_DIR) : join(rootDir, "dist");
export const versionPath = join(rootDir, "version.json");
export const packageJsonPath = join(rootDir, "package.json");
export const desktopPomPath = join(rootDir, "desktop", "pom.xml");

export function readVersion() {
    return JSON.parse(readFileSync(versionPath, "utf8").replace(/^\uFEFF/, ""));
}

export function readPackageJson() {
    return JSON.parse(readFileSync(packageJsonPath, "utf8").replace(/^\uFEFF/, ""));
}

export function readDesktopPomVersion() {
    const pom = readFileSync(desktopPomPath, "utf8").replace(/^\uFEFF/, "");
    const match = /<project\b[\s\S]*?<version>([^<]+)<\/version>/.exec(pom);
    if (match === null || match[1] === undefined) {
        throw new Error("desktop/pom.xml does not contain a project version.");
    }
    return match[1].trim();
}

export function assertProjectVersionsMatch() {
    const packageVersion = readPackageJson().version;
    const versionJsonVersion = readVersion().version;
    const desktopVersion = readDesktopPomVersion();
    if (packageVersion !== versionJsonVersion || packageVersion !== desktopVersion) {
        throw new Error(
            [
                "Release versions must match before building.",
                `package.json: ${packageVersion}`,
                `version.json: ${versionJsonVersion}`,
                `desktop/pom.xml: ${desktopVersion}`
            ].join("\n")
        );
    }
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
