import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const distDir =
    process.env.MSPACMAN_DIST_DIR !== undefined && process.env.MSPACMAN_DIST_DIR !== "" ? resolve(process.env.MSPACMAN_DIST_DIR) : join(rootDir, "dist");
export const releaseComponentsDir =
    process.env.MSPACMAN_RELEASE_COMPONENTS_DIR !== undefined && process.env.MSPACMAN_RELEASE_COMPONENTS_DIR !== ""
        ? resolve(process.env.MSPACMAN_RELEASE_COMPONENTS_DIR)
        : join(rootDir, ".release-components");
export const versionPath = join(rootDir, "version.json");
export const packageJsonPath = join(rootDir, "package.json");
export const desktopPomPath = join(rootDir, "desktop", "pom.xml");

export function getHmacNextCandidateDir() {
    return process.env.MSPACMAN_HMAC_NEXT_CANDIDATE_DIR !== undefined && process.env.MSPACMAN_HMAC_NEXT_CANDIDATE_DIR !== ""
        ? resolve(process.env.MSPACMAN_HMAC_NEXT_CANDIDATE_DIR)
        : join(rootDir, ".release-candidates", "hmac-next");
}

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

export function createStampedVersion(buildStamp = new Date().toISOString()) {
    const version = readVersion();
    version.buildStamp = buildStamp;
    writeVersion(version);
    return version;
}

export function getGitHeadCommit() {
    return readGitOutput(["rev-parse", "HEAD"]);
}

export function getGitStatusPorcelain() {
    return readGitOutput(["status", "--porcelain", "--untracked-files=normal"]);
}

export function assertGitWorkingTreeClean() {
    const status = getGitStatusPorcelain();
    if (status.trim() !== "") {
        throw new Error(`Git working tree is not clean. Commit, stash, or remove non-ignored changes before a production release.\n${status}`);
    }
}

export function readGitOutput(args) {
    const result = spawnGit(args);
    return result.stdout.trim();
}

export function spawnGit(args, options = {}) {
    const result = spawnSync("git", args, {
        cwd: rootDir,
        encoding: options.encoding ?? "utf8",
        maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
        windowsHide: true
    });
    if (result.status !== 0 || result.error) {
        throw result.error ?? new Error(`git ${args.join(" ")} failed.\n${result.stderr ?? ""}`);
    }
    return result;
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
