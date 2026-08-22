import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmacKeyHex, getHmacFingerprint, writeKeyFile } from "./hmac-config.mjs";
import { rootDir } from "./build-utils.mjs";

const PROTOCOL_VERSION = 1;
const tempSecretsDir = mkdtempSync(join(tmpdir(), "mspacman-smoke-api-secrets-"));
const tempDistDir = mkdtempSync(join(tmpdir(), "mspacman-smoke-api-dist-"));
const tempCandidateDir = mkdtempSync(join(tmpdir(), "mspacman-smoke-api-candidate-"));
const activeKey = createHmacKeyHex();
let nextKey = createHmacKeyHex();
while (nextKey === activeKey) {
    nextKey = createHmacKeyHex();
}

try {
    writeKeyFile(join(tempSecretsDir, "ms-pac-man-2010-hmac.hex"), activeKey);
    writeReleaseMetadata(tempDistDir, "production", "active", getHmacFingerprint(activeKey));
    writeReleaseMetadata(tempCandidateDir, "rotation-candidate", "next", getHmacFingerprint(nextKey));

    await runTest("production API smoke test performs non-mutating duplicate POST", async () => {
        const table = [
            { world: 0, score: 123450, initials: "MJB" },
            { world: 0, score: 100000, initials: "AAA" },
            { world: 1, score: 90000, initials: "CAT" }
        ];
        let postCount = 0;
        const server = await startScoreServer({
            table,
            onPost: (payload) => {
                postCount++;
                assert.deepEqual(payload, {
                    protocolVersion: PROTOCOL_VERSION,
                    ...table[0],
                    checksum: calculateChecksum(activeKey, table[0])
                });
            }
        });
        try {
            const result = await runSmoke(server.url);
            assert.equal(result.status, 0, formatFailure("Expected production API smoke test to pass.", result));
            assert.equal(postCount, 1, "Smoke test must perform exactly one duplicate POST.");
            assertOutputIncludes(result, getHmacFingerprint(activeKey));
            assertOutputDoesNotExposeKey(result, activeKey);
            assertOutputIncludes(result, "Production high-score API smoke test passed");
        } finally {
            await server.close();
        }
    });

    await runTest("production API smoke test can use the staged next HMAC key", async () => {
        const nextKeyPath = join(tempSecretsDir, "ms-pac-man-2010-hmac.next.hex");
        writeKeyFile(nextKeyPath, nextKey);
        const table = [{ world: 0, score: 543210, initials: "ROT" }];
        let postCount = 0;
        const server = await startScoreServer({
            table,
            onPost: (payload) => {
                postCount++;
                assert.deepEqual(payload, {
                    protocolVersion: PROTOCOL_VERSION,
                    ...table[0],
                    checksum: calculateChecksum(nextKey, table[0])
                });
            }
        });
        try {
            const result = await runSmoke(server.url, ["--key-source=next"]);
            assert.equal(result.status, 0, formatFailure("Expected next-key production API smoke test to pass.", result));
            assert.equal(postCount, 1, "Next-key smoke test must perform exactly one duplicate POST.");
            assertOutputIncludes(result, getHmacFingerprint(nextKey));
            assertOutputDoesNotExposeKey(result, nextKey);
            assertOutputIncludes(result, "Using next HMAC key fingerprint");
        } finally {
            await server.close();
            rmSync(nextKeyPath, { force: true });
        }
    });

    await runTest("production API smoke test refuses to POST into an empty leaderboard", async () => {
        let postCount = 0;
        const server = await startScoreServer({
            table: [],
            onPost: () => {
                postCount++;
            }
        });
        try {
            const result = await runSmoke(server.url);
            assert.notEqual(result.status, 0, "Empty leaderboard smoke test must fail.");
            assert.equal(postCount, 0, "Empty leaderboard smoke test must not POST.");
            assertOutputIncludes(result, "Production leaderboard is empty");
            assertOutputDoesNotExposeKey(result, activeKey);
        } finally {
            await server.close();
        }
    });

    await runTest("production API smoke test requires explicit confirmation", async () => {
        const result = await runNodeScript(["scripts/smoke-production-api.mjs", "--url=http://127.0.0.1:1/scores"]);
        assert.notEqual(result.status, 0, "Smoke test must refuse to run without --confirm-production.");
        assertOutputIncludes(result, "--confirm-production");
        assertOutputDoesNotExposeKey(result, activeKey);
    });
} finally {
    rmSync(tempSecretsDir, { recursive: true, force: true });
    rmSync(tempDistDir, { recursive: true, force: true });
    rmSync(tempCandidateDir, { recursive: true, force: true });
}

async function startScoreServer({ onPost, table }) {
    const server = createServer(async (request, response) => {
        if (request.url !== "/scores") {
            response.writeHead(404).end();
            return;
        }

        if (request.headers["mspacman-protocol-version"] !== String(PROTOCOL_VERSION)) {
            response.writeHead(400).end();
            return;
        }

        if (request.method === "POST") {
            onPost(JSON.parse(await readRequestBody(request)));
        } else if (request.method !== "GET") {
            response.writeHead(405).end();
            return;
        }

        response.writeHead(200, {
            "Content-Type": "application/json",
            "MsPacMan-Protocol-Version": String(PROTOCOL_VERSION)
        });
        response.end(
            JSON.stringify({
                protocolVersion: PROTOCOL_VERSION,
                scores: table
            })
        );
    });

    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(typeof address === "object" && address !== null, "Test server did not expose a TCP address.");
    return {
        close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
        url: `http://127.0.0.1:${address.port}/scores`
    };
}

function readRequestBody(request) {
    return new Promise((resolve, reject) => {
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk) => {
            body += chunk;
        });
        request.on("end", () => resolve(body));
        request.on("error", reject);
    });
}

function runSmoke(url, extraArgs = []) {
    return runNodeScript(["scripts/smoke-production-api.mjs", `--url=${url}`, "--confirm-production", ...extraArgs]);
}

function runNodeScript(args) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, args, {
            cwd: rootDir,
            env: {
                ...process.env,
                MSPACMAN_DIST_DIR: tempDistDir,
                MSPACMAN_HMAC_NEXT_CANDIDATE_DIR: tempCandidateDir,
                MSPACMAN_RELEASE_SECRETS_DIR: tempSecretsDir
            },
            windowsHide: true
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        child.on("close", (status) => {
            resolve({
                status,
                stdout,
                stderr
            });
        });
    });
}

function calculateChecksum(keyHex, candidate) {
    return createHmac("sha256", Buffer.from(keyHex, "hex"))
        .update(`mspacman-score|${PROTOCOL_VERSION}|${candidate.world}|${candidate.score}|${candidate.initials}`)
        .digest("hex");
}

function writeReleaseMetadata(releaseDir, releaseKind, hmacKeySource, hmacKeyFingerprint) {
    mkdirSync(releaseDir, { recursive: true });
    writeFileSync(
        join(releaseDir, "release.json"),
        `${JSON.stringify(
            {
                hmacKeyFingerprint,
                hmacKeySource,
                releaseKind
            },
            null,
            4
        )}\n`
    );
}

function assertOutputIncludes(result, text) {
    assert.ok(`${result.stdout}\n${result.stderr}`.includes(text), `Expected output to include ${JSON.stringify(text)}.`);
}

function assertOutputDoesNotExposeKey(result, keyHex) {
    assert.equal(result.stdout.includes(keyHex), false, "stdout must not expose full HMAC keys.");
    assert.equal(result.stderr.includes(keyHex), false, "stderr must not expose full HMAC keys.");
}

function formatFailure(message, result) {
    return [message, "stdout:", result.stdout, "stderr:", result.stderr].join("\n");
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
