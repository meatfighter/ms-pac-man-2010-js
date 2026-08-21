import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { distDir, readVersion, rootDir } from "./build-utils.mjs";
import { createCacheIdentity, getHmacFingerprint, readEnvHmacKey } from "./hmac-config.mjs";

const version = readVersion();
const hmacKeyHex = readEnvHmacKey();
const cacheIdentity = createCacheIdentity(version, hmacKeyHex);
const serviceWorkerVersion = readServiceWorkerVersion();
const release = {
    app: "Ms. Pac-Man 2010",
    version: version.version,
    buildStamp: version.buildStamp,
    gitCommit: readGitOutput(["rev-parse", "HEAD"]) ?? "unavailable",
    gitTreeState: (readGitOutput(["status", "--porcelain"]) ?? "").trim() === "" ? "clean" : "dirty",
    hmacKeyFingerprint: getHmacFingerprint(hmacKeyHex),
    pwa: serviceWorkerVersion,
    deployment: {
        aboutBase: "./",
        pwaBase: "./",
        scoreApiUrl: "/api/ms-pac-man-2010/scores",
        cacheNamespace: "service-worker-registration-scope",
        browserStorageNamespace: "deployment-path"
    }
};
const outputPath = join(distDir, "release.json");

writeFileSync(outputPath, `${JSON.stringify(release, null, 4)}\n`);
console.log(`Wrote ${relative(rootDir, outputPath)}`);

function readServiceWorkerVersion() {
    const serviceWorkerPath = join(distDir, "pwa", "sw.js");
    if (!existsSync(serviceWorkerPath)) {
        return null;
    }

    const serviceWorker = readFileSync(serviceWorkerPath, "utf8");
    const match = /^const VERSION = ("[^"]+");$/m.exec(serviceWorker);
    if (match === null || match[1] === undefined) {
        return null;
    }

    const embeddedVersion = JSON.parse(match[1]);
    return {
        base: "./",
        cacheBust: cacheIdentity,
        serviceWorkerVersion: embeddedVersion,
        serviceWorkerSha256: createHash("sha256").update(serviceWorker).digest("hex")
    };
}

function readGitOutput(args) {
    const result = spawnSync("git", args, {
        cwd: rootDir,
        encoding: "utf8",
        windowsHide: true
    });
    if (result.status !== 0 || result.error) {
        return null;
    }
    return result.stdout.trim();
}
