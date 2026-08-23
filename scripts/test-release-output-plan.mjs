import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSafeReleaseMutationPath, pathsEqual, rootDir, spawnGit } from "./build-utils.mjs";
import { normalizeRequestedOutputDir, resolveReleaseOutputPlan } from "./release-output-plan.mjs";
import { assertReleaseProvenance } from "./release-provenance.mjs";

const repositoryDistDir = join(rootDir, "dist");
const releaseComponentsDir = join(rootDir, ".release-components");
const hmacNextCandidateDir = join(rootDir, ".release-candidates", "hmac-next");
const syntheticOutputDir = join(rootDir, ".release-components", "synthetic-full");
await runTest("active-key full release writes only canonical repository dist", () => {
    const plan = createPlan({
        keySource: "active",
        requestedOutputDir: null,
        target: "full"
    });
    assert.equal(plan.releaseKind, "production");
    assert.equal(plan.hmacKeySource, "active");
    assert.equal(pathsEqual(plan.finalDistDir, repositoryDistDir), true);
    assert.equal(pathsEqual(plan.buildDistDir, repositoryDistDir), true);
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

await runTest("inherited MSPACMAN_INTERNAL_DIST_DIR cannot redirect active-key full release", () => {
    process.env.MSPACMAN_INTERNAL_DIST_DIR = join(rootDir, ".release-components", "redirected-dist");
    const plan = createPlan({
        keySource: "active",
        requestedOutputDir: null,
        target: "full"
    });
    assert.equal(pathsEqual(plan.finalDistDir, repositoryDistDir), true);
});

await runTest("env-key full release uses only the managed synthetic-full directory", () => {
    const plan = createPlan({
        keySource: "env",
        requestedOutputDir: null,
        target: "full"
    });
    assert.equal(plan.releaseKind, "synthetic-test");
    assert.equal(plan.hmacKeySource, "env");
    assert.equal(pathsEqual(plan.finalDistDir, syntheticOutputDir), true);
    assert.equal(pathsEqual(plan.buildDistDir, repositoryDistDir), true);
});

await runTest("env-key full release rejects explicit output overrides", () => {
    for (const requestedOutputDir of [repositoryDistDir, syntheticOutputDir, join(rootDir, "assets")]) {
        assert.throws(
            () =>
                createPlan({
                    keySource: "env",
                    requestedOutputDir,
                    target: "full"
                }),
            /Synthetic full releases use the managed/
        );
    }
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
    assert.equal(pathsEqual(plan.buildDistDir, repositoryDistDir), true);
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

await runTest("no tracked top-level path can be selected as a generated release root", () => {
    for (const output of readTrackedTopLevelEntries()) {
        const requestedOutputDir = normalizeRequestedOutputDir(rootDir, output);
        assert.throws(
            () =>
                createPlan({
                    keySource: "env",
                    requestedOutputDir,
                    target: "full"
                }),
            /managed/
        );
    }
});

await runTest("physical links to tracked source are rejected as release output", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "mspacman-release-link-test-"));
    const linkPath = join(tempRoot, "assets-link");
    try {
        try {
            symlinkSync(join(rootDir, "assets"), linkPath, process.platform === "win32" ? "junction" : "dir");
        } catch (error) {
            console.log(`ok - physical link creation unavailable; skipped link assertion (${error.code ?? "unknown"})`);
            return;
        }
        assert.throws(() => assertSafeReleaseMutationPath(linkPath, "linked release output"), /managed|physically overlap|symlink|junction/);
    } finally {
        rmSync(tempRoot, { recursive: true, force: true });
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
            /component release builds use the managed/
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

await runTest("desktop release rejects explicit output overrides", () => {
    assert.throws(
        () =>
            createPlan({
                keySource: "active",
                requestedOutputDir: syntheticOutputDir,
                target: "desktop"
            }),
        /Desktop release output is managed/
    );
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
function createPlan({ keySource, requestedOutputDir, target }) {
    return resolveReleaseOutputPlan({
        hmacNextCandidateDir,
        keySource,
        releaseComponentsDir,
        repositoryDistDir,
        requestedOutputDir,
        target
    });
}

function readTrackedTopLevelEntries() {
    return new Set(
        spawnGit(["ls-files", "-z"])
            .stdout.split("\0")
            .filter(Boolean)
            .map((path) => path.split("/")[0])
    );
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
