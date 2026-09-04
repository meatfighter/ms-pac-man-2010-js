import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { distDir, readBuildVersion, rootDir } from "./build-utils.mjs";
import { createCacheIdentity, getHmacFingerprint, readEnvHmacKey } from "./hmac-config.mjs";

const version = readBuildVersion();
const hmacKeyHex = readEnvHmacKey();
const cacheIdentity = createCacheIdentity(version, hmacKeyHex);
const serviceWorkerVersion = readServiceWorkerVersion();
const gitCommit = readRequiredEnv("MSPACMAN_RELEASE_GIT_COMMIT");
const gitTreeState = readRequiredEnv("MSPACMAN_RELEASE_GIT_TREE_STATE");
const releaseKind = readRequiredEnv("MSPACMAN_RELEASE_KIND");
const hmacKeySource = readRequiredEnv("MSPACMAN_RELEASE_HMAC_KEY_SOURCE");
const release = {
    app: "Ms. Pac-Man 2010",
    version: version.version,
    buildStamp: version.buildStamp,
    gitCommit,
    gitTreeState,
    hmacKeySource,
    hmacKeyFingerprint: getHmacFingerprint(hmacKeyHex),
    releaseKind,
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

function readRequiredEnv(name) {
    const value = process.env[name];
    if (value === undefined || value === "") {
        throw new Error(`${name} is required for release metadata.`);
    }
    return value;
}
