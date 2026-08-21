import { spawnSync } from "node:child_process";
import {
    abortRotation,
    assertSecretAbsentFromTrackedFiles,
    checkActiveHmacKey,
    checkRotationKeys,
    prepareNextKey,
    readSelectedHmacKey
} from "./hmac-config.mjs";
import { rootDir } from "./build-utils.mjs";

let nextCreated = false;
try {
    const activeFingerprint = await checkActiveHmacKey();
    const nextFingerprint = prepareNextKey();
    nextCreated = true;
    const nextKey = readSelectedHmacKey("next");
    await assertSecretAbsentFromTrackedFiles(nextKey);
    checkRotationKeys();

    console.log(`Active key fingerprint: ${activeFingerprint}`);
    console.log(`Next key fingerprint: ${nextFingerprint}`);
    runBuildRelease();
    console.log(`Verified candidate release with active key fingerprint: ${activeFingerprint}`);
    console.log(`Verified candidate release with next key fingerprint: ${nextFingerprint}`);
} catch (error) {
    if (nextCreated) {
        abortRotation();
    }
    console.error(error instanceof Error ? error.message : String(error));
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
