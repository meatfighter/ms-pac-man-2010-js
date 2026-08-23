import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";
import { getReleaseSecretsDir } from "./hmac-config.mjs";
import { writeTextFileAtomically } from "./release-io.mjs";

const STALE_MALFORMED_LOCK_MS = 5 * 60 * 1000;
const STALE_UPDATE_GUARD_MS = 30 * 1000;
const UPDATE_GUARD_RETRY_MS = 20;
const UPDATE_GUARD_TIMEOUT_MS = 10 * 1000;

export function acquireReleaseLock(operation) {
    const lockPath = getReleaseLockPath();
    const inheritedToken = process.env.MSPACMAN_RELEASE_LOCK_TOKEN;
    if (inheritedToken !== undefined && inheritedToken !== "") {
        const owner = readLockOwner(lockPath);
        if (owner.valid && owner.record.token === inheritedToken) {
            registerHolder(lockPath, inheritedToken, operation);
            let released = false;
            return () => {
                if (released) {
                    return;
                }
                released = true;
                unregisterHolder(lockPath, inheritedToken, process.pid);
            };
        }
    }

    mkdirSync(getReleaseSecretsDir(), { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 2; attempt++) {
        const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        try {
            createLockFile(lockPath, createLockRecord(token, operation));
            process.env.MSPACMAN_RELEASE_LOCK_TOKEN = token;

            let released = false;
            return () => {
                if (released) {
                    return;
                }
                released = true;
                unregisterHolder(lockPath, token, process.pid);
                if (process.env.MSPACMAN_RELEASE_LOCK_TOKEN === token) {
                    delete process.env.MSPACMAN_RELEASE_LOCK_TOKEN;
                }
            };
        } catch (error) {
            if (error?.code !== "EEXIST") {
                throw error;
            }
            if (recoverStaleLockIfPossible(lockPath)) {
                continue;
            }

            const owner = readLockOwner(lockPath);
            throw new Error(formatLockBusyMessage(owner), { cause: error });
        }
    }

    throw new Error("Unable to acquire release lock.");
}

export function readLockOwner(path = getReleaseLockPath()) {
    if (!existsSync(path)) {
        return {
            record: null,
            valid: false
        };
    }

    try {
        const record = JSON.parse(readFileSync(path, "utf8"));
        validateLockRecord(record);
        return {
            record,
            valid: true
        };
    } catch (error) {
        return {
            error,
            record: null,
            valid: false
        };
    }
}

export function getReleaseLockPath() {
    return join(getReleaseSecretsDir(), "release-operation.lock");
}

function createLockRecord(token, operation) {
    return {
        holders: [
            {
                operation,
                pid: process.pid
            }
        ],
        schemaVersion: 1,
        startedAt: new Date().toISOString(),
        token
    };
}

function createLockFile(lockPath, record) {
    let fd;
    try {
        fd = openSync(lockPath, "wx", 0o600);
        writeSync(fd, `${JSON.stringify(record, null, 4)}\n`, null, "utf8");
        fsyncSync(fd);
    } finally {
        if (fd !== undefined) {
            closeSync(fd);
        }
    }
}

function registerHolder(lockPath, token, operation) {
    withLockRecordUpdate(lockPath, () => {
        const owner = readLockOwner(lockPath);
        if (!owner.valid || owner.record.token !== token) {
            throw new Error("Inherited release lock is no longer owned by this release operation.");
        }

        const holders = owner.record.holders.filter((holder) => holder.pid !== process.pid);
        holders.push({
            operation,
            pid: process.pid
        });
        writeLockRecord(lockPath, {
            ...owner.record,
            holders
        });
    });
}

function unregisterHolder(lockPath, token, pid) {
    withLockRecordUpdate(lockPath, () => {
        const owner = readLockOwner(lockPath);
        if (!owner.valid || owner.record.token !== token) {
            return;
        }

        const holders = owner.record.holders.filter((holder) => holder.pid !== pid && isProcessAlive(holder.pid));
        if (holders.length === 0) {
            rmSync(lockPath, { force: true });
            return;
        }

        writeLockRecord(lockPath, {
            ...owner.record,
            holders
        });
    });
}

function writeLockRecord(lockPath, record) {
    writeTextFileAtomically(lockPath, `${JSON.stringify(record, null, 4)}\n`, {
        mode: 0o600
    });
}

function recoverStaleLockIfPossible(lockPath) {
    return withLockRecordUpdate(lockPath, () => {
        if (!existsSync(lockPath)) {
            return true;
        }

        const owner = readLockOwner(lockPath);
        if (!owner.valid) {
            if (isMalformedLockStale(lockPath)) {
                rmSync(lockPath, { force: true });
                console.warn(`Recovered stale malformed release lock: ${lockPath}`);
                return true;
            }
            return false;
        }

        const liveHolders = owner.record.holders.filter((holder) => isProcessAlive(holder.pid));
        if (liveHolders.length > 0) {
            return false;
        }

        rmSync(lockPath, { force: true });
        console.warn(`Recovered stale release lock: ${owner.record.holders.map((holder) => `${holder.operation} (${holder.pid})`).join(", ")}`);
        return true;
    });
}

function withLockRecordUpdate(lockPath, fn) {
    const guardPath = `${lockPath}.update`;
    const releaseGuard = acquireLockUpdateGuard(guardPath);
    try {
        return fn();
    } finally {
        releaseGuard();
    }
}

function acquireLockUpdateGuard(guardPath) {
    const startedAt = Date.now();
    while (true) {
        try {
            createLockFile(guardPath, {
                holderPid: process.pid,
                schemaVersion: 1,
                startedAt: new Date().toISOString()
            });
            let released = false;
            return () => {
                if (released) {
                    return;
                }
                released = true;
                rmSync(guardPath, { force: true });
            };
        } catch (error) {
            if (error?.code !== "EEXIST") {
                throw error;
            }
            if (recoverStaleUpdateGuardIfPossible(guardPath)) {
                continue;
            }
            if (Date.now() - startedAt > UPDATE_GUARD_TIMEOUT_MS) {
                throw new Error(`Timed out waiting for release lock update guard: ${guardPath}`, { cause: error });
            }
            sleepSync(UPDATE_GUARD_RETRY_MS);
        }
    }
}

function recoverStaleUpdateGuardIfPossible(guardPath) {
    if (!existsSync(guardPath)) {
        return true;
    }

    try {
        const owner = JSON.parse(readFileSync(guardPath, "utf8"));
        if (Number.isInteger(owner.holderPid) && isProcessAlive(owner.holderPid)) {
            return false;
        }
        if (Number.isInteger(owner.holderPid)) {
            rmSync(guardPath, { force: true });
            console.warn(`Recovered stale release lock update guard: ${guardPath}`);
            return true;
        }
    } catch (error) {
        if (error?.code === "ENOENT") {
            return true;
        }

        // Malformed guards fall through to mtime-based stale recovery.
    }

    let mtimeMs;
    try {
        mtimeMs = statSync(guardPath).mtimeMs;
    } catch (error) {
        if (error?.code === "ENOENT") {
            return true;
        }
        throw error;
    }

    if (Date.now() - mtimeMs <= STALE_UPDATE_GUARD_MS) {
        return false;
    }

    rmSync(guardPath, { force: true });
    console.warn(`Recovered stale release lock update guard: ${guardPath}`);
    return true;
}

function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isMalformedLockStale(lockPath) {
    try {
        return Date.now() - statSync(lockPath).mtimeMs > STALE_MALFORMED_LOCK_MS;
    } catch {
        return false;
    }
}

function formatLockBusyMessage(owner) {
    if (!owner.valid) {
        return "Another release operation is running or a fresh malformed release lock is present.";
    }

    const liveHolders = owner.record.holders.filter((holder) => isProcessAlive(holder.pid));
    const holders = liveHolders.length === 0 ? owner.record.holders : liveHolders;
    return `Another release operation is running: ${holders.map((holder) => `${holder.operation} (PID ${holder.pid})`).join(", ")}.`;
}

function validateLockRecord(record) {
    if (record?.schemaVersion !== 1 || typeof record.token !== "string" || record.token === "" || !Array.isArray(record.holders)) {
        throw new Error("Malformed release lock.");
    }

    for (const holder of record.holders) {
        if (!Number.isInteger(holder?.pid) || holder.pid <= 0 || typeof holder.operation !== "string" || holder.operation === "") {
            throw new Error("Malformed release lock holder.");
        }
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
