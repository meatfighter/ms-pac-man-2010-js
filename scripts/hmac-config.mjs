import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { getHmacNextCandidateDir, rootDir } from "./build-utils.mjs";

export const HMAC_KEY_PATTERN = /^[0-9a-f]{64}$/;
export const SYNTHETIC_RELEASE_HMAC_KEY_HEX = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

const ACTIVE_FILE_NAME = "ms-pac-man-2010-hmac.hex";
const NEXT_FILE_NAME = "ms-pac-man-2010-hmac.next.hex";
const PREVIOUS_FILE_NAME = "ms-pac-man-2010-hmac.previous.hex";

export function getReleaseSecretsDir() {
    const override = process.env.MSPACMAN_RELEASE_SECRETS_DIR;
    return override && override.length > 0 ? resolve(override) : join(rootDir, ".release-secrets");
}

export function getReleaseSecretPaths() {
    const dir = getReleaseSecretsDir();
    return {
        active: join(dir, ACTIVE_FILE_NAME),
        dir,
        next: join(dir, NEXT_FILE_NAME),
        previous: join(dir, PREVIOUS_FILE_NAME)
    };
}

export function validateHmacKeyHex(value, description = "HMAC key") {
    if (!HMAC_KEY_PATTERN.test(value)) {
        throw new Error(`${description} must match ${HMAC_KEY_PATTERN.source}.`);
    }
    return value;
}

export function normalizeImportedHmacKey(value) {
    return validateHmacKeyHex(value.trim(), "Imported HMAC key");
}

export function createHmacKeyHex() {
    return randomBytes(32).toString("hex");
}

export function getHmacFingerprint(keyHex) {
    validateHmacKeyHex(keyHex);
    return createHash("sha256").update(Buffer.from(keyHex, "hex")).digest("hex").slice(0, 12);
}

export function createCacheIdentity(version, keyHex) {
    const suffix = keyHex === "" ? "unsigned" : `k${getHmacFingerprint(keyHex)}`;
    return `${version.version}-${version.buildStamp}-${suffix}`;
}

export function readKeyFile(path, description) {
    if (!existsSync(path)) {
        throw new Error(`${description} is missing: ${path}`);
    }
    return validateHmacKeyHex(readFileSync(path, "utf8").trim(), description);
}

export function readSelectedHmacKey(keySource) {
    const paths = getReleaseSecretPaths();
    switch (keySource) {
        case "active":
            assertNoStagedNextKey();
            return readKeyFile(paths.active, "Active HMAC key");
        case "next":
            return readKeyFile(paths.next, "Next HMAC key");
        case "env":
            return readEnvHmacKey();
        default:
            throw new Error(`Unknown HMAC key source: ${keySource}`);
    }
}

export function assertNoStagedNextKey() {
    const paths = getReleaseSecretPaths();
    if (existsSync(paths.next)) {
        throw new Error(
            `A next HMAC rotation key is staged at ${paths.next}. Use --key-source=next for the candidate release or abort/promote rotation first.`
        );
    }
}

export function readEnvHmacKey() {
    const value = process.env.MSPACMAN_HMAC_KEY_HEX;
    if (value === undefined || value === "") {
        throw new Error("MSPACMAN_HMAC_KEY_HEX is required.");
    }
    return validateHmacKeyHex(value, "MSPACMAN_HMAC_KEY_HEX");
}

export function writeKeyFile(path, keyHex) {
    validateHmacKeyHex(keyHex);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${keyHex}\n`, { mode: 0o600 });
}

export function initActiveKey() {
    const paths = getReleaseSecretPaths();
    if (existsSync(paths.active)) {
        return {
            created: false,
            fingerprint: getHmacFingerprint(readKeyFile(paths.active, "Active HMAC key"))
        };
    }

    const keyHex = createHmacKeyHex();
    writeKeyFile(paths.active, keyHex);
    return {
        created: true,
        fingerprint: getHmacFingerprint(keyHex)
    };
}

export function importActiveKey(keyHex) {
    const paths = getReleaseSecretPaths();
    if (existsSync(paths.active)) {
        throw new Error("Active HMAC key already exists. Use rotation to replace an established key.");
    }
    const normalized = normalizeImportedHmacKey(keyHex);
    writeKeyFile(paths.active, normalized);
    return getHmacFingerprint(normalized);
}

export function createNewActiveKey() {
    const paths = getReleaseSecretPaths();
    if (existsSync(paths.active)) {
        throw new Error("Active HMAC key already exists.");
    }

    const keyHex = createHmacKeyHex();
    writeKeyFile(paths.active, keyHex);
    return {
        fingerprint: getHmacFingerprint(keyHex),
        keyHex
    };
}

export function prepareNextKey() {
    const paths = getReleaseSecretPaths();
    readKeyFile(paths.active, "Active HMAC key");
    if (existsSync(paths.next)) {
        throw new Error(`Next HMAC key already exists: ${paths.next}`);
    }

    const keyHex = createHmacKeyHex();
    writeKeyFile(paths.next, keyHex);
    return getHmacFingerprint(keyHex);
}

export function ensureNextKey() {
    const paths = getReleaseSecretPaths();
    readKeyFile(paths.active, "Active HMAC key");
    if (existsSync(paths.next)) {
        return {
            created: false,
            fingerprint: getHmacFingerprint(readKeyFile(paths.next, "Next HMAC key"))
        };
    }

    const keyHex = createHmacKeyHex();
    writeKeyFile(paths.next, keyHex);
    return {
        created: true,
        fingerprint: getHmacFingerprint(keyHex)
    };
}

export function checkRotationKeys() {
    const paths = getReleaseSecretPaths();
    const activeKey = readKeyFile(paths.active, "Active HMAC key");
    const nextKey = readKeyFile(paths.next, "Next HMAC key");
    if (activeKey === nextKey) {
        throw new Error("Active and next HMAC keys must be different.");
    }
    return {
        activeFingerprint: getHmacFingerprint(activeKey),
        nextFingerprint: getHmacFingerprint(nextKey)
    };
}

export function promoteNextKey(options = {}) {
    const paths = getReleaseSecretPaths();
    const activeKey = readKeyFile(paths.active, "Active HMAC key");
    const nextKey = readKeyFile(paths.next, "Next HMAC key");
    if (activeKey === nextKey) {
        throw new Error("Active and next HMAC keys must be different.");
    }

    const rollbackPath = join(paths.dir, `${ACTIVE_FILE_NAME}.rollback`);
    const nextActivePath = join(paths.dir, `${ACTIVE_FILE_NAME}.promote`);
    const previousPath = join(paths.dir, `${PREVIOUS_FILE_NAME}.promote`);

    rmSync(rollbackPath, { force: true });
    rmSync(nextActivePath, { force: true });
    rmSync(previousPath, { force: true });

    try {
        writeKeyFile(rollbackPath, activeKey);
        writeKeyFile(nextActivePath, nextKey);
        writeKeyFile(previousPath, activeKey);
        if (options.failStage === "before-active-replace") {
            throw new Error("Injected HMAC promotion failure: before-active-replace");
        }

        copyFileSync(nextActivePath, paths.active);
        if (readKeyFile(paths.active, "Promoted active HMAC key") !== nextKey) {
            throw new Error("Promoted active HMAC key did not match the staged next key.");
        }
        if (options.exitStage === "after-active-replace") {
            process.exit(97);
        }
        if (options.failStage === "after-active-replace") {
            throw new Error("Injected HMAC promotion failure: after-active-replace");
        }

        copyFileSync(previousPath, paths.previous);
        if (options.exitStage === "after-previous-write") {
            process.exit(97);
        }
        rmSync(paths.next, { force: true });
        return {
            activeFingerprint: getHmacFingerprint(nextKey),
            previousFingerprint: getHmacFingerprint(activeKey)
        };
    } catch (error) {
        if (existsSync(rollbackPath)) {
            copyFileSync(rollbackPath, paths.active);
        }
        throw error;
    } finally {
        rmSync(rollbackPath, { force: true });
        rmSync(nextActivePath, { force: true });
        rmSync(previousPath, { force: true });
    }
}

export function abortRotation() {
    const paths = getReleaseSecretPaths();
    const hmacNextCandidateDir = getHmacNextCandidateDir();
    const existed = existsSync(paths.next);
    rmSync(paths.next, { force: true });
    rmSync(hmacNextCandidateDir, { recursive: true, force: true });
    return {
        candidateRemoved: true,
        nextRemoved: existed
    };
}

export async function checkActiveHmacKey() {
    const paths = getReleaseSecretPaths();
    const activeKey = readKeyFile(paths.active, "Active HMAC key");
    assertRepositoryReleaseSecretsIgnored();
    await assertNonSyntheticSecretAbsentFromTrackedFiles(activeKey);
    return getHmacFingerprint(activeKey);
}

export async function checkHmacConfiguration() {
    const paths = getReleaseSecretPaths();
    const activeKey = readKeyFile(paths.active, "Active HMAC key");
    assertRepositoryReleaseSecretsIgnored();
    await assertNonSyntheticSecretAbsentFromTrackedFiles(activeKey);

    const result = {
        activeFingerprint: getHmacFingerprint(activeKey),
        nextFingerprint: null,
        rotationStaged: existsSync(paths.next)
    };
    if (result.rotationStaged) {
        const nextKey = readKeyFile(paths.next, "Next HMAC key");
        if (activeKey === nextKey) {
            throw new Error("Active and next HMAC keys must be different.");
        }
        await assertNonSyntheticSecretAbsentFromTrackedFiles(nextKey);
        result.nextFingerprint = getHmacFingerprint(nextKey);
    }
    return result;
}

export async function assertNonSyntheticSecretAbsentFromTrackedFiles(secret) {
    if (secret === SYNTHETIC_RELEASE_HMAC_KEY_HEX) {
        return;
    }
    await assertSecretAbsentFromTrackedFiles(secret);
}

export function assertRepositoryReleaseSecretsIgnored() {
    for (const ignoredPath of [
        ".release-secrets/ms-pac-man-2010-hmac.hex",
        ".release-candidates/hmac-next/release.json",
        ".release-components/pwa/pwa/sw.js",
        ".dist-pending-test/sentinel.txt",
        ".dist-previous-test/sentinel.txt",
        ".dist-active-before-hmac-finalize-test/sentinel.txt"
    ]) {
        const checkIgnored = spawnGit(["check-ignore", "-q", "--", ignoredPath]);
        if (checkIgnored.status !== 0) {
            throw new Error(`Local release-state path is not ignored by Git: ${ignoredPath}`);
        }
    }

    const trackedReleaseState = listTrackedFiles().filter(isLocalReleaseStatePath);
    if (trackedReleaseState.length > 0) {
        throw new Error(`Local release-state paths must not be tracked by Git:\n${trackedReleaseState.join("\n")}`);
    }
}

function isLocalReleaseStatePath(path) {
    return (
        path === ".release-secrets" ||
        path.startsWith(".release-secrets/") ||
        path === ".release-candidates" ||
        path.startsWith(".release-candidates/") ||
        path === ".release-components" ||
        path.startsWith(".release-components/") ||
        path.startsWith(".dist-pending-") ||
        path.startsWith(".dist-previous-") ||
        path.startsWith(".dist-active-before-hmac-finalize-")
    );
}

export async function assertSecretAbsentFromTrackedFiles(secret) {
    validateHmacKeyHex(secret, "Selected HMAC key");
    const needle = Buffer.from(secret, "utf8");
    for (const file of listTrackedFiles()) {
        const path = join(rootDir, file);
        if (!existsSync(path)) {
            continue;
        }
        if (await fileContainsBuffer(path, needle)) {
            throw new Error(`Tracked file contains the selected HMAC key: ${file}`);
        }
    }
}

export function listTrackedFiles() {
    const result = spawnGit(["ls-files", "-z"]);
    return result.stdout.split("\0").filter(Boolean);
}

export async function fileContainsBuffer(path, needle) {
    if (needle.length === 0) {
        return false;
    }

    let tail = Buffer.alloc(0);
    for await (const chunk of createReadStream(path)) {
        const combined = tail.length === 0 ? chunk : Buffer.concat([tail, chunk]);
        if (combined.indexOf(needle) >= 0) {
            return true;
        }
        tail = combined.subarray(Math.max(0, combined.length - needle.length + 1));
    }
    return false;
}

function spawnGit(args) {
    const result = spawnSync("git", args, {
        cwd: rootDir,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true
    });
    if (result.status !== 0 && args[0] !== "check-ignore") {
        throw result.error ?? new Error(`git ${args.join(" ")} failed.`);
    }
    if (result.error) {
        throw result.error;
    }
    return result;
}
