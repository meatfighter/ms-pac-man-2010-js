import { spawnSync } from "node:child_process";
import { assertSecretAbsentFromTrackedFiles, checkActiveHmacKey, checkRotationKeys, ensureNextKey, readSelectedHmacKey } from "./hmac-config.mjs";
import { assertGitWorkingTreeClean, getHmacNextCandidateDir, rootDir } from "./build-utils.mjs";

let nextFingerprint = "";
try {
    assertGitWorkingTreeClean();
    const activeFingerprint = await checkActiveHmacKey();
    const next = ensureNextKey();
    nextFingerprint = next.fingerprint;
    const nextKey = readSelectedHmacKey("next");
    await assertSecretAbsentFromTrackedFiles(nextKey);
    const rotation = checkRotationKeys();

    console.log(`Active key fingerprint: ${activeFingerprint}`);
    console.log(`${next.created ? "Created" : "Reusing"} next HMAC key.`);
    console.log(`Next key fingerprint: ${nextFingerprint}`);
    runBuildRelease();
    console.log(`Verified candidate release with active key fingerprint: ${activeFingerprint}`);
    console.log(`Verified candidate release with next key fingerprint: ${rotation.nextFingerprint}`);
    console.log(`Candidate release written to: ${getHmacNextCandidateDir()}`);
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    if (nextFingerprint !== "") {
        console.error(`Staged next key fingerprint: ${nextFingerprint}`);
    }
    console.error("The staged next HMAC key was preserved. Do not deploy a failed rotation build; rerun npm run release:rotate-hmac or abort explicitly.");
    process.exitCode = 1;
}

function runBuildRelease() {
    const result = spawnSync(process.execPath, ["scripts/build-release.mjs", "--target=full", "--key-source=next"], {
        cwd: rootDir,
        stdio: "inherit",
        windowsHide: true
    });
    if (result.status !== 0 || result.error) {
        throw result.error ?? new Error("HMAC rotation candidate release build failed.");
    }
}
