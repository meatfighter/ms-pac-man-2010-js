const htmlVoidElements = ["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"];
const htmlVoidElementNames = htmlVoidElements.join("|");

function attributeValue(tag, name) {
    const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
    if (match === null) {
        return null;
    }
    return match[1] ?? match[2] ?? match[3] ?? "";
}

function htmlTags(html) {
    return html.match(/<[a-z][^>]*>/gi) ?? [];
}

export function assertAboutHeadingHierarchy(headings) {
    if (!Array.isArray(headings) || headings.length === 0) {
        throw new Error("About Markdown must contain at least one heading.");
    }

    let previousLevel = 0;
    for (const heading of headings) {
        const level = heading?.level;
        if (!Number.isInteger(level) || level < 1 || level > 5) {
            throw new Error(`About Markdown heading level ${String(level)} cannot be embedded beneath the page title.`);
        }
        if (previousLevel === 0 && level !== 1) {
            throw new Error("About Markdown must begin with a level-1 heading.");
        }
        if (previousLevel > 0 && level > previousLevel + 1) {
            throw new Error(`About Markdown heading level jumps from ${previousLevel} to ${level}.`);
        }
        previousLevel = level;
    }
}

export function offsetAboutArticleHeadings(articleHtml, offset = 1) {
    if (!Number.isInteger(offset) || offset < 0) {
        throw new Error(`Invalid About heading offset: ${String(offset)}.`);
    }

    return articleHtml.replace(/<(\/?)h([1-6])(\b[^>]*)>/gi, (_match, closingSlash, rawLevel, suffix) => {
        const level = Number(rawLevel) + offset;
        if (level > 6) {
            throw new Error(`About Markdown heading level ${rawLevel} cannot be offset by ${offset}.`);
        }
        return `<${closingSlash}h${level}${suffix}>`;
    });
}

export function prepareAboutArticleHtml(renderedMarkdown) {
    assertAboutHeadingHierarchy(renderedMarkdown?.headings);
    return offsetAboutArticleHeadings(renderedMarkdown.articleHtml, 1);
}

export function normalizeHtml5VoidElements(html) {
    const pattern = new RegExp(`<(${htmlVoidElementNames})\\b([^<>]*?)\\s*/>`, "gi");
    return html.replace(pattern, (_match, elementName, attributes) => `<${elementName}${attributes}>`);
}

export function assertAboutHtmlConformance(html) {
    if (/__[A-Z][A-Z0-9_]*__/.test(html)) {
        throw new Error("About page contains an unresolved template token.");
    }

    const selfClosingVoidPattern = new RegExp(`<(?:${htmlVoidElementNames})\\b[^<>]*?/>`, "i");
    if (selfClosingVoidPattern.test(html)) {
        throw new Error("About page contains XHTML-style self-closing syntax on an HTML void element.");
    }

    const tags = htmlTags(html);
    const h1Count = tags.filter((tag) => /^<h1\b/i.test(tag)).length;
    if (h1Count !== 1) {
        throw new Error(`About page must contain exactly one h1; found ${h1Count}.`);
    }

    const articleMatch = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html);
    if (articleMatch === null) {
        throw new Error("About page must contain an article element.");
    }
    if (/<h1\b/i.test(articleMatch[1])) {
        throw new Error("About article must not contain an h1 beneath the page title.");
    }

    const ids = new Set();
    for (const tag of tags) {
        const id = attributeValue(tag, "id");
        if (id === null) {
            continue;
        }
        if (ids.has(id)) {
            throw new Error(`About page contains duplicate id '${id}'.`);
        }
        ids.add(id);
    }

    for (const tag of tags.filter((candidate) => /^<a\b/i.test(candidate))) {
        const href = attributeValue(tag, "href");
        if (href?.startsWith("#") && href.length > 1 && !ids.has(href.slice(1))) {
            throw new Error(`About page fragment link '${href}' does not resolve to an id.`);
        }
    }

    for (const tag of tags.filter((candidate) => /^<img\b/i.test(candidate))) {
        const alt = attributeValue(tag, "alt");
        const src = attributeValue(tag, "src");
        const srcset = attributeValue(tag, "srcset");
        const sizes = attributeValue(tag, "sizes");

        if (alt === null) {
            throw new Error("About page img is missing an alt attribute.");
        }
        if (src === null || src.trim() === "") {
            throw new Error("About page img is missing a non-empty src attribute.");
        }
        if (srcset !== null && srcset.trim() === "") {
            throw new Error("About page img has an empty srcset attribute.");
        }
        if (sizes !== null) {
            if (sizes.trim() === "") {
                throw new Error("About page img has an empty sizes attribute.");
            }
            if (srcset === null || srcset.trim() === "") {
                throw new Error("About page img uses sizes without a non-empty srcset attribute.");
            }
        }
    }

    for (const tag of tags.filter((candidate) => /^<source\b/i.test(candidate))) {
        const srcset = attributeValue(tag, "srcset");
        const sizes = attributeValue(tag, "sizes");
        if (srcset !== null && srcset.trim() === "") {
            throw new Error("About page source has an empty srcset attribute.");
        }
        if (sizes !== null) {
            if (sizes.trim() === "") {
                throw new Error("About page source has an empty sizes attribute.");
            }
            if (srcset === null || srcset.trim() === "") {
                throw new Error("About page source uses sizes without a non-empty srcset attribute.");
            }
        }
    }
}

export function finalizeAboutPageHtml(html) {
    const normalized = normalizeHtml5VoidElements(html);
    assertAboutHtmlConformance(normalized);
    return normalized;
}
