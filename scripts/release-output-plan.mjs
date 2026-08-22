import { join, resolve } from "node:path";

export function resolveReleaseOutputPlan({
    createTemporaryFullDistDir,
    hmacNextCandidateDir,
    keySource,
    releaseComponentsDir,
    repositoryDistDir,
    requestedOutputDir,
    target
}) {
    if (target === "full") {
        return resolveFullReleaseOutputPlan({
            createTemporaryFullDistDir,
            hmacNextCandidateDir,
            keySource,
            repositoryDistDir,
            requestedOutputDir
        });
    }

    if (target === "pwa" || target === "web") {
        const finalDistDir = requestedOutputDir ?? join(releaseComponentsDir, target);
        assertNotRepositoryDist(finalDistDir, repositoryDistDir, `${target} component release builds may not write canonical repository dist/.`);
        return {
            buildDistDir: finalDistDir,
            finalDistDir,
            hmacKeySource: keySource,
            releaseKind: "component",
            shouldPromoteFullBuild: false
        };
    }

    return {
        buildDistDir: repositoryDistDir,
        finalDistDir: repositoryDistDir,
        hmacKeySource: keySource,
        releaseKind: "desktop-component",
        shouldPromoteFullBuild: false
    };
}

export function normalizeRequestedOutputDir(rootDir, value) {
    if (value === undefined || value === "") {
        return null;
    }
    return resolve(rootDir, value);
}

export function pathsEqual(left, right) {
    const normalizedLeft = resolve(left);
    const normalizedRight = resolve(right);
    if (process.platform === "win32") {
        return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
    }
    return normalizedLeft === normalizedRight;
}

function resolveFullReleaseOutputPlan({ createTemporaryFullDistDir, hmacNextCandidateDir, keySource, repositoryDistDir, requestedOutputDir }) {
    if (keySource === "active") {
        if (requestedOutputDir !== null) {
            throw new Error("Production full releases must write canonical repository dist/. Do not pass --output-dir for active-key full releases.");
        }
        return createFullReleasePlan(repositoryDistDir, "production", "active", createTemporaryFullDistDir);
    }

    if (keySource === "env") {
        if (requestedOutputDir === null) {
            throw new Error("Synthetic HMAC full builds require --output-dir with an explicit non-production directory.");
        }
        assertNotRepositoryDist(requestedOutputDir, repositoryDistDir, "Synthetic HMAC full builds may not write canonical repository dist/.");
        return createFullReleasePlan(requestedOutputDir, "synthetic-test", "env", createTemporaryFullDistDir);
    }

    if (keySource === "next") {
        if (requestedOutputDir !== null) {
            throw new Error("Next-key rotation candidate releases write to the staged candidate directory. Do not pass --output-dir.");
        }
        return createFullReleasePlan(hmacNextCandidateDir, "rotation-candidate", "next", createTemporaryFullDistDir);
    }

    throw new Error(`Unknown HMAC key source: ${keySource}`);
}

function createFullReleasePlan(finalDistDir, releaseKind, hmacKeySource, createTemporaryFullDistDir) {
    return {
        buildDistDir: createTemporaryFullDistDir(finalDistDir),
        finalDistDir,
        hmacKeySource,
        releaseKind,
        shouldPromoteFullBuild: true
    };
}

function assertNotRepositoryDist(path, repositoryDistDir, message) {
    if (pathsEqual(path, repositoryDistDir)) {
        throw new Error(message);
    }
}
