import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { acquireReleaseLock, getReleaseLockPath, readLockOwner } from "./release-lock.mjs";
import { rootDir } from "./build-utils.mjs";

const STRESS_CHILD_COUNT = 20;
const STRESS_BATCH_SIZE = 5;
const STRESS_READY_TIMEOUT_MS = 20_000;

const originalEnv = snapshotEnv();
const tempSecretsDir = mkdtempSync(join(tmpdir(), "mspacman-release-lock-"));

try {
    process.env.MSPACMAN_ENABLE_TEST_PATH_OVERRIDES = "1";
    process.env.MSPACMAN_TEST_RELEASE_SECRETS_DIR = tempSecretsDir;

    await runTest("nested release locks register and unregister child holders", async () => {
        const release = acquireReleaseLock("test-parent");
        try {
            const readyPath = join(tempSecretsDir, "nested-ready.txt");
            const child = spawnChildHolder("test-child", readyPath);
            try {
                await waitForFile(readyPath);
                let owner = readLockOwner();
                assert.equal(owner.valid, true);
                assert.equal(
                    owner.record.holders.some((holder) => holder.operation === "test-parent"),
                    true
                );
                assert.equal(
                    owner.record.holders.some((holder) => holder.operation === "test-child"),
                    true
                );

                await waitForClose(child);
                owner = readLockOwner();
                assert.equal(owner.valid, true);
                assert.deepEqual(
                    owner.record.holders.map((holder) => holder.operation),
                    ["test-parent"]
                );
            } finally {
                child.kill();
            }
        } finally {
            release();
        }
        assert.equal(existsSync(getReleaseLockPath()), false);
    });

    await runTest("concurrent nested release locks preserve all live child holders", async () => {
        const release = acquireReleaseLock("test-stress-parent");
        const children = [];
        try {
            for (let batchStart = 0; batchStart < STRESS_CHILD_COUNT; batchStart += STRESS_BATCH_SIZE) {
                const batch = [];
                const batchEnd = Math.min(batchStart + STRESS_BATCH_SIZE, STRESS_CHILD_COUNT);
                for (let i = batchStart; i < batchEnd; i++) {
                    const operation = `test-stress-child-${i}`;
                    const readyPath = join(tempSecretsDir, `${operation}.txt`);
                    const child = spawnPersistentChildHolder(operation, readyPath);
                    children.push(child);
                    batch.push({
                        child,
                        operation,
                        readyPath
                    });
                }

                await Promise.all(batch.map(({ child, operation, readyPath }) => waitForChildReady(child, operation, readyPath, STRESS_READY_TIMEOUT_MS)));
            }

            const owner = readLockOwner();
            assert.equal(owner.valid, true);
            const liveHolders = owner.record.holders.filter((holder) => isProcessAlive(holder.pid));
            assert.equal(liveHolders.length, STRESS_CHILD_COUNT + 1, "The release lock must record the parent plus all live child holders.");
            assert.equal(new Set(liveHolders.map((holder) => holder.pid)).size, STRESS_CHILD_COUNT + 1, "Every live holder should be recorded once.");
            const operations = new Set(liveHolders.map((holder) => holder.operation));
            assert.equal(operations.has("test-stress-parent"), true);
            for (let i = 0; i < STRESS_CHILD_COUNT; i++) {
                assert.equal(operations.has(`test-stress-child-${i}`), true);
            }
        } finally {
            for (const child of children) {
                child.kill();
            }
            await Promise.all(children.map((child) => waitForClose(child)));
            release();
        }
        assert.equal(existsSync(getReleaseLockPath()), false);
    });

    await runTest("live nested child prevents stale recovery after parent dies", async () => {
        const childReadyPath = join(tempSecretsDir, "orphan-child-ready.txt");
        const childPidPath = join(tempSecretsDir, "orphan-child-pid.txt");
        const wrapper = spawnWrapperWithChild(childReadyPath, childPidPath);
        let childPid = 0;
        try {
            await waitForFile(childReadyPath);
            childPid = Number(readFileSync(childPidPath, "utf8"));
            assert.ok(Number.isInteger(childPid) && childPid > 0, "Wrapper did not record a child PID.");

            wrapper.kill();
            await waitForClose(wrapper);

            assert.throws(() => acquireReleaseLock("test-contender"), /Another release operation is running/);
        } finally {
            if (childPid > 0) {
                killPid(childPid);
            }
            await waitUntil(() => !isProcessAlive(childPid));
        }

        const retry = acquireReleaseLock("test-retry-after-orphan");
        retry();
        assert.equal(existsSync(getReleaseLockPath()), false);
    });

    await runTest("fresh malformed release locks fail conservatively", () => {
        writeFileSync(getReleaseLockPath(), "");
        try {
            assert.throws(() => acquireReleaseLock("test-malformed-fresh"), /fresh malformed release lock/);
        } finally {
            rmSync(getReleaseLockPath(), { force: true });
        }
    });

    await runTest("stale malformed release locks are recoverable", () => {
        writeFileSync(getReleaseLockPath(), "");
        const old = new Date(Date.now() - 10 * 60 * 1000);
        utimesSync(getReleaseLockPath(), old, old);
        const release = acquireReleaseLock("test-malformed-stale");
        release();
        assert.equal(existsSync(getReleaseLockPath()), false);
    });
} finally {
    restoreEnv(originalEnv);
    rmSync(tempSecretsDir, { recursive: true, force: true });
}

function spawnChildHolder(operation, readyPath) {
    return spawn(
        process.execPath,
        [
            "--input-type=module",
            "-e",
            [
                'import { writeFileSync } from "node:fs";',
                'import { acquireReleaseLock } from "./scripts/release-lock.mjs";',
                `const release = acquireReleaseLock(${JSON.stringify(operation)});`,
                `writeFileSync(${JSON.stringify(readyPath)}, "ready\\n");`,
                "setTimeout(() => { release(); process.exit(0); }, 250);"
            ].join("")
        ],
        {
            cwd: rootDir,
            env: process.env,
            stdio: "ignore",
            windowsHide: true
        }
    );
}

function spawnPersistentChildHolder(operation, readyPath) {
    return spawn(
        process.execPath,
        [
            "--input-type=module",
            "-e",
            [
                'import { writeFileSync } from "node:fs";',
                'import { acquireReleaseLock } from "./scripts/release-lock.mjs";',
                `const release = acquireReleaseLock(${JSON.stringify(operation)});`,
                `writeFileSync(${JSON.stringify(readyPath)}, "ready\\n");`,
                "process.on('SIGTERM', () => { release(); process.exit(0); });",
                "setInterval(() => undefined, 1000);"
            ].join("")
        ],
        {
            cwd: rootDir,
            env: process.env,
            stdio: "ignore",
            windowsHide: true
        }
    );
}

function spawnWrapperWithChild(childReadyPath, childPidPath) {
    return spawn(
        process.execPath,
        [
            "--input-type=module",
            "-e",
            [
                'import { spawn } from "node:child_process";',
                'import { writeFileSync } from "node:fs";',
                'import { acquireReleaseLock } from "./scripts/release-lock.mjs";',
                'const release = acquireReleaseLock("test-wrapper");',
                "const childCode = [",
                '"import { writeFileSync } from \\"node:fs\\";",',
                '"import { acquireReleaseLock } from \\"./scripts/release-lock.mjs\\";",',
                '"const release = acquireReleaseLock(\\"test-orphan-child\\");",',
                `${JSON.stringify(`writeFileSync(${JSON.stringify(childReadyPath)}, "ready\\\\n");`)},`,
                '"process.on(\\"SIGTERM\\", () => { release(); process.exit(0); });",',
                '"setInterval(() => undefined, 1000);"',
                "].join('');",
                "const child = spawn(process.execPath, ['--input-type=module', '-e', childCode], { cwd: process.cwd(), detached: true, env: process.env, stdio: 'ignore', windowsHide: true });",
                "child.unref();",
                `writeFileSync(${JSON.stringify(childPidPath)}, String(child.pid));`,
                "setInterval(() => undefined, 1000);",
                "void release;"
            ].join("")
        ],
        {
            cwd: rootDir,
            env: process.env,
            stdio: "ignore",
            windowsHide: true
        }
    );
}

function killPid(pid) {
    try {
        process.kill(pid);
    } catch {
        // Already gone.
    }
}

function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error?.code === "EPERM";
    }
}

function waitForFile(path) {
    return waitUntil(() => existsSync(path));
}

function waitForChildReady(child, operation, readyPath, timeoutMs) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const timer = setInterval(() => {
            if (existsSync(readyPath)) {
                clearInterval(timer);
                resolve();
                return;
            }
            if (child.exitCode !== null || child.signalCode !== null) {
                clearInterval(timer);
                const exitCode = child.exitCode ?? "none";
                const signalCode = child.signalCode ?? "none";
                reject(new Error(`Release-lock stress child exited before becoming ready: ${operation} (exitCode=${exitCode}, signal=${signalCode}).`));
                return;
            }
            if (Date.now() - startedAt > timeoutMs) {
                clearInterval(timer);
                reject(new Error(`Timed out waiting for release-lock stress child to become ready: ${operation}.`));
            }
        }, 50);
    });
}

function waitUntil(predicate) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const timer = setInterval(() => {
            if (predicate()) {
                clearInterval(timer);
                resolve();
                return;
            }
            if (Date.now() - startedAt > 10000) {
                clearInterval(timer);
                reject(new Error("Timed out waiting for release-lock test condition."));
            }
        }, 50);
    });
}

function waitForClose(child) {
    return new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
        }
        child.once("close", resolve);
    });
}

function snapshotEnv() {
    return {
        MSPACMAN_ENABLE_TEST_PATH_OVERRIDES: process.env.MSPACMAN_ENABLE_TEST_PATH_OVERRIDES,
        MSPACMAN_RELEASE_LOCK_TOKEN: process.env.MSPACMAN_RELEASE_LOCK_TOKEN,
        MSPACMAN_TEST_RELEASE_SECRETS_DIR: process.env.MSPACMAN_TEST_RELEASE_SECRETS_DIR
    };
}

function restoreEnv(snapshot) {
    for (const [name, value] of Object.entries(snapshot)) {
        if (value === undefined) {
            delete process.env[name];
        } else {
            process.env[name] = value;
        }
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
