import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonicalHmacNextCandidateDir, repositoryDistDir, rootDir } from "./build-utils.mjs";
import { getHmacFingerprint, readSelectedHmacKey } from "./hmac-config.mjs";
import { assertReleaseProvenance } from "./release-provenance.mjs";

const PROTOCOL_VERSION = 1;
const WORLD_COUNT = 4;
const ROWS_PER_WORLD = 5;
const MAX_SCORE = 2147483647;
const MAX_RESPONSE_BYTES = 8192;
const REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_PRODUCTION_URL = "https://meatfighter.com/api/ms-pac-man-2010/scores";

const url = readSmokeUrl();
const keySource = readOption("key-source", "active");
assert.ok(keySource === "active" || keySource === "next", "--key-source must be active or next.");

if (!process.argv.includes("--confirm-production")) {
    throw new Error("Refusing to run production API smoke test without --confirm-production.");
}

const keyHex = readSelectedHmacKey(keySource);
const fingerprint = getHmacFingerprint(keyHex);
verifyReleaseArtifact(fingerprint, keySource);
console.log(`Using ${keySource} HMAC key fingerprint: ${fingerprint}`);

const initialScores = await requestScores("GET");
if (initialScores.length === 0) {
    throw new Error("Production leaderboard is empty; refusing to create a synthetic score during smoke test.");
}

const candidate = initialScores[0];
assert.ok(candidate !== undefined, "Validated leaderboard unexpectedly had no first entry.");
const postedScores = await requestScores("POST", {
    protocolVersion: PROTOCOL_VERSION,
    ...candidate,
    checksum: calculateChecksum(keyHex, candidate)
});
assert.deepEqual(postedScores, initialScores, "Duplicate smoke-test POST must return the unchanged authoritative leaderboard.");

const finalScores = await requestScores("GET");
assert.deepEqual(finalScores, initialScores, "Duplicate smoke-test POST must not alter the production leaderboard.");
console.log(`Production high-score API smoke test passed with key fingerprint ${fingerprint}.`);

async function requestScores(method, body = undefined) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            body: method === "POST" ? JSON.stringify(body) : undefined,
            cache: "no-store",
            credentials: "omit",
            headers: createHeaders(method),
            method,
            signal: controller.signal
        });

        assert.equal(response.status, 200, `${method} ${url} must return HTTP 200.`);
        assert.equal(response.headers.get("MsPacMan-Protocol-Version"), String(PROTOCOL_VERSION), `${method} ${url} must return protocol header 1.`);
        assert.equal(isJsonContentType(response.headers.get("Content-Type")), true, `${method} ${url} must return JSON content type.`);
        const text = await readBoundedText(response, MAX_RESPONSE_BYTES);
        const parsed = JSON.parse(text);
        const scores = validateScoresResponse(parsed);
        if (scores === null) {
            throw new Error(`${method} ${url} returned an invalid leaderboard payload.`);
        }
        return scores;
    } finally {
        clearTimeout(timeout);
    }
}

function createHeaders(method) {
    const headers = {
        "MsPacMan-Protocol-Version": String(PROTOCOL_VERSION)
    };
    if (method === "POST") {
        headers["Content-Type"] = "application/json";
    }
    return headers;
}

async function readBoundedText(response, maxBytes) {
    if (response.body === null) {
        throw new Error("Production API response did not include a body.");
    }

    const reader = response.body.getReader();
    const chunks = [];
    let byteCount = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        if (value !== undefined) {
            byteCount += value.byteLength;
            if (byteCount > maxBytes) {
                await reader.cancel().catch(() => undefined);
                throw new Error("Production API response exceeded the bounded read limit.");
            }
            chunks.push(value);
        }
    }

    const bytes = new Uint8Array(byteCount);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
}

function validateScoresResponse(value) {
    const response = asRecord(value);
    if (response === null || !hasExactKeys(response, ["protocolVersion", "scores"])) {
        return null;
    }
    if (response.protocolVersion !== PROTOCOL_VERSION || !Array.isArray(response.scores)) {
        return null;
    }
    return validateScoreTable(response.scores);
}

function validateScoreTable(value) {
    if (value.length > WORLD_COUNT * ROWS_PER_WORLD) {
        return null;
    }

    const counts = new Array(WORLD_COUNT).fill(0);
    const tuples = new Set();
    const scores = [];
    let previousWorld = -1;
    let previousScore = MAX_SCORE + 1;

    for (const entry of value) {
        if (!isValidSubmittedScoreTuple(entry)) {
            return null;
        }

        const score = {
            world: entry.world,
            score: entry.score,
            initials: entry.initials
        };
        counts[score.world]++;
        if (counts[score.world] > ROWS_PER_WORLD) {
            return null;
        }
        if (score.world < previousWorld) {
            return null;
        }
        if (score.world !== previousWorld) {
            previousWorld = score.world;
            previousScore = MAX_SCORE + 1;
        }
        if (score.score > previousScore) {
            return null;
        }
        previousScore = score.score;

        const tuple = `${score.world}|${score.score}|${score.initials}`;
        if (tuples.has(tuple)) {
            return null;
        }
        tuples.add(tuple);
        scores.push(score);
    }

    return scores;
}

function isValidSubmittedScoreTuple(value) {
    const score = asRecord(value);
    return (
        score !== null &&
        hasExactKeys(score, ["world", "score", "initials"]) &&
        isWorld(score.world) &&
        isPlausibleScore(score.score) &&
        isAllowedInitials(score.initials)
    );
}

function isWorld(value) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < WORLD_COUNT;
}

function isPlausibleScore(value) {
    return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_SCORE && value % 10 === 0;
}

function isAllowedInitials(value) {
    return typeof value === "string" && /^[A-Z ]{3}$/.test(value);
}

function asRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function hasExactKeys(value, keys) {
    const actual = Object.keys(value);
    return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function calculateChecksum(keyHex, candidate) {
    return createHmac("sha256", Buffer.from(keyHex, "hex"))
        .update(`mspacman-score|${PROTOCOL_VERSION}|${candidate.world}|${candidate.score}|${candidate.initials}`)
        .digest("hex");
}

function verifyReleaseArtifact(fingerprint, keySource) {
    const releaseDir = readReleaseDirForSmoke(keySource);
    const releaseMetadataPath = join(releaseDir, "release.json");
    if (!existsSync(releaseMetadataPath)) {
        throw new Error(`Release metadata is required before production API smoke testing: ${releaseMetadataPath}`);
    }

    const metadata = JSON.parse(readFileSync(releaseMetadataPath, "utf8"));
    assert.equal(metadata.hmacKeyFingerprint, fingerprint, "Release artifact HMAC fingerprint must match the selected local key.");
    const provenance = readExpectedSmokeProvenance(metadata, keySource);
    runReleaseVerifier(releaseDir, provenance);
}

function readExpectedSmokeProvenance(metadata, keySource) {
    if (keySource === "next") {
        assertReleaseProvenance(metadata, {
            expectedHmacKeySource: "next",
            expectedReleaseKind: "rotation-candidate"
        });
        return {
            hmacKeySource: "next",
            releaseKind: "rotation-candidate"
        };
    }

    const ordinaryProduction = metadata.releaseKind === "production" && metadata.hmacKeySource === "active";
    const finalizedRotation = metadata.releaseKind === "rotation-candidate" && metadata.hmacKeySource === "next";
    assert.ok(
        ordinaryProduction || finalizedRotation,
        "Active production smoke testing requires either production/active provenance or an exact finalized rotation-candidate/next artifact."
    );
    return {
        hmacKeySource: metadata.hmacKeySource,
        releaseKind: metadata.releaseKind
    };
}

function readReleaseDirForSmoke(keySource) {
    const override = readOption("release-dir", "");
    if (override !== "") {
        if (process.env.MSPACMAN_ENABLE_TEST_PATH_OVERRIDES !== "1") {
            throw new Error("--release-dir is reserved for tests; production smoke tests use canonical release artifacts.");
        }
        return resolve(override);
    }
    return keySource === "next" ? canonicalHmacNextCandidateDir : repositoryDistDir;
}

function readSmokeUrl() {
    const requestedUrl = readOption("url", DEFAULT_PRODUCTION_URL);
    const testMode = process.env.MSPACMAN_ENABLE_TEST_PATH_OVERRIDES === "1";
    if (!testMode && requestedUrl !== DEFAULT_PRODUCTION_URL) {
        throw new Error("Production API smoke testing uses the fixed production score endpoint.");
    }

    const parsed = new URL(requestedUrl);
    if (!testMode) {
        assert.equal(parsed.protocol, "https:", "Production API smoke testing must use HTTPS.");
        assert.equal(parsed.href, DEFAULT_PRODUCTION_URL, "Production API smoke testing must use the fixed score endpoint.");
    }
    return parsed.href;
}

function runReleaseVerifier(releaseDir, provenance) {
    if (process.env.MSPACMAN_ENABLE_TEST_PATH_OVERRIDES === "1" && process.env.MSPACMAN_TEST_ASSUME_VERIFIED_RELEASE_ARTIFACT === "1") {
        return;
    }

    const result = spawnSync(
        process.execPath,
        [
            "scripts/verify-release.mjs",
            "--key-source=env",
            `--expected-release-kind=${provenance.releaseKind}`,
            `--expected-hmac-key-source=${provenance.hmacKeySource}`
        ],
        {
            cwd: rootDir,
            encoding: "utf8",
            env: {
                ...process.env,
                MSPACMAN_ENABLE_TEST_PATH_OVERRIDES: process.env.MSPACMAN_ENABLE_TEST_PATH_OVERRIDES,
                MSPACMAN_HMAC_KEY_HEX: keyHex,
                MSPACMAN_INTERNAL_DIST_DIR: releaseDir,
                MSPACMAN_INTERNAL_RELEASE_BUILD: "1",
                MSPACMAN_RELEASE_VERIFY_TARGET: "full"
            },
            maxBuffer: 96 * 1024 * 1024,
            windowsHide: true
        }
    );
    if (result.status !== 0 || result.error) {
        throw result.error ?? new Error(`Release artifact verification failed before production API smoke testing.\n${result.stdout}\n${result.stderr}`);
    }
}

function isJsonContentType(value) {
    return value !== null && value.toLowerCase().split(";")[0].trim() === "application/json";
}

function readOption(name, fallback) {
    const prefix = `--${name}=`;
    const match = process.argv.find((arg) => arg.startsWith(prefix));
    return match === undefined ? fallback : match.slice(prefix.length);
}
