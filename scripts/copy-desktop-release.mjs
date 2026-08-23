import { existsSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import {
    assertSafeGeneratedDirectoryMutationPath,
    assertSafeGeneratedFileMutationPath,
    desktopTargetDir,
    readBuildVersion,
    releasesDir,
    rootDir
} from "./build-utils.mjs";
import { acquireReleaseLock } from "./release-lock.mjs";
import { assertNoLinkTraversal, copyFileAtomically } from "./release-io.mjs";

const releaseLock = acquireReleaseLock("copy-desktop-release");
const version = readBuildVersion();
const distributionName = "ms-pac-man-2010-desktop";
const sourceZip = join(desktopTargetDir, `${distributionName}-${version.version}.zip`);
const releaseZip = join(releasesDir, `${distributionName}-${version.version}.zip`);

try {
    assertNoLinkTraversal(sourceZip, desktopTargetDir, "desktop release source ZIP");
    assertSafeGeneratedDirectoryMutationPath(releasesDir, "desktop releases directory");
    assertSafeGeneratedFileMutationPath(releaseZip, "desktop release ZIP");

    if (!existsSync(sourceZip)) {
        throw new Error(`Missing desktop release zip: ${sourceZip}`);
    }

    mkdirSync(releasesDir, { recursive: true });
    copyFileAtomically(sourceZip, releaseZip);
    console.log(`Copied ${relative(rootDir, releaseZip)}`);
} finally {
    releaseLock();
}
