import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalReleaseSecretsDir } from "./build-utils.mjs";

const RELEASE_LOCK_PATH = join(canonicalReleaseSecretsDir, "release-operation.lock");

export function acquireReleaseLock(operation) {
    const inheritedToken = process.env.MSPACMAN_RELEASE_LOCK_TOKEN;
    if (inheritedToken !== undefined && inheritedToken !== "") {
        const owner = readLockOwner(RELEASE_LOCK_PATH);
        if (owner !== null && owner.token === inheritedToken) {
            return () => undefined;
        }
    }

    mkdirSync(canonicalReleaseSecretsDir, { recursive: true });
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const fd = openSync(RELEASE_LOCK_PATH, "wx", 0o600);
            const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            const owner = {
                operation,
                pid: process.pid,
                startedAt: new Date().toISOString(),
                token
            };
            writeFileSync(fd, `${JSON.stringify(owner, null, 4)}\n`);
            process.env.MSPACMAN_RELEASE_LOCK_TOKEN = token;

            let released = false;
            return () => {
                if (released) {
                    return;
                }
                released = true;
                try {
                    closeSync(fd);
                } finally {
                    const currentOwner = readLockOwner(RELEASE_LOCK_PATH);
                    if (currentOwner?.token === token) {
                        rmSync(RELEASE_LOCK_PATH, { force: true });
                    }
                    if (process.env.MSPACMAN_RELEASE_LOCK_TOKEN === token) {
                        delete process.env.MSPACMAN_RELEASE_LOCK_TOKEN;
                    }
                }
            };
        } catch (error) {
            if (error?.code !== "EEXIST") {
                throw error;
            }

            const owner = readLockOwner(RELEASE_LOCK_PATH);
            if (owner !== null && typeof owner.pid === "number" && !isProcessAlive(owner.pid)) {
                rmSync(RELEASE_LOCK_PATH, { force: true });
                continue;
            }

            throw new Error(`Another release operation is running: ${owner?.operation ?? "unknown"} (PID ${owner?.pid ?? "unknown"}).`, { cause: error });
        }
    }

    throw new Error("Unable to acquire release lock.");
}

export function readLockOwner(path = RELEASE_LOCK_PATH) {
    if (!existsSync(path)) {
        return null;
    }
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    } catch {
        return {
            operation: "unknown",
            pid: "unknown",
            token: ""
        };
    }
}

function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error?.code === "EPERM";
    }
}
