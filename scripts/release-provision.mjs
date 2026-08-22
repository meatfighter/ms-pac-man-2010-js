import { spawnSync } from "node:child_process";
import { checkActiveHmacKey, createNewActiveKey } from "./hmac-config.mjs";
import { assertGitWorkingTreeClean, rootDir } from "./build-utils.mjs";

let activeFingerprint = "";
try {
    assertGitWorkingTreeClean();
    const active = createNewActiveKey();
    activeFingerprint = active.fingerprint;
    await checkActiveHmacKey();
    console.log(`Created active HMAC key fingerprint: ${activeFingerprint}`);
    runBuildRelease();
    console.log(`Provisioned release with active key fingerprint: ${activeFingerprint}`);
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    if (activeFingerprint !== "") {
        console.error(`Active key fingerprint: ${activeFingerprint}`);
    }
    console.error("The active HMAC key was preserved. Do not deploy a failed provision build; rerun npm run build after correcting the failure.");
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
