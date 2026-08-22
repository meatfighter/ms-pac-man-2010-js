import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    abortRotation,
    assertNoStagedNextKey,
    checkActiveHmacKey,
    checkRotationKeys,
    createCacheIdentity,
    createHmacKeyHex,
    ensureNextKey,
    fileContainsBuffer,
    getHmacFingerprint,
    getReleaseSecretPaths,
    importActiveKey,
    initActiveKey,
    prepareNextKey,
    promoteNextKey,
    readKeyFile,
    readSelectedHmacKey,
    SYNTHETIC_RELEASE_HMAC_KEY_HEX,
    validateHmacKeyHex
} from "./hmac-config.mjs";

const originalSecretsDir = process.env.MSPACMAN_RELEASE_SECRETS_DIR;
const originalCandidateDir = process.env.MSPACMAN_HMAC_NEXT_CANDIDATE_DIR;
const tempDir = mkdtempSync(join(tmpdir(), "mspacman-hmac-test-"));
const tempCandidateDir = mkdtempSync(join(tmpdir(), "mspacman-hmac-candidate-test-"));
const importedKey = SYNTHETIC_RELEASE_HMAC_KEY_HEX;
const secondKey = "101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f";

try {
    process.env.MSPACMAN_RELEASE_SECRETS_DIR = tempDir;
    process.env.MSPACMAN_HMAC_NEXT_CANDIDATE_DIR = tempCandidateDir;

    await runTest("validates strict lowercase 32-byte hex keys", () => {
        assert.equal(validateHmacKeyHex(importedKey), importedKey);
        for (const key of ["0".repeat(63), "0".repeat(65), "A".repeat(64), "g".repeat(64)]) {
            assert.throws(() => validateHmacKeyHex(key), /HMAC key/);
        }
    });

    await runTest("imports and checks active key without exposing the key through fingerprints", () => {
        const fingerprint = importActiveKey(importedKey);
        const paths = getReleaseSecretPaths();
        assert.equal(readKeyFile(paths.active, "Active HMAC key"), importedKey);
        assert.equal(fingerprint, getHmacFingerprint(importedKey));
    });

    await runTest("a second import cannot change the active key", () => {
        assert.throws(() => importActiveKey(secondKey), /already exists/);
        assert.equal(readKeyFile(getReleaseSecretPaths().active, "Active HMAC key"), importedKey);
    });

    await runTest("init leaves an existing active key unchanged", () => {
        const result = initActiveKey();
        assert.equal(result.created, false);
        assert.equal(readKeyFile(getReleaseSecretPaths().active, "Active HMAC key"), importedKey);
    });

    await runTest("rotation prepare, check, promote, and abort use distinct keys", () => {
        const nextFingerprint = prepareNextKey();
        const existingNext = ensureNextKey();
        assert.equal(existingNext.created, false);
        assert.equal(existingNext.fingerprint, nextFingerprint);
        assert.throws(() => assertNoStagedNextKey(), /next HMAC rotation key is staged/);
        assert.throws(() => readSelectedHmacKey("active"), /next HMAC rotation key is staged/);
        const rotation = checkRotationKeys();
        assert.equal(rotation.activeFingerprint, getHmacFingerprint(importedKey));
        assert.equal(rotation.nextFingerprint, nextFingerprint);
        assert.equal(readSelectedHmacKey("next"), readKeyFile(getReleaseSecretPaths().next, "Next HMAC key"));
        const promoted = promoteNextKey();
        assert.equal(promoted.previousFingerprint, getHmacFingerprint(importedKey));
        assert.notEqual(promoted.activeFingerprint, getHmacFingerprint(importedKey));
        assert.doesNotThrow(() => assertNoStagedNextKey());
        assert.deepEqual(abortRotation(), {
            candidateRemoved: true,
            nextRemoved: false
        });
    });

    await runTest("cache identity includes unsigned or HMAC fingerprint suffix", () => {
        const version = {
            buildStamp: "2026-08-21T00:00:00.000Z",
            version: "1.0.0"
        };
        assert.equal(createCacheIdentity(version, ""), "1.0.0-2026-08-21T00:00:00.000Z-unsigned");
        assert.equal(createCacheIdentity(version, secondKey), `1.0.0-2026-08-21T00:00:00.000Z-k${getHmacFingerprint(secondKey)}`);
    });

    await runTest("hmac check validates a random active key without printing or scanning gaps", async () => {
        const previousSecretsDir = process.env.MSPACMAN_RELEASE_SECRETS_DIR;
        const checkDir = mkdtempSync(join(tmpdir(), "mspacman-hmac-check-test-"));
        try {
            process.env.MSPACMAN_RELEASE_SECRETS_DIR = checkDir;
            const key = createHmacKeyHex();
            importActiveKey(key);
            assert.equal(await checkActiveHmacKey(), getHmacFingerprint(key));
        } finally {
            restoreEnv("MSPACMAN_RELEASE_SECRETS_DIR", previousSecretsDir);
            rmSync(checkDir, { recursive: true, force: true });
        }
    });

    await runTest("tracked-file secret scan can search beyond eight MiB", async () => {
        const path = join(tempDir, "large-secret-scan.bin");
        writeFileSync(path, Buffer.concat([Buffer.alloc(8 * 1024 * 1024 + 17, 0x61), Buffer.from(secondKey, "utf8")]));
        assert.equal(await fileContainsBuffer(path, Buffer.from(secondKey, "utf8")), true);
    });
} finally {
    restoreEnv("MSPACMAN_RELEASE_SECRETS_DIR", originalSecretsDir);
    restoreEnv("MSPACMAN_HMAC_NEXT_CANDIDATE_DIR", originalCandidateDir);
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(tempCandidateDir, { recursive: true, force: true });
}

function restoreEnv(name, value) {
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
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
