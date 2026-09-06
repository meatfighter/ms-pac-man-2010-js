import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { cleanupBrowser, launchBrowser, waitForExpression } from "./browser-test-utils.mjs";
import { distDir } from "./build-utils.mjs";

const root = resolve(process.env.MSPACMAN_VERIFY_PWA_ROOT ?? join(distDir, "pwa"));
if (!existsSync(join(root, "index.html"))) {
    throw new Error(`Built PWA is missing at ${root}. Run the full release build or set MSPACMAN_VERIFY_PWA_ROOT before verify:offline.`);
}
const port = 5200;
const baseUrl = `http://127.0.0.1:${port}/`;
const mime = {
    ".css": "text/css",
    ".html": "text/html",
    ".js": "text/javascript",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ogg": "audio/ogg",
    ".dat": "application/octet-stream",
    ".def": "text/plain",
    ".txt": "text/plain"
};
const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", baseUrl);
    const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    const path = resolve(root, normalize(requested));
    if (path !== root && !path.startsWith(`${root}/`) && !path.startsWith(`${root}\\`)) {
        response.writeHead(403).end();
        return;
    }
    if (!existsSync(path) || !statSync(path).isFile()) {
        response.writeHead(404).end();
        return;
    }
    response.writeHead(200, { "Content-Type": mime[extname(path)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    createReadStream(path).pipe(response);
});
await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, "127.0.0.1", resolveListen);
});

let browser = null;
try {
    browser = await launchBrowser(baseUrl, process.cwd(), "ms-pac-man-2010-offline-");
    await waitForExpression(
        browser.page,
        'window.__msPacManBooted === true && navigator.serviceWorker?.controller !== null && document.querySelector("#newGameButton") !== null',
        45_000
    );
    await browser.page.call("Page.enable");
    await browser.page.call("Page.reload", { ignoreCache: true });
    await waitForExpression(browser.page, "window.__gameResourcesPrepared === true", 120_000);
    await browser.page.call("Network.enable");
    await browser.page.call("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await browser.page.call("Page.enable");
    await browser.page.call("Page.reload", { ignoreCache: true });
    await waitForExpression(
        browser.page,
        'window.__msPacManBooted === true && window.__msPacManResourcesPrepared === true && document.querySelector("#newGameButton") !== null',
        45_000
    );
    await browser.page.call("Runtime.evaluate", { expression: 'document.querySelector("#newGameButton").click()', userGesture: true });
    await waitForExpression(browser.page, 'document.querySelector("canvas") !== null', 30_000);
    console.log("Ms. Pac-Man 2010 production PWA prepared all resources and entered the game while offline.");
} catch (error) {
    if (browser !== null) {
        const diagnostics = await browser.page.call("Runtime.evaluate", {
            expression:
                "JSON.stringify({ text: document.body.innerText, booted: window.__msPacManBooted, prepared: window.__gameResourcesPrepared, controlled: navigator.serviceWorker.controller !== null })",
            returnByValue: true
        });
        console.error("Offline diagnostics:", diagnostics.result?.value);
    }
    throw error;
} finally {
    if (browser !== null) {
        try {
            await browser.page.call("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
        } catch {
            // Browser may already be shutting down.
        }
    }
    await cleanupBrowser(browser);
    await new Promise((resolveClose) => server.close(resolveClose));
}
