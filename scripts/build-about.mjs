import { generateAboutImageAssets, titleImageHeight, titleImageSizes, titleImageWidth } from "./about-image-assets.mjs";
import { renderAboutMarkdown } from "./about-markdown.mjs";
import {
    assertSafeReleaseMutationPath,
    cleanDirectory,
    copyDirectory,
    distDir,
    ensureDirectory,
    readBuildVersion,
    releaseComponentsDir,
    renderTemplate,
    rootDir
} from "./build-utils.mjs";
import { writeTextFileAtomically } from "./release-io.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { acquireReleaseLock } from "./release-lock.mjs";

const releaseLock = acquireReleaseLock("build:about");
const version = readBuildVersion();
const explicitDistDir = process.env.MSPACMAN_INTERNAL_DIST_DIR !== undefined && process.env.MSPACMAN_INTERNAL_DIST_DIR !== "";
const outputDir = explicitDistDir ? distDir : join(releaseComponentsDir, "about");
const canonicalUrl = "https://meatfighter.com/mspacman2010/";
const description =
    "Play Ms. Pac-Man 2010 in the browser and read about its Java origins, TypeScript rewrite, controls, high-score system, and desktop ZIP download.";
const cacheBust = process.env.MSPACMAN_CACHE_VERSION ?? `${version.version}-${version.buildStamp}-unsigned`;
const encodedBuildStamp = encodeURIComponent(version.buildStamp);
const encodedCacheBust = encodeURIComponent(cacheBust);
const aboutDir = join(rootDir, "about");
const replacements = {
    __APP_VERSION__: version.version,
    __BUILD_STAMP__: version.buildStamp,
    __BUILD_STAMP_ENCODED__: encodedBuildStamp,
    __CANONICAL_URL__: canonicalUrl,
    __DESCRIPTION__: description,
    __DESKTOP_ZIP__: `downloads/ms-pac-man-2010-desktop.zip?v=${encodedBuildStamp}`,
    __PWA_URL__: `pwa/?v=${encodedCacheBust}`,
    __SOCIAL_IMAGE_URL__: `${canonicalUrl}assets/ms-pac-man-2010-screenshot.png`,
    __SOURCE_ZIP__: `downloads/ms-pac-man-2010-js-source.zip?v=${encodedBuildStamp}`,
    __TITLE_IMAGE_HEIGHT__: titleImageHeight,
    __TITLE_IMAGE_SIZES__: titleImageSizes,
    __TITLE_IMAGE_WIDTH__: titleImageWidth,
    __TITLE_PNG_SRC__: `assets/title-750.png?v=${encodedBuildStamp}`,
    __TITLE_PNG_SRCSET__: `assets/title-750.png?v=${encodedBuildStamp} 750w, assets/title-1500.png?v=${encodedBuildStamp} 1500w`,
    __TITLE_WEBP_SRCSET__: `assets/title-750.webp?v=${encodedBuildStamp} 750w, assets/title-1500.webp?v=${encodedBuildStamp} 1500w`
};

function assertNoUnresolvedTokens(content, label) {
    const match = /__[A-Z][A-Z0-9_]*__/.exec(content);
    if (match !== null) {
        throw new Error(`${label} contains unresolved template token ${match[0]}.`);
    }
}

function renderCheckedTemplate(template, templateReplacements, label) {
    const output = renderTemplate(template, templateReplacements);
    assertNoUnresolvedTokens(output, label);
    return output;
}

try {
    assertSafeReleaseMutationPath(outputDir, "about page output");
    ensureDirectory(outputDir);

    const contentMarkdown = renderCheckedTemplate(readFileSync(join(aboutDir, "content.md"), "utf8"), replacements, "about Markdown content");
    const renderedMarkdown = renderAboutMarkdown(contentMarkdown);
    const pageReplacements = {
        ...replacements,
        __ARTICLE_HTML__: renderedMarkdown.articleHtml,
        __TOC_HTML__: renderedMarkdown.tocHtml
    };

    writeTextFileAtomically(
        join(outputDir, "index.html"),
        renderCheckedTemplate(readFileSync(join(aboutDir, "index.html"), "utf8"), pageReplacements, "about index page"),
        { mode: 0o644 }
    );
    writeTextFileAtomically(
        join(outputDir, "styles.css"),
        renderCheckedTemplate(readFileSync(join(aboutDir, "styles.css"), "utf8"), pageReplacements, "about stylesheet"),
        { mode: 0o644 }
    );
    writeTextFileAtomically(
        join(outputDir, "theme.js"),
        renderCheckedTemplate(readFileSync(join(aboutDir, "theme.js"), "utf8"), pageReplacements, "about script"),
        { mode: 0o644 }
    );
    cleanDirectory(join(outputDir, "assets"));
    copyDirectory(join(aboutDir, "assets"), join(outputDir, "assets"));
    await generateAboutImageAssets(join(aboutDir, "assets"), join(outputDir, "assets"), (path) =>
        assertSafeReleaseMutationPath(path, "about responsive title image output file")
    );
    console.log(`Built about page in ${outputDir}`);
} finally {
    releaseLock();
}
