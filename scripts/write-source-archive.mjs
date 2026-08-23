import { copyFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { distDir, ensureDirectory, readBuildVersion, rootDir, spawnGit } from "./build-utils.mjs";

const version = readBuildVersion();
const sourceCommit = process.env.MSPACMAN_RELEASE_GIT_COMMIT ?? "HEAD";
const downloadsDir = join(distDir, "downloads");
const archiveRootName = `ms-pac-man-2010-js-source-${version.version}`;
const versionedZipPath = join(downloadsDir, `${archiveRootName}.zip`);
const stableZipPath = join(downloadsDir, "ms-pac-man-2010-js-source.zip");

ensureDirectory(downloadsDir);
rmSync(versionedZipPath, { force: true });
rmSync(stableZipPath, { force: true });
spawnGit(["archive", "--format=zip", `--prefix=${archiveRootName}/`, `--output=${versionedZipPath}`, sourceCommit]);
copyFileSync(versionedZipPath, stableZipPath);
console.log(`Wrote ${relative(rootDir, stableZipPath)} from ${sourceCommit}`);
console.log(`Wrote ${relative(rootDir, versionedZipPath)} from ${sourceCommit}`);
