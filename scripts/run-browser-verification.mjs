import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = 5199;
const url = `http://127.0.0.1:${port}/browser-verify.html`;
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
const candidates = [process.env.CHROMIUM_PATH, ...platformCandidates].filter((candidate) => typeof candidate === "string" && candidate.length > 0);

async function findBrowser() {
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

function withTimeout(promise, milliseconds, message) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function waitForServer(child) {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) {
            throw new Error(`Vite browser-verification server exited with code ${child.exitCode}.`);
        }
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
            if (response.ok) {
                return;
            }
        } catch {
            // Vite may not be listening yet.
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    throw new Error("Vite browser-verification server did not start within 20 seconds.");
}

async function waitForDevToolsPort(userDataDirectory, child) {
    const activePortPath = join(userDataDirectory, "DevToolsActivePort");
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) {
            throw new Error(`Chromium exited before exposing DevTools (code=${child.exitCode}).`);
        }
        try {
            const text = await readFile(activePortPath, "utf8");
            const [portText] = text.trim().split(/\r?\n/);
            const debuggingPort = Number(portText);
            if (Number.isInteger(debuggingPort) && debuggingPort > 0 && debuggingPort <= 65535) {
                return debuggingPort;
            }
        } catch {
            // Chrome writes DevToolsActivePort after the debugging listener is ready.
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    throw new Error("Chromium did not expose DevTools within 30 seconds.");
}

async function findPageEndpoint(debuggingPort) {
    const endpoint = `http://127.0.0.1:${debuggingPort}/json/list`;
    const deadline = Date.now() + 15_000;
    let lastTargets = [];
    while (Date.now() < deadline) {
        try {
            const response = await fetch(endpoint, { signal: AbortSignal.timeout(1_000) });
            if (response.ok) {
                lastTargets = await response.json();
                const page = lastTargets.find((target) => target.type === "page" && String(target.url).includes("browser-verify.html"));
                if (page?.webSocketDebuggerUrl) {
                    return page.webSocketDebuggerUrl;
                }
            }
        } catch {
            // DevTools can briefly reject requests while the browser starts.
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    throw new Error(`The Ms. Pac-Man browser page did not expose a DevTools target. Targets: ${JSON.stringify(lastTargets)}`);
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
            const text = typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8");
            message = JSON.parse(text);
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

async function waitForBrowserResult(page) {
    await page.call("Runtime.enable");
    const deadline = Date.now() + 30_000;
    let lastResult = null;
    while (Date.now() < deadline) {
        const evaluation = await page.call("Runtime.evaluate", {
            expression:
                '(() => { const element = document.querySelector("#result"); return { readyState: document.readyState, status: element?.dataset.status ?? "missing", text: element?.textContent ?? "" }; })()',
            returnByValue: true
        });
        if (evaluation.exceptionDetails) {
            throw new Error(`Browser result evaluation failed: ${JSON.stringify(evaluation.exceptionDetails)}`);
        }
        lastResult = evaluation.result?.value ?? null;
        if (lastResult?.status === "passed") {
            return lastResult.text;
        }
        if (lastResult?.status === "failed") {
            throw new Error(lastResult.text || "Browser verification reported failure.");
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    throw new Error(`Browser verification did not finish within 30 seconds. Last result: ${JSON.stringify(lastResult)}`);
}

async function stop(child) {
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

const viteBin = resolve(rootDir, "node_modules", "vite", "bin", "vite.js");
const server = spawn(process.execPath, [viteBin, "--config", "pwa/vite.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"]
});
let browserProcess = null;
let page = null;
let userDataDirectory = null;
const stderrChunks = [];

try {
    await waitForServer(server);
    const browser = await findBrowser();
    userDataDirectory = await mkdtemp(join(tmpdir(), "ms-pac-man-2010-browser-"));
    browserProcess = spawn(
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
        { cwd: rootDir, stdio: ["ignore", "ignore", "pipe"] }
    );
    browserProcess.stderr.setEncoding("utf8");
    browserProcess.stderr.on("data", (chunk) => stderrChunks.push(String(chunk)));
    const debuggingPort = await waitForDevToolsPort(userDataDirectory, browserProcess);
    const pageWebSocketUrl = await findPageEndpoint(debuggingPort);
    page = await connectCdp(pageWebSocketUrl);
    const output = await waitForBrowserResult(page);
    console.log(output);
} catch (error) {
    const diagnostics = stderrChunks.join("").trim();
    const suffix = diagnostics.length > 0 ? `\nChromium diagnostics:\n${diagnostics}` : "";
    throw new Error(`${error instanceof Error ? error.message : String(error)}${suffix}`, { cause: error });
} finally {
    page?.close();
    await stop(browserProcess);
    await stop(server);
    if (userDataDirectory !== null) {
        await rm(userDataDirectory, { recursive: true, force: true });
    }
}
