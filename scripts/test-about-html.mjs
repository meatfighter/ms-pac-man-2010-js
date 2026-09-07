import assert from "node:assert/strict";
import { test } from "node:test";
import { assertAboutHeadingHierarchy, assertAboutHtmlConformance, finalizeAboutPageHtml, prepareAboutArticleHtml } from "./about-html.mjs";

function validPage() {
    return `<!doctype html>
<html>
<head><meta charset="UTF-8" /></head>
<body>
<h1>Game</h1>
<a href="#about">About</a>
<article>
<h2 id="about">About</h2>
<picture>
<source srcset="title.webp 750w" sizes="100vw" />
<img src="title.png" srcset="title.png 750w" sizes="100vw" alt="" />
</picture>
</article>
<svg viewBox="0 0 1 1"><path d="M0 0" /></svg>
</body>
</html>`;
}

test("About article headings are embedded beneath the page title without changing TOC source levels", () => {
    const renderedMarkdown = {
        articleHtml: '<h1 id="about">About</h1><h2 id="details">Details</h2>',
        headings: [
            { level: 1, text: "About", slug: "about" },
            { level: 2, text: "Details", slug: "details" }
        ]
    };

    const articleHtml = prepareAboutArticleHtml(renderedMarkdown);
    assert.match(articleHtml, /<h2 id="about">About<\/h2>/);
    assert.match(articleHtml, /<h3 id="details">Details<\/h3>/);
    assert.deepEqual(
        renderedMarkdown.headings.map((heading) => heading.level),
        [1, 2]
    );
});

test("About Markdown heading hierarchy rejects skipped or unembeddable levels", () => {
    assert.throws(() => assertAboutHeadingHierarchy([{ level: 1 }, { level: 3 }]), /heading level jumps from 1 to 3/);
    assert.throws(() => assertAboutHeadingHierarchy([{ level: 6 }]), /cannot be embedded beneath the page title/);
});

test("About HTML finalization uses HTML5 void syntax while preserving SVG self-closing elements", () => {
    const html = finalizeAboutPageHtml(validPage());
    assert.match(html, /<meta charset="UTF-8">/);
    assert.match(html, /<source srcset="title\.webp 750w" sizes="100vw">/);
    assert.match(html, /<img src="title\.png" srcset="title\.png 750w" sizes="100vw" alt="">/);
    assert.match(html, /<path d="M0 0" \/>/);
    assert.doesNotMatch(html, /<(?:meta|source|img)\b[^>]*\/>/i);
});

test("About HTML conformance rejects structural and responsive-image mistakes", () => {
    const html = finalizeAboutPageHtml(validPage());

    assert.throws(() => assertAboutHtmlConformance(html.replace('srcset="title.png 750w" ', "")), /img uses sizes without/);
    assert.throws(() => assertAboutHtmlConformance(html.replace('srcset="title.webp 750w" ', "")), /source uses sizes without/);
    assert.throws(() => assertAboutHtmlConformance(html.replace(' alt=""', "")), /img is missing an alt/);
    assert.throws(() => assertAboutHtmlConformance(html.replace("<article>", '<article id="about">')), /duplicate id 'about'/);
    assert.throws(() => assertAboutHtmlConformance(html.replace('href="#about"', 'href="#missing"')), /does not resolve to an id/);
    assert.throws(() => assertAboutHtmlConformance(html.replace("</body>", "<div>__TOKEN__</div></body>")), /unresolved template token/);
    assert.throws(() => assertAboutHtmlConformance(html.replace("<article>", "<h1>Extra</h1><article>")), /exactly one h1/);
});
