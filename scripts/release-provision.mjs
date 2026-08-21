import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { abortRotation, checkActiveHmacKey, createNewActiveKey, getReleaseSecretPaths } from "./hmac-config.mjs";
import { rootDir } from "./build-utils.mjs";

let created = false;
try {
    const active = createNewActiveKey();
    created = true;
    await checkActiveHmacKey();
    console.log(`Created active HMAC key fingerprint: ${active.fingerprint}`);
    runBuildRelease();
    console.log(`Provisioned release with active key fingerprint: ${active.fingerprint}`);
} catch (error) {
    if (created) {
        removeActiveKey();
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}

function runBuildRelease() {
    const result = spawnSync(process.execPath, ["scripts/build-release.mjs", "--target=full", "--key-source=active"], {
        cwd: rootDir,
        stdio: "inherit",
        windowsHide: true
    });
    if (result.status !== 0 || result.error) {
        throw result.error ?? new Error("Provision release build failed.");
    }
}

function removeActiveKey() {
    rmSync(getReleaseSecretPaths().active, { force: true });
    abortRotation();
}
