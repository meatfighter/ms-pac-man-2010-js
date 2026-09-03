import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const platformCandidates =
    process.platform === "win32"
        ? [
              join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
              join(process.env.PROGRAMFILES ?? "", "Google", "Chrome", "Application", "chrome.exe"),
              join(process.env["PROGRAMFILES(X86)"] ?? "", "Google", "Chrome", "Application", "chrome.exe"),
              join(process.env.PROGRAMFILES ?? "", "Microsoft", "Edge", "Application", "msedge.exe")
          ]
        : process.platform === "darwin"
          ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"]
          : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];

export async function findBrowser() {
    const candidates = [process.env.CHROMIUM_PATH, ...platformCandidates].filter((candidate) => typeof candidate === "string" && candidate.length > 0);
    for (const candidate of candidates) {
        try {
            await access(candidate);
            return candidate;
        } catch {
            // Continue to the next known browser location.
        }
    }
    throw new Error("Chrome/Chromium was not found. Set CHROMIUM_PATH to a Chrome, Chromium, or Edge executable.");
}

export function withTimeout(promise, milliseconds, message) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function waitForHttpServer(child, url, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (child?.exitCode !== null && child?.exitCode !== undefined) {
            throw new Error(`Browser-test server exited with code ${child.exitCode}.`);
        }
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
            if (response.ok) {
                return;
            }
        } catch {
            // Server may not be listening yet.
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    throw new Error(`Browser-test server did not start within ${timeoutMs} ms.`);
}

export async function launchBrowser(url, cwd, profilePrefix) {
    const browser = await findBrowser();
    const userDataDirectory = await mkdtemp(join(tmpdir(), profilePrefix));
    const stderrChunks = [];
    const child = spawn(
        browser,
        [
            "--headless=new",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu-sandbox",
            "--enable-webgl",
            "--use-gl=angle",
            "--use-angle=swiftshader-webgl",
            "--ignore-gpu-blocklist",
            "--enable-unsafe-swiftshader",
            "--remote-debugging-port=0",
            "--remote-allow-origins=*",
            `--user-data-dir=${userDataDirectory}`,
            "--no-first-run",
            "--no-default-browser-check",
            "--no-proxy-server",
            url
        ],
        { cwd, stdio: ["ignore", "ignore", "pipe"] }
    );
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => stderrChunks.push(String(chunk)));
    try {
        const debuggingPort = await waitForDevToolsActivePort(child, userDataDirectory);
        const pageWebSocketUrl = await findPageEndpoint(debuggingPort, url);
        const page = await connectCdp(pageWebSocketUrl);
        return { child, page, userDataDirectory, stderrChunks };
    } catch (error) {
        await stopChild(child);
        await removeBrowserProfile(userDataDirectory);
        const diagnostics = stderrChunks.join("").trim();
        throw new Error(`${error instanceof Error ? error.message : String(error)}${diagnostics ? `\nChromium diagnostics:\n${diagnostics}` : ""}`, {
            cause: error
        });
    }
}

export async function cleanupBrowser(browser) {
    if (browser === null) {
        return;
    }
    browser.page?.close();
    await stopChild(browser.child);
    await removeBrowserProfile(browser.userDataDirectory);
}

async function removeBrowserProfile(userDataDirectory) {
    await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

export async function stopChild(child) {
    if (child === null || child.exitCode !== null || child.signalCode !== null) {
        return;
    }
    const exitPromise = new Promise((resolveExit) => child.once("exit", resolveExit));
    child.kill("SIGTERM");
    try {
        await withTimeout(exitPromise, 2_000, "Process did not exit after SIGTERM.");
    } catch {
        if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
        }
        await withTimeout(exitPromise, 2_000, "Process did not exit after SIGKILL.");
    }
}

async function waitForDevToolsActivePort(child, userDataDirectory) {
    const activePortPath = join(userDataDirectory, "DevToolsActivePort");
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) {
            throw new Error(`Chromium exited before exposing DevTools (code=${child.exitCode}).`);
        }
        try {
            const text = await readFile(activePortPath, "utf8");
            const port = Number.parseInt(text.split(/\r?\n/, 1)[0], 10);
            if (Number.isInteger(port) && port > 0) {
                return port;
            }
        } catch {
            // Chrome creates the file once remote debugging is ready.
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    throw new Error("Chromium did not create DevToolsActivePort within 30 seconds.");
}

async function findPageEndpoint(debuggingPort, targetUrl) {
    const endpoint = `http://127.0.0.1:${debuggingPort}/json/list`;
    const targetPath = new URL(targetUrl).pathname;
    const deadline = Date.now() + 15_000;
    let lastTargets = [];
    while (Date.now() < deadline) {
        try {
            const response = await fetch(endpoint, { signal: AbortSignal.timeout(1_000) });
            if (response.ok) {
                lastTargets = await response.json();
                const page = lastTargets.find((target) => target.type === "page" && new URL(String(target.url)).pathname === targetPath);
                if (page?.webSocketDebuggerUrl) {
                    return page.webSocketDebuggerUrl;
                }
            }
        } catch {
            // DevTools can briefly reject requests while Chrome starts.
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    throw new Error(`Browser page did not expose a DevTools target. Targets: ${JSON.stringify(lastTargets)}`);
}

async function connectCdp(webSocketUrl) {
    const socket = new WebSocket(webSocketUrl);
    await withTimeout(
        new Promise((resolveOpen, rejectOpen) => {
            socket.addEventListener("open", resolveOpen, { once: true });
            socket.addEventListener("error", () => rejectOpen(new Error(`Could not connect to ${webSocketUrl}`)), { once: true });
        }),
        10_000,
        `Timed out connecting to ${webSocketUrl}`
    );

    let nextId = 1;
    const pending = new Map();
    socket.addEventListener("message", (event) => {
        let message;
        try {
            message = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8"));
        } catch (error) {
            for (const request of pending.values()) {
                request.reject(error);
            }
            pending.clear();
            return;
        }
        if (typeof message.id !== "number") {
            return;
        }
        const request = pending.get(message.id);
        if (!request) {
            return;
        }
        pending.delete(message.id);
        if (message.error) {
            request.reject(new Error(`${request.method}: ${message.error.message}`));
        } else {
            request.resolve(message.result);
        }
    });
    socket.addEventListener("close", () => {
        for (const request of pending.values()) {
            request.reject(new Error(`DevTools connection closed while calling ${request.method}`));
        }
        pending.clear();
    });

    return {
        call(method, params = {}) {
            const id = nextId++;
            return withTimeout(
                new Promise((resolveCall, rejectCall) => {
                    pending.set(id, { method, resolve: resolveCall, reject: rejectCall });
                    socket.send(JSON.stringify({ id, method, params }));
                }),
                10_000,
                `DevTools call ${method} did not complete within 10 seconds.`
            ).finally(() => pending.delete(id));
        },
        close() {
            socket.close();
        }
    };
}

export async function waitForExpression(page, expression, timeoutMs = 30_000) {
    await page.call("Runtime.enable");
    const deadline = Date.now() + timeoutMs;
    let lastResult = null;
    while (Date.now() < deadline) {
        const evaluation = await page.call("Runtime.evaluate", { expression, returnByValue: true });
        if (evaluation.exceptionDetails) {
            throw new Error(`Browser evaluation failed: ${JSON.stringify(evaluation.exceptionDetails)}`);
        }
        lastResult = evaluation.result?.value ?? null;
        if (lastResult) {
            return lastResult;
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    throw new Error(`Browser expression did not become truthy within ${timeoutMs} ms. Last result: ${JSON.stringify(lastResult)}`);
}
