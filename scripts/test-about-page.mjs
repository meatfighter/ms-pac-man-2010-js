import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { generateAboutImageAssets, titleImageHeight, titleImageSizes, titleImageWidth } from "./about-image-assets.mjs";
import { renderAboutMarkdown } from "./about-markdown.mjs";
import { rootDir } from "./build-utils.mjs";

sharp.cache(false);

const aboutDir = join(rootDir, "about");
const contentMarkdown = readFileSync(join(aboutDir, "content.md"), "utf8");
const indexTemplate = readFileSync(join(aboutDir, "index.html"), "utf8");
const styles = readFileSync(join(aboutDir, "styles.css"), "utf8");
const themeScript = readFileSync(join(aboutDir, "theme.js"), "utf8");
const buildAboutSource = readFileSync(new URL("./build-about.mjs", import.meta.url), "utf8");

await runTest("about Markdown content is the user-facing source of truth", () => {
    assert.match(contentMarkdown, /\[Play\]\(__PWA_URL__\)/);
    assert.match(contentMarkdown, /\[source ZIP\]\(__SOURCE_ZIP__\)/);
    assert.match(contentMarkdown, /\[desktop ZIP\]\(__DESKTOP_ZIP__\)/);
    assert.match(contentMarkdown, /Windows: `run-windows\.cmd`/);
    assert.match(contentMarkdown, /Linux: `run-linux\.sh`/);
    assert.match(contentMarkdown, /macOS: `run-macos\.sh`/);
    assert.match(contentMarkdown, /Java 21 or newer is required\./);
    assert.doesNotMatch(contentMarkdown, /\*\*\[Play\]\*\*/);
    assert.doesNotMatch(contentMarkdown, /\*\*\[here\]\*\*/);
    assert.doesNotMatch(contentMarkdown, /\bTODO\b/i);
    assert.doesNotMatch(contentMarkdown, /executable JAR/i);
    assert.doesNotMatch(contentMarkdown, /â/);
});

await runTest("about Markdown renderer creates expected article features", () => {
    const rendered = renderAboutMarkdown(
        contentMarkdown
            .replaceAll("__PWA_URL__", "pwa/?v=test-build")
            .replaceAll("__SOURCE_ZIP__", "downloads/ms-pac-man-2010-js-source.zip?v=test-build")
            .replaceAll("__DESKTOP_ZIP__", "downloads/ms-pac-man-2010-desktop.zip?v=test-build")
    );

    assert.match(rendered.articleHtml, /<h1 id="about">/);
    assert.match(rendered.articleHtml, /<a class="heading-link" href="#controls">Controls<\/a>/);
    assert.match(rendered.articleHtml, /<button class="copy-link" type="button" data-copy-url="#controls"/);
    assert.match(rendered.articleHtml, /class="play-button" href="pwa\/\?v=test-build"/);
    assert.doesNotMatch(rendered.articleHtml, /class="play-button"[^>]+target="_blank"/);
    assert.match(rendered.articleHtml, /<div class="table-wrap"><table>/);
    assert.match(rendered.articleHtml, /href="https:\/\/jinput\.github\.io\/jinput\/" target="_blank" rel="noopener noreferrer"/);
    assert.match(rendered.articleHtml, /href="downloads\/ms-pac-man-2010-desktop\.zip\?v=test-build" download="ms-pac-man-2010-desktop\.zip"/);
    assert.match(rendered.articleHtml, /href="downloads\/ms-pac-man-2010-js-source\.zip\?v=test-build" download="ms-pac-man-2010-js-source\.zip"/);
    assert.doesNotMatch(rendered.articleHtml, /downloads\/ms-pac-man-2010-desktop\.zip\?v=test-build" target="_blank"/);
    assert.ok(rendered.headings.some((heading) => heading.slug === "browser-menu" && heading.level === 2));
    assert.match(rendered.tocHtml, /<nav class="toc" aria-labelledby="toc-heading">/);
    assert.match(rendered.tocHtml, /<h2 id="toc-heading">Contents<\/h2>/);
    assert.match(rendered.tocHtml, /<li class="toc-level-1"><a href="#about">About<\/a><\/li>/);
    assert.match(rendered.tocHtml, /<li class="toc-level-2"><a href="#browser-menu">Browser Menu<\/a><\/li>/);
    assert.match(rendered.tocHtml, /<li class="toc-level-1"><a href="#acknowledgements">Acknowledgements<\/a><\/li>/);
    assert.doesNotMatch(rendered.tocHtml, /class="toc-level-3"/);
});

await runTest("about page shell carries SEO, theme, footer, and generated-content placeholders", () => {
    assert.match(indexTemplate, /<link rel="canonical" href="__CANONICAL_URL__" \/>/);
    assert.match(indexTemplate, /<meta property="og:image" content="__SOCIAL_IMAGE_URL__" \/>/);
    assert.match(indexTemplate, /<meta name="twitter:card" content="summary_large_image" \/>/);
    assert.match(indexTemplate, /<title>Ms\. Pac-Man 2010<\/title>/);
    assert.match(indexTemplate, /<picture class="site-logo-picture">/);
    assert.match(indexTemplate, /type="image\/webp"/);
    assert.match(indexTemplate, /srcset=".\/__TITLE_WEBP_SRCSET__"/);
    assert.match(indexTemplate, /src=".\/__TITLE_PNG_SRC__"/);
    assert.match(indexTemplate, /srcset=".\/__TITLE_PNG_SRCSET__"/);
    assert.match(indexTemplate, /sizes="__TITLE_IMAGE_SIZES__"/);
    assert.match(indexTemplate, /width="__TITLE_IMAGE_WIDTH__"/);
    assert.match(indexTemplate, /height="__TITLE_IMAGE_HEIGHT__"/);
    assert.match(indexTemplate, /__TOC_HTML__/);
    assert.match(indexTemplate, /__ARTICLE_HTML__/);
    assert.match(indexTemplate, /ms-pac-man-2010-about-theme/);
    assert.match(indexTemplate, /href="__SOURCE_ZIP__" download="ms-pac-man-2010-js-source\.zip">Source<\/a>/);
    assert.match(indexTemplate, /<a href="https:\/\/meatfighter\.com\/">Home<\/a>/);
    assert.match(indexTemplate, /https:\/\/creativecommons\.org\/licenses\/by-sa\/4\.0\/\?ref=chooser-v1/);
    assert.match(indexTemplate, /<script src=".\/theme\.js\?v=__BUILD_STAMP_ENCODED__"><\/script>/);
    assert.match(styles, /SourceSans3VF-Upright\.ttf\.woff2\?v=__BUILD_STAMP_ENCODED__/);
    assert.match(styles, /SourceSans3VF-Italic\.ttf\.woff2\?v=__BUILD_STAMP_ENCODED__/);
    assert.match(styles, /--bg: #f7f8fa;/);
    assert.match(styles, /--bg: #111419;/);
    assert.match(styles, /--text: #161b22;/);
    assert.match(styles, /--text: #f3f5f7;/);
    assert.match(styles, /--link: #fd47b9;/);
    assert.match(styles, /--measure: 750px;/);
    assert.match(styles, /--switch-knob: var\(--pac-yellow\);/);
    assert.match(styles, /--play-button-bg: var\(--pac-pink\);/);
    assert.match(styles, /--play-button-bg: var\(--pac-yellow\);/);
    assert.match(styles, /--play-button-text: var\(--bg\);/);
    assert.match(styles, /\.toc \{\s+margin: 0 0 2rem;/);
    assert.match(styles, /\.toc li:not\(:last-child\)::after \{\s+color: var\(--muted\);\s+content: " \| ";/);
    assert.doesNotMatch(styles, /\.toc \.toc-level-2 a\s*\{/);
    assert.match(styles, /\.play-button/);
    assert.match(themeScript, /ms-pac-man-2010-about-theme/);
});

await runTest("about build uses constrained Markdown and generated responsive images", () => {
    assert.match(buildAboutSource, /content\.md/);
    assert.match(buildAboutSource, /renderAboutMarkdown/);
    assert.match(buildAboutSource, /__TOC_HTML__/);
    assert.match(buildAboutSource, /generateAboutImageAssets/);
    assert.match(buildAboutSource, /__TITLE_WEBP_SRCSET__/);
    assert.match(buildAboutSource, /https:\/\/meatfighter\.com\/mspacman2010\//);
    assert.doesNotMatch(buildAboutSource, /__SOURCE_URL__/);
});

await runTest("about title, screenshot, and font assets live with the about page source", () => {
    assert.equal(existsSync(join(aboutDir, "assets", "title.png")), true);
    assert.equal(existsSync(join(aboutDir, "assets", "ms-pac-man-2010-screenshot.png")), true);
    assert.equal(existsSync(join(aboutDir, "assets", "fonts", "source-sans-3", "SourceSans3VF-Upright.ttf.woff2")), true);
    assert.equal(existsSync(join(aboutDir, "assets", "fonts", "source-sans-3", "SourceSans3VF-Italic.ttf.woff2")), true);
    assert.equal(existsSync(join(aboutDir, "assets", "fonts", "source-sans-3", "LICENSE.md")), true);
    assert.equal(existsSync(join(rootDir, "about.md")), false);
    assert.equal(existsSync(join(rootDir, "title.png")), false);
    assert.equal(existsSync(join(rootDir, "ms-pac-man-2010-screenshot.png")), false);
});

await runTest("about responsive title images are generated with expected dimensions", async () => {
    const temporaryOutputRoot = join(rootDir, ".release-components");
    mkdirSync(temporaryOutputRoot, { recursive: true });
    const temporaryOutputDir = mkdtempSync(join(temporaryOutputRoot, "about-images-test-"));
    try {
        await generateAboutImageAssets(join(aboutDir, "assets"), temporaryOutputDir);

        assert.equal(titleImageWidth, 750);
        assert.equal(titleImageHeight, 271);
        assert.equal(titleImageSizes, "min(750px, calc(100vw - 2rem))");

        const expectedDimensions = new Map([
            ["title-750.png", { width: 750, height: 271 }],
            ["title-1500.png", { width: 1500, height: 541 }],
            ["title-750.webp", { width: 750, height: 271 }],
            ["title-1500.webp", { width: 1500, height: 541 }]
        ]);

        for (const [fileName, expected] of expectedDimensions) {
            const outputPath = join(temporaryOutputDir, fileName);
            assert.equal(existsSync(outputPath), true);
            const metadata = await sharp(readFileSync(outputPath)).metadata();
            assert.equal(metadata.width, expected.width);
            assert.equal(metadata.height, expected.height);
        }
    } finally {
        await removeDirectoryWithRetry(temporaryOutputDir);
    }
});

async function runTest(name, fn) {
    try {
        await fn();
        console.log(`ok - ${name}`);
    } catch (error) {
        console.error(`not ok - ${name}`);
        console.error(error);
        process.exitCode = 1;
    }
}

async function removeDirectoryWithRetry(path) {
    let lastError = null;
    for (let attempt = 0; attempt < 10; attempt++) {
        try {
            rmSync(path, { recursive: true, force: true });
            return;
        } catch (error) {
            lastError = error;
            await delay(100);
        }
    }
    throw lastError;
}

function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
