import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { desktopTargetDir, distDir, ensureDirectory, readBuildVersion } from "./build-utils.mjs";
import { assertNoLinkTraversal } from "./release-io.mjs";

const version = readBuildVersion();
const downloadsDir = join(distDir, "downloads");
const distributionName = "ms-pac-man-2010-desktop";
const sourceZip = join(desktopTargetDir, `${distributionName}-${version.version}.zip`);
const stableZip = join(downloadsDir, `${distributionName}.zip`);
const versionedZip = join(downloadsDir, `${distributionName}-${version.version}.zip`);

ensureDirectory(downloadsDir);
assertNoLinkTraversal(sourceZip, desktopTargetDir, "desktop release source ZIP");
copyFileSync(sourceZip, stableZip);
copyFileSync(sourceZip, versionedZip);
console.log(`Copied desktop downloads to ${downloadsDir}`);
