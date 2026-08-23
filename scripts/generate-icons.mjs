import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { acquireReleaseLock } from "./release-lock.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseLock = acquireReleaseLock("generate:icons");
const sourcePath = join(rootDir, "assets", "icons", "ms-pac-man.svg");
const ARTWORK_RATIO = 1;
const squareSvgTargets = ["pwa/public/icon.svg", "pwa/public/favicon.svg", "about/assets/favicon.svg"];
const pngTargets = [
    { path: "pwa/public/favicon-16.png", size: 16 },
    { path: "pwa/public/favicon-32.png", size: 32 },
    { path: "pwa/public/favicon.png", size: 32 },
    { path: "pwa/public/apple-touch-icon.png", size: 180 },
    { path: "pwa/public/icon-192.png", size: 192 },
    { path: "pwa/public/icon-512.png", size: 512 },
    { path: "about/assets/favicon-16.png", size: 16 },
    { path: "about/assets/favicon-32.png", size: 32 },
    { path: "about/assets/favicon.png", size: 32 },
    { path: "about/assets/apple-touch-icon.png", size: 180 },
    { path: "desktop/src/favicon-16.png", size: 16 },
    { path: "desktop/src/favicon-32.png", size: 32 },
    { path: "desktop/src/favicon.png", size: 32 }
];

try {
    const sourceSvg = await readFile(sourcePath, "utf8");
    const squareSvg = createSquareSvg(sourceSvg, 512);

    for (const target of squareSvgTargets) {
        await writeText(target, squareSvg);
    }

    for (const target of pngTargets) {
        await writePng(target.path, createSquareSvg(sourceSvg, target.size), target.size);
    }

    console.log(`Generated ${squareSvgTargets.length + pngTargets.length} icon asset(s).`);
} finally {
    releaseLock();
}

function createSquareSvg(source, size) {
    const viewBox = parseViewBox(source);
    const body = extractSvgBody(source);
    const maxDimension = Math.max(viewBox.width, viewBox.height);
    const scale = (size * ARTWORK_RATIO) / maxDimension;
    const renderedWidth = viewBox.width * scale;
    const renderedHeight = viewBox.height * scale;
    const x = (size - renderedWidth) / 2;
    const y = (size - renderedHeight) / 2;

    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
        `    <svg x="${formatNumber(x)}" y="${formatNumber(y)}" width="${formatNumber(renderedWidth)}" height="${formatNumber(renderedHeight)}" viewBox="${viewBox.raw}">`,
        indent(body.trim(), 8),
        "    </svg>",
        "</svg>",
        ""
    ].join("\n");
}

function parseViewBox(source) {
    const match = /\bviewBox="([^"]+)"/.exec(source);
    if (!match) {
        throw new Error("Source SVG is missing a viewBox.");
    }

    const parts = match[1]
        .trim()
        .split(/\s+/)
        .map((part) => Number(part));
    if (parts.length !== 4 || !parts.every((part) => Number.isFinite(part)) || parts[2] <= 0 || parts[3] <= 0) {
        throw new Error(`Source SVG has an invalid viewBox: ${match[1]}`);
    }

    return {
        raw: match[1],
        width: parts[2],
        height: parts[3]
    };
}

function extractSvgBody(source) {
    const match = /<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/.exec(source.trim());
    if (!match) {
        throw new Error("Unable to extract source SVG body.");
    }
    return match[1];
}

function indent(text, spaces) {
    const prefix = " ".repeat(spaces);
    return text
        .split(/\r?\n/)
        .map((line) => `${prefix}${line}`)
        .join("\n");
}

function formatNumber(value) {
    return Number(value.toFixed(3)).toString();
}

async function writeText(relativePath, text) {
    const target = join(rootDir, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text, "utf8");
}

async function writePng(relativePath, svg, size) {
    const target = join(rootDir, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(target);
}
