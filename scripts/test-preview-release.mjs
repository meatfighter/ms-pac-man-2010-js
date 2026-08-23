import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReleasePreviewServer } from "./preview-release.mjs";

const tempDir = mkdtempSync(join(tmpdir(), "mspacman-preview-test-"));
const server = createReleasePreviewServer({
    basePath: "/stage/",
    distRoot: tempDir,
    host: "127.0.0.1"
});

try {
    writeFileSync(join(tempDir, "index.html"), "about\n");
    mkdirSync(join(tempDir, "pwa"), { recursive: true });
    writeFileSync(join(tempDir, "pwa", "index.html"), "pwa\n");
    mkdirSync(join(tempDir, "pwa", "assets"), { recursive: true });
    writeFileSync(join(tempDir, "pwa", "assets", "app.js"), "export {};\n");

    const port = await listen(server);
    const origin = `http://127.0.0.1:${port}`;

    await runTest("preview redirects slashless mounted root", async () => {
        const response = await fetch(`${origin}/stage`, { redirect: "manual" });
        assert.equal(response.status, 308);
        assert.equal(response.headers.get("location"), "/stage/");
    });

    await runTest("preview redirects slashless generated directories", async () => {
        const response = await fetch(`${origin}/stage/pwa`, { redirect: "manual" });
        assert.equal(response.status, 308);
        assert.equal(response.headers.get("location"), "/stage/pwa/");
    });

    await runTest("preview serves files beneath relocated base", async () => {
        const about = await fetch(`${origin}/stage/`);
        assert.equal(await about.text(), "about\n");
        const pwa = await fetch(`${origin}/stage/pwa/`);
        assert.equal(await pwa.text(), "pwa\n");
        const asset = await fetch(`${origin}/stage/pwa/assets/app.js`);
        assert.equal(await asset.text(), "export {};\n");
    });

    await runTest("preview refuses files reached through intermediate directory links", async () => {
        const externalDir = mkdtempSync(join(tmpdir(), "mspacman-preview-external-"));
        try {
            writeFileSync(join(externalDir, "external.txt"), "external\n");
            try {
                symlinkSync(externalDir, join(tempDir, "linked"), process.platform === "win32" ? "junction" : "dir");
            } catch (error) {
                console.log(`ok - preview link creation unavailable; skipped assertion (${error.code ?? "unknown"})`);
                return;
            }
            const response = await fetch(`${origin}/stage/linked/external.txt`);
            assert.equal(response.status, 403);
        } finally {
            rmSync(externalDir, { recursive: true, force: true });
            rmSync(join(tempDir, "linked"), { recursive: true, force: true });
        }
    });
} finally {
    await close(server);
    rmSync(tempDir, { recursive: true, force: true });
}

function listen(targetServer) {
    return new Promise((resolve, reject) => {
        targetServer.once("error", reject);
        targetServer.listen(0, "127.0.0.1", () => {
            targetServer.off("error", reject);
            const address = targetServer.address();
            assert.ok(typeof address === "object" && address !== null, "Preview server did not report a TCP address.");
            resolve(address.port);
        });
    });
}

function close(targetServer) {
    return new Promise((resolve, reject) => {
        targetServer.close((error) => {
            if (error !== undefined) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}

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
