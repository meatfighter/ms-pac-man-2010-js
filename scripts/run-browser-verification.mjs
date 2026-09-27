import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { cleanupBrowser, findBrowser, launchBrowser, stopChild, waitForExpression, waitForHttpServer } from "./browser-test-utils.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = 5199;
const browserVerificationUrl = `http://127.0.0.1:${port}/browser-verify.html${process.env.PAC_BROWSER_SUITE === "counter-parity" ? "?suite=counter-parity" : ""}`;
const appUrl = `http://127.0.0.1:${port}/`;
const viteBin = resolve(rootDir, "node_modules", "vite", "bin", "vite.js");
const server = spawn(process.execPath, [viteBin, "--config", "pwa/vite.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"]
});
let browser = null;
try {
    await waitForHttpServer(server, browserVerificationUrl);
    browser = await launchBrowser(browserVerificationUrl, rootDir, "ms-pac-man-2010-browser-");
    // Each terminal arena uses committed native playback. Grant activation
    // through the browser gesture path, never by disabling autoplay policy.
    while (true) {
        const state = await waitForExpression(
            browser.page,
            `(() => {
            const result = document.querySelector("#result");
            if (result?.dataset.status === "failed") throw new Error(result.textContent);
            if (result?.dataset.status === "passed") return "done";
            return document.querySelector("#terminal-audio") ? "audio" : false;
        })()`,
            60_000
        );
        if (state === "done") break;
        await browser.page.call("Runtime.evaluate", {
            expression: 'document.querySelector("#terminal-audio").click()',
            userGesture: true
        });
    }
    const output = await waitForExpression(
        browser.page,
        '(() => { const element = document.querySelector("#result"); if (element?.dataset.status === "failed") throw new Error(element.textContent || "Browser verification failed."); return element?.dataset.status === "passed" ? element.textContent : false; })()'
    );
    console.log(output);
    if (process.env.QUALIFICATION_EVIDENCE_DIR) {
        const evidence = await browser.page.call("Runtime.evaluate", { expression: "JSON.stringify(window.counterParityEvidence)", returnByValue: true });
        writeFileSync(resolve(process.env.QUALIFICATION_EVIDENCE_DIR, "pac-counter-browser.json"), evidence.result.value ?? "null");
    }
    await verifySessionOwnership(appUrl, "Ms. Pac-Man 2010");
} finally {
    await cleanupBrowser(browser);
    await stopChild(server);
}

async function verifySessionOwnership(url, gameName) {
    const executablePath = await findBrowser();
    const ownershipBrowser = await chromium.launch({
        executablePath,
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu-sandbox"]
    });

    try {
        const context = await ownershipBrowser.newContext({ viewport: { width: 800, height: 600 } });
        const first = await context.newPage();
        await first.goto(url, { waitUntil: "domcontentloaded" });

        const scalingLabel = first.locator(".setting-scaling-row > span").first();
        const primaryButton = first.locator(".start-button:not(:disabled)").first();
        await scalingLabel.waitFor({ state: "visible", timeout: 30_000 });
        await primaryButton.waitFor({ state: "visible", timeout: 30_000 });

        const messageReference = await readComputedStyles(scalingLabel, ["fontFamily", "fontSize", "fontWeight", "color"]);
        const buttonReference = await readComputedStyles(primaryButton, [
            "backgroundColor",
            "color",
            "fontFamily",
            "fontSize",
            "fontWeight",
            "borderRadius",
            "minHeight",
            "minWidth",
            "paddingTop",
            "paddingRight",
            "paddingBottom",
            "paddingLeft"
        ]);

        const second = await context.newPage();
        await second.setViewportSize({ width: 360, height: 640 });
        await second.goto(url, { waitUntil: "domcontentloaded" });

        const ownershipMessage = second.locator(".session-ownership-message");
        const continueButton = second.getByRole("button", { name: "Continue Here" });
        await ownershipMessage.waitFor({ state: "visible", timeout: 30_000 });
        await continueButton.waitFor({ state: "visible", timeout: 30_000 });

        assert.equal(await ownershipMessage.textContent(), "Your game is open in another tab.");
        assert.equal(await continueButton.getAttribute("class"), "start-button");
        assert.deepEqual(await readComputedStyles(ownershipMessage, ["fontFamily", "fontSize", "fontWeight", "color"]), messageReference);
        assert.deepEqual(
            await readComputedStyles(continueButton, [
                "backgroundColor",
                "color",
                "fontFamily",
                "fontSize",
                "fontWeight",
                "borderRadius",
                "minHeight",
                "minWidth",
                "paddingTop",
                "paddingRight",
                "paddingBottom",
                "paddingLeft"
            ]),
            buttonReference
        );

        const wrapping = await ownershipMessage.evaluate((element) => {
            element.textContent = "The other tab has not released your game. Close it, then try again.";
            const style = globalThis.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return {
                clientWidth: element.clientWidth,
                display: style.display,
                documentClientWidth: globalThis.document.documentElement.clientWidth,
                documentScrollWidth: globalThis.document.documentElement.scrollWidth,
                height: rect.height,
                innerWidth: globalThis.innerWidth,
                left: rect.left,
                lineHeight: Number.parseFloat(style.lineHeight),
                right: rect.right,
                scrollWidth: element.scrollWidth,
                whiteSpace: style.whiteSpace
            };
        });

        assert.equal(wrapping.innerWidth, 360);
        assert.equal(wrapping.display, "block");
        assert.equal(wrapping.whiteSpace, "normal");
        assert.ok(wrapping.left >= -0.5, `Ownership message extends past the left viewport edge: ${wrapping.left}`);
        assert.ok(wrapping.right <= wrapping.innerWidth + 0.5, `Ownership message extends past the right viewport edge: ${wrapping.right}`);
        assert.ok(wrapping.scrollWidth <= wrapping.clientWidth + 1, "Ownership message has horizontal overflow.");
        assert.ok(wrapping.documentScrollWidth <= wrapping.documentClientWidth + 1, "Ownership screen causes horizontal page overflow.");
        assert.ok(
            Number.isFinite(wrapping.lineHeight) && wrapping.height > wrapping.lineHeight * 1.5,
            "Long ownership messages should wrap to multiple lines."
        );

        await continueButton.click();
        await first.waitForFunction(() => globalThis.document.querySelector(".session-ownership-message")?.textContent === "Your game moved to another tab.");

        const movedMessage = first.locator(".session-ownership-message");
        assert.deepEqual(await readComputedStyles(movedMessage, ["fontFamily", "fontSize", "fontWeight", "color"]), messageReference);
        assert.equal(await movedMessage.evaluate((element) => globalThis.getComputedStyle(element).display), "block");

        await second.locator(".setting-scaling-row > span").first().waitFor({ state: "visible", timeout: 30_000 });
        console.log(`${gameName} multi-tab ownership verification passed.`);
    } finally {
        await ownershipBrowser.close();
    }
}

async function readComputedStyles(locator, properties) {
    return locator.evaluate((element, names) => {
        const style = globalThis.getComputedStyle(element);
        return Object.fromEntries(names.map((name) => [name, style[name]]));
    }, properties);
}
