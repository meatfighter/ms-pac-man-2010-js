import assert from "node:assert/strict";
import { join } from "node:path";
import { pathsEqual, rootDir } from "./build-utils.mjs";
import { normalizeRequestedOutputDir, resolveReleaseOutputPlan } from "./release-output-plan.mjs";
import { assertReleaseProvenance } from "./release-provenance.mjs";

const repositoryDistDir = join(rootDir, "dist");
const releaseComponentsDir = join(rootDir, ".release-components");
const hmacNextCandidateDir = join(rootDir, ".release-candidates", "hmac-next");
const syntheticOutputDir = join(rootDir, ".release-components", "synthetic-full");
const originalDistEnv = process.env.MSPACMAN_DIST_DIR;

try {
    await runTest("active-key full release writes only canonical repository dist", () => {
        const plan = createPlan({
            keySource: "active",
            requestedOutputDir: null,
            target: "full"
        });
        assert.equal(plan.releaseKind, "production");
        assert.equal(plan.hmacKeySource, "active");
        assert.equal(pathsEqual(plan.finalDistDir, repositoryDistDir), true);
        assert.equal(plan.buildDistDir.endsWith(".pending-test"), true);
        assert.equal(plan.shouldPromoteFullBuild, true);
    });

    await runTest("active-key full release rejects explicit output override", () => {
        assert.throws(
            () =>
                createPlan({
                    keySource: "active",
                    requestedOutputDir: syntheticOutputDir,
                    target: "full"
                }),
            /Production full releases must write canonical repository dist/
        );
    });

    await runTest("inherited MSPACMAN_DIST_DIR cannot redirect active-key full release", () => {
        process.env.MSPACMAN_DIST_DIR = join(rootDir, ".release-components", "redirected-dist");
        const plan = createPlan({
            keySource: "active",
            requestedOutputDir: null,
            target: "full"
        });
        assert.equal(pathsEqual(plan.finalDistDir, repositoryDistDir), true);
    });

    await runTest("env-key full release requires explicit noncanonical output", () => {
        assert.throws(
            () =>
                createPlan({
                    keySource: "env",
                    requestedOutputDir: null,
                    target: "full"
                }),
            /Synthetic HMAC full builds require --output-dir/
        );
    });

    await runTest("env-key full release rejects canonical repository dist output", () => {
        assert.throws(
            () =>
                createPlan({
                    keySource: "env",
                    requestedOutputDir: normalizeRequestedOutputDir(rootDir, "dist"),
                    target: "full"
                }),
            /Synthetic HMAC full builds may not write canonical repository dist/
        );
    });

    await runTest("env-key full release writes the requested noncanonical output", () => {
        const plan = createPlan({
            keySource: "env",
            requestedOutputDir: syntheticOutputDir,
            target: "full"
        });
        assert.equal(plan.releaseKind, "synthetic-test");
        assert.equal(plan.hmacKeySource, "env");
        assert.equal(pathsEqual(plan.finalDistDir, syntheticOutputDir), true);
        assert.equal(plan.buildDistDir, `${syntheticOutputDir}.pending-test`);
    });

    await runTest("next-key full release writes only the staged HMAC candidate directory", () => {
        const plan = createPlan({
            keySource: "next",
            requestedOutputDir: null,
            target: "full"
        });
        assert.equal(plan.releaseKind, "rotation-candidate");
        assert.equal(plan.hmacKeySource, "next");
        assert.equal(pathsEqual(plan.finalDistDir, hmacNextCandidateDir), true);
        assert.equal(plan.buildDistDir, `${hmacNextCandidateDir}.pending-test`);
    });

    await runTest("next-key full release rejects explicit output override", () => {
        assert.throws(
            () =>
                createPlan({
                    keySource: "next",
                    requestedOutputDir: syntheticOutputDir,
                    target: "full"
                }),
            /Next-key rotation candidate releases write to the staged candidate directory/
        );
    });

    await runTest("next-key full release rejects a staged candidate path that overlaps canonical dist", () => {
        assert.throws(
            () =>
                resolveReleaseOutputPlan({
                    createTemporaryFullDistDir: (finalDistDir) => `${finalDistDir}.pending-test`,
                    hmacNextCandidateDir: repositoryDistDir,
                    keySource: "next",
                    releaseComponentsDir,
                    repositoryDistDir,
                    requestedOutputDir: null,
                    target: "full"
                }),
            /Next-key rotation candidate releases may not write canonical repository dist/
        );
    });

    await runTest("explicit output rejects destructive repository paths", () => {
        for (const output of ["", ".", ".git", "pwa", "desktop", "scripts", ".release-secrets", ".release-candidates", "dist", "dist/nested"]) {
            const requestedOutputDir = output === "" ? rootDir : normalizeRequestedOutputDir(rootDir, output);
            assert.throws(
                () =>
                    createPlan({
                        keySource: "env",
                        requestedOutputDir,
                        target: "full"
                    }),
                /must not|may not/
            );
        }
    });

    await runTest("PWA and web component release outputs cannot target repository dist", () => {
        for (const target of ["pwa", "web"]) {
            assert.throws(
                () =>
                    createPlan({
                        keySource: "env",
                        requestedOutputDir: repositoryDistDir,
                        target
                    }),
                /component release builds may not write canonical repository dist/
            );
            const plan = createPlan({
                keySource: "env",
                requestedOutputDir: null,
                target
            });
            assert.equal(pathsEqual(plan.finalDistDir, join(releaseComponentsDir, target)), true);
            assert.equal(plan.releaseKind, "component");
            assert.equal(plan.shouldPromoteFullBuild, false);
        }
    });

    await runTest("release provenance accepts every supported artifact/key-source combination", () => {
        for (const [releaseKind, hmacKeySource] of [
            ["production", "active"],
            ["synthetic-test", "env"],
            ["rotation-candidate", "next"],
            ["component", "active"],
            ["component", "env"],
            ["component", "next"]
        ]) {
            assertReleaseProvenance(
                {
                    hmacKeySource,
                    releaseKind
                },
                {
                    expectedHmacKeySource: hmacKeySource,
                    expectedReleaseKind: releaseKind
                }
            );
        }
    });

    await runTest("release provenance does not infer artifact provenance from verifier key transport", () => {
        assertReleaseProvenance(
            {
                hmacKeySource: "active",
                releaseKind: "production"
            },
            {
                expectedHmacKeySource: "active",
                expectedReleaseKind: "production"
            }
        );
    });
} finally {
    if (originalDistEnv === undefined) {
        delete process.env.MSPACMAN_DIST_DIR;
    } else {
        process.env.MSPACMAN_DIST_DIR = originalDistEnv;
    }
}

function createPlan({ keySource, requestedOutputDir, target }) {
    return resolveReleaseOutputPlan({
        createTemporaryFullDistDir: (finalDistDir) => `${finalDistDir}.pending-test`,
        hmacNextCandidateDir,
        keySource,
        releaseComponentsDir,
        repositoryDistDir,
        requestedOutputDir,
        target
    });
}

async function runTest(name, fn) {
    try {
        await fn();
        console.log(`ok - ${name}`);
    } catch (error) {
        console.error(`not ok - ${name}`);
        console.error(error);
        process.exitCode = 1;
    }
}
