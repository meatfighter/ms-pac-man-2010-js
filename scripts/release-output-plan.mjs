import { join, resolve } from "node:path";
import { assertSafeReleaseMutationPath, pathsEqual } from "./build-utils.mjs";

export function resolveReleaseOutputPlan({ hmacNextCandidateDir, keySource, releaseComponentsDir, repositoryDistDir, requestedOutputDir, target }) {
    if (target === "full") {
        return resolveFullReleaseOutputPlan({
            hmacNextCandidateDir,
            keySource,
            releaseComponentsDir,
            repositoryDistDir,
            requestedOutputDir
        });
    }

    if (target === "pwa" || target === "web") {
        if (requestedOutputDir !== null) {
            throw new Error(`${target} component release builds use the managed .release-components/${target} directory. Do not pass --output-dir.`);
        }
        const finalDistDir = join(releaseComponentsDir, target);
        assertNotRepositoryDist(finalDistDir, repositoryDistDir, `${target} component release builds may not write canonical repository dist/.`);
        assertSafeReleaseMutationPath(finalDistDir, `${target} component release output`);
        return {
            buildDistDir: finalDistDir,
            finalDistDir,
            hmacKeySource: keySource,
            releaseKind: "component",
            shouldPromoteFullBuild: false
        };
    }

    if (target === "desktop") {
        if (requestedOutputDir !== null) {
            throw new Error("Desktop release output is managed by desktop/target. Do not pass --output-dir.");
        }
        return {
            buildDistDir: repositoryDistDir,
            finalDistDir: repositoryDistDir,
            hmacKeySource: keySource,
            releaseKind: "desktop-component",
            shouldPromoteFullBuild: false
        };
    }

    throw new Error(`Unknown release target: ${target}`);
}

export function createFullReleasePlan(finalDistDir, releaseKind, hmacKeySource, buildDistDir) {
    return {
        buildDistDir,
        finalDistDir,
        hmacKeySource,
        releaseKind,
        shouldPromoteFullBuild: true
    };
}

export function normalizeRequestedOutputDir(rootDir, value) {
    if (value === undefined || value === "") {
        return null;
    }
    return resolve(rootDir, value);
}

function resolveFullReleaseOutputPlan({ hmacNextCandidateDir, keySource, releaseComponentsDir, repositoryDistDir, requestedOutputDir }) {
    if (keySource === "active") {
        if (requestedOutputDir !== null) {
            throw new Error("Production full releases must write canonical repository dist/. Do not pass --output-dir for active-key full releases.");
        }
        assertSafeReleaseMutationPath(repositoryDistDir, "Production full release output");
        return createFullReleasePlan(repositoryDistDir, "production", "active", repositoryDistDir);
    }

    if (keySource === "env") {
        if (requestedOutputDir !== null) {
            throw new Error("Synthetic full releases use the managed .release-components/synthetic-full directory. Do not pass --output-dir.");
        }
        const syntheticFullDir = join(releaseComponentsDir, "synthetic-full");
        assertNotRepositoryDist(syntheticFullDir, repositoryDistDir, "Synthetic HMAC full builds may not write canonical repository dist/.");
        assertSafeReleaseMutationPath(syntheticFullDir, "Synthetic HMAC full build output");
        return createFullReleasePlan(syntheticFullDir, "synthetic-test", "env", repositoryDistDir);
    }

    if (keySource === "next") {
        if (requestedOutputDir !== null) {
            throw new Error("Next-key rotation candidate releases write to the staged candidate directory. Do not pass --output-dir.");
        }
        assertNotRepositoryDist(hmacNextCandidateDir, repositoryDistDir, "Next-key rotation candidate releases may not write canonical repository dist/.");
        assertSafeReleaseMutationPath(hmacNextCandidateDir, "Next-key rotation candidate release output");
        return createFullReleasePlan(hmacNextCandidateDir, "rotation-candidate", "next", repositoryDistDir);
    }

    throw new Error(`Unknown HMAC key source: ${keySource}`);
}

function assertNotRepositoryDist(path, repositoryDistDir, message) {
    if (pathsEqual(path, repositoryDistDir)) {
        throw new Error(message);
    }
}
