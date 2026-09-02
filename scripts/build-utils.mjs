import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertNoLinkTraversal, resolvePhysicalPath } from "./release-io.mjs";

export const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const repositoryDistDir = join(rootDir, "dist");
export const canonicalReleaseCandidatesDir = join(rootDir, ".release-candidates");
export const canonicalHmacNextCandidateDir = join(canonicalReleaseCandidatesDir, "hmac-next");
export const canonicalReleaseComponentsDir = join(rootDir, ".release-components");
export const canonicalReleaseSecretsDir = join(rootDir, ".release-secrets");
export const managedReleaseRoots = [repositoryDistDir, canonicalReleaseComponentsDir, canonicalReleaseCandidatesDir, canonicalReleaseSecretsDir];
export const desktopTargetDir = join(rootDir, "desktop", "target");
export const releasesDir = join(rootDir, "releases");
export const distDir = readInternalBuildOutputDir();
export const releaseComponentsDir = readManagedTestPathOverride(
    "MSPACMAN_TEST_RELEASE_COMPONENTS_DIR",
    canonicalReleaseComponentsDir,
    "release components directory"
);
export const versionPath = join(rootDir, "version.json");
export const packageJsonPath = join(rootDir, "package.json");

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

export function readBuildVersion() {
    const version = readVersion();
    const buildStamp = process.env.MSPACMAN_RELEASE_BUILD_STAMP;
    if (buildStamp !== undefined && buildStamp !== "") {
        return {
            ...version,
            buildStamp
        };
    }
    return version;
}

export function readPackageJson() {
    return JSON.parse(readFileSync(packageJsonPath, "utf8").replace(/^\uFEFF/, ""));
}

export function assertProjectVersionsMatch() {
    const packageVersion = readPackageJson().version;
    const versionJsonVersion = readVersion().version;
    if (packageVersion !== versionJsonVersion) {
        throw new Error(["Release versions must match before building.", `package.json: ${packageVersion}`, `version.json: ${versionJsonVersion}`].join("\n"));
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
    assertNotRepositoryRootOrAncestor(resolvedPath, description);
    assertManagedRootsAreNotLinks();
    const managedRoot = findReleaseMutationRoot(resolvedPath);
    if (managedRoot === null) {
        throw new Error(`${description} must use a managed release directory: ${resolvedPath}`);
    }
    assertNoLinkTraversal(resolvedPath, managedRoot, description);
    assertExistingPathIsDirectoryOrAbsent(resolvedPath, description);
    assertDoesNotPhysicallyOverlapTrackedSource(resolvedPath, description);
    return resolvedPath;
}

export function assertSafeGeneratedDirectoryMutationPath(path, description) {
    const resolvedPath = resolve(path);
    assertNotRepositoryRootOrAncestor(resolvedPath, description);
    const generatedRoot = findGeneratedDirectoryRoot(resolvedPath);
    if (generatedRoot === null) {
        throw new Error(`${description} must use a managed generated directory: ${resolvedPath}`);
    }
    assertNoLinkTraversal(resolvedPath, generatedRoot, description);
    assertExistingPathIsDirectoryOrAbsent(resolvedPath, description);
    return resolvedPath;
}

export function assertSafeGeneratedFileMutationPath(path, description) {
    const resolvedPath = resolve(path);
    assertSafeGeneratedDirectoryMutationPath(dirname(resolvedPath), `${description} parent directory`);
    const stat = lstatIfPresent(resolvedPath);
    if (stat?.isSymbolicLink()) {
        throw new Error(`${description} must not be a symlink or junction: ${resolvedPath}`);
    }
    if (stat !== null && !stat.isFile()) {
        throw new Error(`${description} must be a regular file or absent: ${resolvedPath}`);
    }
    return resolvedPath;
}

export function assertManagedRootsAreNotLinks() {
    for (const [path, label] of [
        [repositoryDistDir, "dist"],
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
    if (!existsSync(path)) {
        const stat = lstatIfPresent(path);
        if (stat?.isSymbolicLink()) {
            throw new Error(`${description} must not be a broken symlink or junction: ${path}`);
        }
        return;
    }
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
        throw new Error(`${description} must not be a symlink or junction: ${path}`);
    }
    if (!stat.isDirectory()) {
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
        assertManagedRootIsNotLink(repositoryDistDir, "dist");
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

function findReleaseMutationRoot(path) {
    const resolvedPath = resolve(path);
    if (pathsEqual(resolvedPath, repositoryDistDir) || isPathInside(resolvedPath, repositoryDistDir)) {
        return repositoryDistDir;
    }
    if (pathsEqual(resolvedPath, canonicalReleaseComponentsDir) || isPathInside(resolvedPath, canonicalReleaseComponentsDir)) {
        return canonicalReleaseComponentsDir;
    }
    if (pathsEqual(resolvedPath, canonicalReleaseCandidatesDir) || isPathInside(resolvedPath, canonicalReleaseCandidatesDir)) {
        return canonicalReleaseCandidatesDir;
    }
    if (pathsEqual(resolvedPath, canonicalReleaseSecretsDir) || isPathInside(resolvedPath, canonicalReleaseSecretsDir)) {
        return canonicalReleaseSecretsDir;
    }
    if (isControlledTemporaryReleasePath(resolvedPath)) {
        return rootDir;
    }
    if (isTestPathOverrideAllowed()) {
        const controlledTestRoot = findControlledTestTemporaryRoot(resolvedPath);
        if (controlledTestRoot !== null) {
            return controlledTestRoot;
        }
        for (const overrideRoot of readActiveTestOverrideRoots()) {
            if (pathsEqual(resolvedPath, overrideRoot) || isPathInside(resolvedPath, overrideRoot)) {
                return overrideRoot;
            }
        }
    }
    return null;
}

function findGeneratedDirectoryRoot(path) {
    const resolvedPath = resolve(path);
    for (const root of [desktopTargetDir, releasesDir]) {
        if (pathsEqual(resolvedPath, root) || isPathInside(resolvedPath, root)) {
            return root;
        }
    }
    return null;
}

function readActiveTestOverrideRoots() {
    return [
        process.env.MSPACMAN_TEST_DIST_DIR,
        process.env.MSPACMAN_TEST_RELEASE_COMPONENTS_DIR,
        process.env.MSPACMAN_TEST_HMAC_NEXT_CANDIDATE_DIR,
        process.env.MSPACMAN_TEST_RELEASE_SECRETS_DIR,
        process.env.MSPACMAN_INTERNAL_DIST_DIR
    ]
        .filter((value) => value !== undefined && value !== "")
        .map((value) => resolve(value));
}

function isControlledTemporaryReleasePath(path) {
    const parent = dirname(path);
    const name = basename(path);
    return (
        pathsEqual(parent, rootDir) &&
        (/^\.dist-pending-[A-Za-z0-9_-]+/.test(name) || /^\.dist-previous-\d+-\d+$/.test(name) || /^\.dist-active-before-hmac-finalize-\d+-\d+$/.test(name))
    );
}

function findControlledTestTemporaryRoot(path) {
    for (const overrideRoot of readActiveTestOverrideRoots()) {
        const parent = dirname(overrideRoot);
        const name = basename(path);
        const baseName = basename(overrideRoot);
        if (
            pathsEqual(dirname(path), parent) &&
            (name.startsWith(`.${baseName}-pending-`) ||
                name.startsWith(`.${baseName}-previous-`) ||
                name.startsWith(`.${baseName}-active-before-hmac-finalize-`))
        ) {
            return parent;
        }
    }
    return null;
}

function assertManagedRootIsNotLink(path, label) {
    const stat = lstatIfPresent(path);
    if (stat === null) {
        return;
    }
    if (stat.isSymbolicLink()) {
        throw new Error(`${label} must not be a symlink or junction: ${path}`);
    }
    const actual = resolvePhysicalPath(path);
    const expected = resolve(path);
    if (!pathsEqual(actual, expected)) {
        throw new Error(`${label} must not resolve through a symlink or junction: ${path}`);
    }
}

function lstatIfPresent(path) {
    try {
        return lstatSync(path);
    } catch (error) {
        if (error?.code === "ENOENT") {
            return null;
        }
        throw error;
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
