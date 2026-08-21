import { copyDirectory, distDir, ensureDirectory, readVersion, renderTemplate, rootDir } from "./build-utils.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const version = readVersion();
const cacheBust = process.env.MSPACMAN_CACHE_VERSION ?? `${version.version}-${version.buildStamp}-unsigned`;
const encodedBuildStamp = encodeURIComponent(version.buildStamp);
const encodedCacheBust = encodeURIComponent(cacheBust);
const replacements = {
    __APP_VERSION__: version.version,
    __BUILD_STAMP__: version.buildStamp,
    __BUILD_STAMP_ENCODED__: encodedBuildStamp,
    __DESKTOP_ZIP__: `downloads/ms-pac-man-2010-desktop.zip?v=${encodedBuildStamp}`,
    __PWA_URL__: `pwa/?v=${encodedCacheBust}`
};

const aboutDir = join(rootDir, "about");

ensureDirectory(distDir);
writeFileSync(join(distDir, "index.html"), renderTemplate(readFileSync(join(aboutDir, "index.html"), "utf8"), replacements));
writeFileSync(join(distDir, "styles.css"), renderTemplate(readFileSync(join(aboutDir, "styles.css"), "utf8"), replacements));
copyDirectory(join(aboutDir, "assets"), join(distDir, "assets"));
console.log("Built about page");
