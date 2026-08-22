import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const repositoryDistDir = join(rootDir, "dist");
export const canonicalReleaseCandidatesDir = join(rootDir, ".release-candidates");
export const canonicalHmacNextCandidateDir = join(canonicalReleaseCandidatesDir, "hmac-next");
export const canonicalReleaseComponentsDir = join(rootDir, ".release-components");
export const canonicalReleaseSecretsDir = join(rootDir, ".release-secrets");
export const distDir =
    process.env.MSPACMAN_DIST_DIR !== undefined && process.env.MSPACMAN_DIST_DIR !== "" ? resolve(process.env.MSPACMAN_DIST_DIR) : repositoryDistDir;
export const releaseComponentsDir =
    process.env.MSPACMAN_RELEASE_COMPONENTS_DIR !== undefined && process.env.MSPACMAN_RELEASE_COMPONENTS_DIR !== ""
        ? assertSafeReleaseStateOutputPath(resolve(process.env.MSPACMAN_RELEASE_COMPONENTS_DIR), "MSPACMAN_RELEASE_COMPONENTS_DIR")
        : canonicalReleaseComponentsDir;
export const versionPath = join(rootDir, "version.json");
export const packageJsonPath = join(rootDir, "package.json");
export const desktopPomPath = join(rootDir, "desktop", "pom.xml");

export function getHmacNextCandidateDir() {
    const path =
        process.env.MSPACMAN_HMAC_NEXT_CANDIDATE_DIR !== undefined && process.env.MSPACMAN_HMAC_NEXT_CANDIDATE_DIR !== ""
            ? resolve(process.env.MSPACMAN_HMAC_NEXT_CANDIDATE_DIR)
            : canonicalHmacNextCandidateDir;
    return assertSafeHmacNextCandidateDir(path);
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

export function assertSafeGeneratedOutputPath(path, description) {
    const resolvedPath = resolve(path);
    assertExistingPathIsDirectoryOrAbsent(resolvedPath, description);
    assertNotRepositoryRootOrAncestor(resolvedPath, description);
    assertDoesNotOverlapAny(
        resolvedPath,
        [
            [join(rootDir, ".git"), ".git"],
            [join(rootDir, "about"), "about/"],
            [join(rootDir, "desktop"), "desktop/"],
            [join(rootDir, "pwa"), "pwa/"],
            [join(rootDir, "scripts"), "scripts/"],
            [canonicalReleaseSecretsDir, ".release-secrets/"],
            [canonicalReleaseCandidatesDir, ".release-candidates/"],
            [repositoryDistDir, "dist/"]
        ],
        description
    );
    return resolvedPath;
}

export function assertSafeReleaseStateOutputPath(path, description) {
    const resolvedPath = resolve(path);
    assertExistingPathIsDirectoryOrAbsent(resolvedPath, description);
    assertNotRepositoryRootOrAncestor(resolvedPath, description);
    assertDoesNotOverlapAny(
        resolvedPath,
        [
            [join(rootDir, ".git"), ".git"],
            [join(rootDir, "about"), "about/"],
            [join(rootDir, "desktop"), "desktop/"],
            [join(rootDir, "pwa"), "pwa/"],
            [join(rootDir, "scripts"), "scripts/"],
            [canonicalReleaseSecretsDir, ".release-secrets/"],
            [canonicalReleaseCandidatesDir, ".release-candidates/"],
            [repositoryDistDir, "dist/"]
        ],
        description
    );
    return resolvedPath;
}

export function assertSafeHmacNextCandidateDir(path) {
    const resolvedPath = resolve(path);
    if (pathsEqual(resolvedPath, canonicalHmacNextCandidateDir)) {
        return resolvedPath;
    }
    assertSafeReleaseStateOutputPath(resolvedPath, "MSPACMAN_HMAC_NEXT_CANDIDATE_DIR");
    return resolvedPath;
}

export function pathsEqual(left, right) {
    const normalizedLeft = resolve(left);
    const normalizedRight = resolve(right);
    if (process.platform === "win32") {
        return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
    }
    return normalizedLeft === normalizedRight;
}

export function pathsOverlap(left, right) {
    return pathsEqual(left, right) || isPathInside(left, right) || isPathInside(right, left);
}

export function isPathInside(path, parent) {
    const normalizedPath = resolve(path);
    const normalizedParent = resolve(parent);
    if (pathsEqual(normalizedPath, normalizedParent)) {
        return false;
    }
    const prefix =
        normalizedParent.endsWith("\\") || normalizedParent.endsWith("/")
            ? normalizedParent
            : `${normalizedParent}${process.platform === "win32" ? "\\" : "/"}`;
    if (process.platform === "win32") {
        return normalizedPath.toLowerCase().startsWith(prefix.toLowerCase());
    }
    return normalizedPath.startsWith(prefix);
}

function assertExistingPathIsDirectoryOrAbsent(path, description) {
    if (existsSync(path) && !statSync(path).isDirectory()) {
        throw new Error(`${description} must be a directory or an absent path: ${path}`);
    }
}

function assertNotRepositoryRootOrAncestor(path, description) {
    if (pathsEqual(path, rootDir) || isPathInside(rootDir, path)) {
        throw new Error(`${description} must not be the repository root or one of its ancestors: ${path}`);
    }
}

function assertDoesNotOverlapAny(path, forbiddenPaths, description) {
    for (const [forbiddenPath, label] of forbiddenPaths) {
        if (pathsOverlap(path, forbiddenPath)) {
            throw new Error(`${description} must not overlap ${label}: ${path}`);
        }
    }
}
