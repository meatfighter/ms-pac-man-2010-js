import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePhysicalPath } from "./release-io.mjs";

export const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const repositoryDistDir = join(rootDir, "dist");
export const canonicalReleaseCandidatesDir = join(rootDir, ".release-candidates");
export const canonicalHmacNextCandidateDir = join(canonicalReleaseCandidatesDir, "hmac-next");
export const canonicalReleaseComponentsDir = join(rootDir, ".release-components");
export const canonicalReleaseSecretsDir = join(rootDir, ".release-secrets");
export const managedReleaseRoots = [repositoryDistDir, canonicalReleaseComponentsDir, canonicalReleaseCandidatesDir, canonicalReleaseSecretsDir];
export const distDir = readInternalBuildOutputDir();
export const releaseComponentsDir = readManagedTestPathOverride(
    "MSPACMAN_TEST_RELEASE_COMPONENTS_DIR",
    canonicalReleaseComponentsDir,
    "release components directory"
);
export const versionPath = join(rootDir, "version.json");
export const packageJsonPath = join(rootDir, "package.json");
export const desktopPomPath = join(rootDir, "desktop", "pom.xml");

export function getHmacNextCandidateDir() {
    const path = readManagedTestPathOverride("MSPACMAN_TEST_HMAC_NEXT_CANDIDATE_DIR", canonicalHmacNextCandidateDir, "HMAC next candidate directory");
    return assertSafeHmacNextCandidateDir(path);
}

export function getReleaseDistDir() {
    return readManagedTestPathOverride("MSPACMAN_TEST_DIST_DIR", repositoryDistDir, "release dist directory");
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
    assertSafeReleaseMutationPath(path, "cleanDirectory");
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

export function assertSafeHmacNextCandidateDir(path) {
    const resolvedPath = resolve(path);
    if (pathsEqual(resolvedPath, canonicalHmacNextCandidateDir)) {
        assertManagedRootIsNotLink(canonicalReleaseCandidatesDir, ".release-candidates");
        return resolvedPath;
    }
    if (!isTestPathOverrideAllowed()) {
        throw new Error("HMAC next candidate releases use the managed .release-candidates/hmac-next directory.");
    }
    if (pathsOverlap(resolvedPath, repositoryDistDir)) {
        throw new Error(`MSPACMAN_TEST_HMAC_NEXT_CANDIDATE_DIR must not overlap dist/: ${resolvedPath}`);
    }
    assertSafeReleaseMutationPath(resolvedPath, "MSPACMAN_TEST_HMAC_NEXT_CANDIDATE_DIR");
    return resolvedPath;
}

export function assertSafeReleaseMutationPath(path, description) {
    const resolvedPath = resolve(path);
    assertNoLegacyPathOverrides();
    assertExistingPathIsDirectoryOrAbsent(resolvedPath, description);
    assertNotRepositoryRootOrAncestor(resolvedPath, description);
    assertManagedRootsAreNotLinks();
    assertDoesNotPhysicallyOverlapTrackedSource(resolvedPath, description);
    if (isPathAllowedForReleaseMutation(resolvedPath)) {
        return resolvedPath;
    }
    throw new Error(`${description} must use a managed release directory: ${resolvedPath}`);
}

export function assertManagedRootsAreNotLinks() {
    for (const [path, label] of [
        [canonicalReleaseComponentsDir, ".release-components"],
        [canonicalReleaseCandidatesDir, ".release-candidates"],
        [canonicalReleaseSecretsDir, ".release-secrets"]
    ]) {
        assertManagedRootIsNotLink(path, label);
    }
}

export function assertNoLegacyPathOverrides() {
    for (const name of ["MSPACMAN_DIST_DIR", "MSPACMAN_RELEASE_COMPONENTS_DIR", "MSPACMAN_HMAC_NEXT_CANDIDATE_DIR", "MSPACMAN_RELEASE_SECRETS_DIR"]) {
        if (process.env[name] !== undefined && process.env[name] !== "") {
            throw new Error(`${name} is no longer supported for release tooling. Use managed canonical paths or explicit test-only overrides.`);
        }
    }
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

function readInternalBuildOutputDir() {
    assertNoLegacyPathOverrides();
    const override = process.env.MSPACMAN_INTERNAL_DIST_DIR;
    if (override === undefined || override === "") {
        return getReleaseDistDir();
    }
    if (process.env.MSPACMAN_INTERNAL_RELEASE_BUILD !== "1" && !isTestPathOverrideAllowed()) {
        throw new Error("MSPACMAN_INTERNAL_DIST_DIR is reserved for release child build steps and tests.");
    }
    return assertSafeReleaseMutationPath(resolve(override), "MSPACMAN_INTERNAL_DIST_DIR");
}

function readManagedTestPathOverride(name, fallback, description) {
    assertNoLegacyPathOverrides();
    const value = process.env[name];
    if (value === undefined || value === "") {
        assertManagedRootForFallback(fallback, description);
        return fallback;
    }
    if (!isTestPathOverrideAllowed()) {
        throw new Error(`${name} is a test-only release path override and requires MSPACMAN_ENABLE_TEST_PATH_OVERRIDES=1.`);
    }
    return assertSafeReleaseMutationPath(resolve(value), name);
}

function isTestPathOverrideAllowed() {
    return process.env.MSPACMAN_ENABLE_TEST_PATH_OVERRIDES === "1";
}

function assertManagedRootForFallback(path, description) {
    const resolvedPath = resolve(path);
    if (pathsEqual(resolvedPath, repositoryDistDir)) {
        return;
    }
    if (pathsEqual(resolvedPath, canonicalReleaseComponentsDir)) {
        assertManagedRootIsNotLink(canonicalReleaseComponentsDir, ".release-components");
        return;
    }
    if (pathsEqual(resolvedPath, canonicalHmacNextCandidateDir) || isPathInside(resolvedPath, canonicalReleaseCandidatesDir)) {
        assertManagedRootIsNotLink(canonicalReleaseCandidatesDir, ".release-candidates");
        return;
    }
    if (pathsEqual(resolvedPath, canonicalReleaseSecretsDir) || isPathInside(resolvedPath, canonicalReleaseSecretsDir)) {
        assertManagedRootIsNotLink(canonicalReleaseSecretsDir, ".release-secrets");
        return;
    }
    throw new Error(`${description} is not a managed release path: ${path}`);
}

function isPathAllowedForReleaseMutation(path) {
    const resolvedPath = resolve(path);
    if (pathsEqual(resolvedPath, repositoryDistDir) || isPathInside(resolvedPath, repositoryDistDir)) {
        return true;
    }
    if (pathsEqual(resolvedPath, canonicalReleaseComponentsDir) || isPathInside(resolvedPath, canonicalReleaseComponentsDir)) {
        return true;
    }
    if (pathsEqual(resolvedPath, canonicalReleaseCandidatesDir) || isPathInside(resolvedPath, canonicalReleaseCandidatesDir)) {
        return true;
    }
    if (pathsEqual(resolvedPath, canonicalReleaseSecretsDir) || isPathInside(resolvedPath, canonicalReleaseSecretsDir)) {
        return true;
    }
    if (isControlledTemporaryReleasePath(resolvedPath)) {
        return true;
    }
    if (isTestPathOverrideAllowed()) {
        return true;
    }
    return false;
}

function isControlledTemporaryReleasePath(path) {
    const parent = dirname(path);
    const name = basename(path);
    return (
        pathsEqual(parent, rootDir) &&
        (/^\.dist-pending-[A-Za-z0-9_-]+/.test(name) || /^\.dist-previous-\d+-\d+$/.test(name) || /^\.dist-active-before-hmac-finalize-\d+-\d+$/.test(name))
    );
}

function assertManagedRootIsNotLink(path, label) {
    if (!existsSync(path)) {
        return;
    }
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
        throw new Error(`${label} must not be a symlink or junction: ${path}`);
    }
    const actual = resolvePhysicalPath(path);
    const expected = resolve(path);
    if (!pathsEqual(actual, expected)) {
        throw new Error(`${label} must not resolve through a symlink or junction: ${path}`);
    }
}

function assertDoesNotPhysicallyOverlapTrackedSource(path, description) {
    const physicalPath = resolvePhysicalPath(path);
    const protectedPaths = [
        [join(rootDir, ".git"), ".git"],
        [join(rootDir, "about"), "about/"],
        [join(rootDir, "assets"), "assets/"],
        [join(rootDir, "desktop"), "desktop/"],
        [join(rootDir, "pwa"), "pwa/"],
        [join(rootDir, "scripts"), "scripts/"],
        [join(rootDir, "version.json"), "version.json"],
        [join(rootDir, "package.json"), "package.json"]
    ];
    for (const [protectedPath, label] of protectedPaths) {
        const physicalProtected = resolvePhysicalPath(protectedPath);
        if (pathsOverlap(physicalPath, physicalProtected)) {
            throw new Error(`${description} must not physically overlap ${label}: ${path}`);
        }
    }
}
