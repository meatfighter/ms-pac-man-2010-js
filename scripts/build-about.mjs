import { copyDirectory, distDir, ensureDirectory, readVersion, releaseComponentsDir, renderTemplate, rootDir } from "./build-utils.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const version = readVersion();
const explicitDistDir = process.env.MSPACMAN_INTERNAL_DIST_DIR !== undefined && process.env.MSPACMAN_INTERNAL_DIST_DIR !== "";
const outputDir = explicitDistDir ? distDir : join(releaseComponentsDir, "about");
const cacheBust = process.env.MSPACMAN_CACHE_VERSION ?? `${version.version}-${version.buildStamp}-unsigned`;
const encodedBuildStamp = encodeURIComponent(version.buildStamp);
const encodedCacheBust = encodeURIComponent(cacheBust);
const replacements = {
    __APP_VERSION__: version.version,
    __BUILD_STAMP__: version.buildStamp,
    __BUILD_STAMP_ENCODED__: encodedBuildStamp,
    __DESKTOP_ZIP__: `downloads/ms-pac-man-2010-desktop.zip?v=${encodedBuildStamp}`,
    __PWA_URL__: `pwa/?v=${encodedCacheBust}`,
    __SOURCE_ZIP__: `downloads/ms-pac-man-2010-js-source.zip?v=${encodedBuildStamp}`
};

const aboutDir = join(rootDir, "about");

ensureDirectory(outputDir);
writeFileSync(join(outputDir, "index.html"), renderTemplate(readFileSync(join(aboutDir, "index.html"), "utf8"), replacements));
writeFileSync(join(outputDir, "styles.css"), renderTemplate(readFileSync(join(aboutDir, "styles.css"), "utf8"), replacements));
copyDirectory(join(aboutDir, "assets"), join(outputDir, "assets"));
console.log(`Built about page in ${outputDir}`);
