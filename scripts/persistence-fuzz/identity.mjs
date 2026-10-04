import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { platform, release, arch } from "node:os";
import { spawnSync } from "node:child_process";
const excluded = new Set([
    ".git",
    "node_modules",
    ".release-components",
    ".release-secrets",
    ".release-candidates",
    "build",
    "target",
    "releases",
    "coverage",
    "test-results",
    "playwright-report"
]);
export function inventory(repo, onlyDist = false) {
    const files = {};
    function walk(directory) {
        for (const name of readdirSync(directory).sort()) {
            const path = join(directory, name),
                info = lstatSync(path),
                rel = relative(repo, path).replaceAll("\\", "/");
            if (excluded.has(name)) continue;
            if (info.isSymbolicLink()) {
                files[rel] = "SYMLINK";
                continue;
            }
            if (info.isDirectory()) {
                if (onlyDist || name !== "dist") walk(path);
            } else if (info.isFile()) files[rel] = createHash("sha256").update(readFileSync(path)).digest("hex");
        }
    }
    const root = onlyDist ? join(repo, "dist") : repo;
    if (existsSync(root)) walk(root);
    return files;
}
export function sourceIdentity(repo) {
    const files = inventory(repo),
        digest = createHash("sha256").update(JSON.stringify(files)).digest("hex");
    const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8", windowsHide: true });
    const packageInfo = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
    const prefix = packageInfo.name === "jackal-js" ? "jackal" : packageInfo.name === "stickvania-js" ? "stickvania" : "mspacman";
    const schemaFile = prefix === "mspacman" ? "GameStateSnapshot.ts" : "GameStateSchema.ts";
    const schemaVersion = Number(readFileSync(join(repo, "pwa/src", prefix, "persistence", schemaFile), "utf8").match(/GAME_STATE_VERSION\s*=\s*(\d+)/)?.[1]);
    const build = JSON.parse(readFileSync(join(repo, "version.json"), "utf8"));
    const dependency = JSON.parse(readFileSync(join(repo, "package-lock.json"), "utf8")).packages?.["node_modules/slick2d-ts"];
    let actualEngine = null;
    try {
        actualEngine = JSON.parse(readFileSync(join(repo, "node_modules/slick2d-ts/package.json"), "utf8")).version;
    } catch {
        /* Report unavailable, do not install. */
    }
    let engineDigest = null;
    const installedRoot = join(repo, "node_modules/slick2d-ts");
    if (existsSync(installedRoot)) {
        // Include built engine bytes; version strings alone cannot identify a pin.
        const engineFiles = { ...inventory(installedRoot), ...inventory(installedRoot, true) };
        engineDigest = createHash("sha256").update(JSON.stringify(engineFiles)).digest("hex");
    }
    return {
        digest,
        engineDigest,
        schemaVersion,
        build,
        engineResolution: dependency?.resolved,
        engineIntegrity: dependency?.integrity,
        os: { platform: platform(), release: release(), arch: arch() },
        nodeVersion: process.version,
        gitCommit: git.status === 0 ? git.stdout.trim() : null,
        appVersion: packageInfo.version,
        enginePin: packageInfo.dependencies?.["slick2d-ts"] ?? null,
        installedEngineVersion: actualEngine,
        files
    };
}
