import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { distDir } from "./build-utils.mjs";

const host = readOption("host", "127.0.0.1");
const port = Number.parseInt(readOption("port", "4175"), 10);
const basePath = normalizeBasePath(readOption("base", "/ms-pac-man-2010-staging/"));

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("--port must be an integer from 1 through 65535.");
}
if (!existsSync(distDir)) {
    throw new Error("dist/ does not exist. Run npm run build before previewing a release artifact.");
}

const server = createServer((request, response) => {
    serveRequest(request.url ?? "/", response);
});

server.listen(port, host, () => {
    console.log(`Serving ${distDir}`);
    console.log(`Mounted at http://${host}:${port}${basePath}`);
});

function serveRequest(requestUrl, response) {
    let url;
    try {
        url = new URL(requestUrl, `http://${host}:${port}`);
    } catch {
        sendPlainText(response, 400, "Bad Request");
        return;
    }

    if (!url.pathname.startsWith(basePath)) {
        sendPlainText(response, 404, "Not Found");
        return;
    }

    const rawRelativePath = url.pathname.slice(basePath.length);
    if (/%2f|%5c/i.test(rawRelativePath)) {
        sendPlainText(response, 400, "Bad Request");
        return;
    }

    let relativePath;
    try {
        relativePath = decodeURIComponent(rawRelativePath);
    } catch {
        sendPlainText(response, 400, "Bad Request");
        return;
    }
    if (relativePath.includes("\0")) {
        sendPlainText(response, 400, "Bad Request");
        return;
    }

    if (relativePath === "" || relativePath.endsWith("/")) {
        relativePath = `${relativePath}index.html`;
    }

    const path = resolve(distDir, relativePath);
    if (!isInsideDist(path)) {
        sendPlainText(response, 403, "Forbidden");
        return;
    }

    if (!existsSync(path)) {
        sendPlainText(response, 404, "Not Found");
        return;
    }

    const stat = statSync(path);
    if (stat.isDirectory()) {
        serveRequest(`${url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`}index.html${url.search}`, response);
        return;
    }
    if (!stat.isFile()) {
        sendPlainText(response, 404, "Not Found");
        return;
    }

    response.statusCode = 200;
    response.setHeader("Content-Type", contentTypeFor(path));
    response.setHeader("Cache-Control", "no-store");
    createReadStream(path).pipe(response);
}

function isInsideDist(path) {
    const normalizedDist = resolve(distDir);
    const normalizedPath = resolve(path);
    const pathRelativeToDist = relative(normalizedDist, normalizedPath);
    return (
        pathRelativeToDist === "" ||
        (!pathRelativeToDist.startsWith("..") && !isAbsolute(pathRelativeToDist) && normalizedPath.startsWith(`${normalizedDist}${sep}`))
    );
}

function normalizeBasePath(value) {
    let normalized = value.trim();
    if (normalized === "") {
        normalized = "/";
    }
    if (!normalized.startsWith("/")) {
        normalized = `/${normalized}`;
    }
    if (!normalized.endsWith("/")) {
        normalized = `${normalized}/`;
    }
    return normalized;
}

function contentTypeFor(path) {
    switch (extname(path).toLowerCase()) {
        case ".css":
            return "text/css; charset=utf-8";
        case ".dat":
            return "application/octet-stream";
        case ".html":
            return "text/html; charset=utf-8";
        case ".jar":
            return "application/java-archive";
        case ".js":
            return "text/javascript; charset=utf-8";
        case ".json":
            return "application/json; charset=utf-8";
        case ".ogg":
            return "audio/ogg";
        case ".png":
            return "image/png";
        case ".svg":
            return "image/svg+xml; charset=utf-8";
        case ".txt":
            return "text/plain; charset=utf-8";
        case ".webmanifest":
            return "application/manifest+json; charset=utf-8";
        case ".zip":
            return "application/zip";
        default:
            return "application/octet-stream";
    }
}

function sendPlainText(response, statusCode, message) {
    response.statusCode = statusCode;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end(`${message}\n`);
}

function readOption(name, fallback) {
    const equalsPrefix = `--${name}=`;
    const equalsMatch = process.argv.find((arg) => arg.startsWith(equalsPrefix));
    if (equalsMatch !== undefined) {
        return equalsMatch.slice(equalsPrefix.length);
    }

    const optionIndex = process.argv.indexOf(`--${name}`);
    if (optionIndex >= 0 && process.argv[optionIndex + 1] !== undefined) {
        return process.argv[optionIndex + 1];
    }

    return fallback;
}
