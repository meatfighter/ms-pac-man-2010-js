import {
    closeSync,
    constants,
    copyFileSync,
    existsSync,
    fsyncSync,
    lstatSync,
    mkdirSync,
    openSync,
    readdirSync,
    realpathSync,
    renameSync,
    rmSync,
    writeSync
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

const ATOMIC_RENAME_RETRYABLE_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);
const ATOMIC_RENAME_MAX_RETRIES = 50;
const ATOMIC_RENAME_RETRY_DELAY_MS = 10;

export function fsyncDirectoryIfSupported(path) {
    if (process.platform === "win32") {
        return;
    }

    const fd = openSync(path, "r");
    try {
        fsyncSync(fd);
    } finally {
        closeSync(fd);
    }
}

export function writeTextFileAtomically(path, text, { failPhase = "", mode = 0o600, renameFile = renameSync } = {}) {
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const temp = join(dir, `.${basename(path)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    let fd;
    let renamed = false;

    try {
        maybeFailAtomicWrite(failPhase, "before-create");
        fd = openSync(temp, "wx", mode);
        maybeFailAtomicWrite(failPhase, "after-create");
        writeSync(fd, text, null, "utf8");
        maybeFailAtomicWrite(failPhase, "after-write");
        fsyncSync(fd);
        maybeFailAtomicWrite(failPhase, "after-fsync");
        closeSync(fd);
        fd = undefined;
        maybeFailAtomicWrite(failPhase, "before-rename");
        renameFileWithRetry(temp, path, renameFile);
        renamed = true;
        maybeFailAtomicWrite(failPhase, "after-rename");
        fsyncDirectoryIfSupported(dir);
    } catch (error) {
        if (fd !== undefined) {
            try {
                closeSync(fd);
            } catch {
                // Preserve the original error.
            }
        }
        if (!renamed) {
            rmSync(temp, { force: true });
        }
        throw error;
    }
}

export function copyFileAtomically(source, destination) {
    const dir = dirname(destination);
    mkdirSync(dir, { recursive: true });
    const temp = join(dir, `.${basename(destination)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    try {
        copyFileSync(source, temp, constants.COPYFILE_EXCL);
        const fd = openSync(temp, "r+");
        try {
            fsyncSync(fd);
        } finally {
            closeSync(fd);
        }
        renameFileWithRetry(temp, destination);
        fsyncDirectoryIfSupported(dir);
    } catch (error) {
        rmSync(temp, { force: true });
        throw error;
    }
}

function renameFileWithRetry(source, destination, renameFile = renameSync) {
    for (let retries = 0; ; retries++) {
        try {
            renameFile(source, destination);
            return;
        } catch (error) {
            if (!ATOMIC_RENAME_RETRYABLE_CODES.has(error?.code) || retries >= ATOMIC_RENAME_MAX_RETRIES) {
                throw error;
            }
            sleepSync(ATOMIC_RENAME_RETRY_DELAY_MS);
        }
    }
}

function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function listFilesStrict(root, description = "Release output") {
    const rootStat = lstatIfPresent(root);
    if (rootStat === null) {
        return [];
    }
    if (rootStat.isSymbolicLink()) {
        throw new Error(`${description} root must not be a symlink or junction: ${root}`);
    }
    if (!rootStat.isDirectory()) {
        throw new Error(`${description} root must be a directory: ${root}`);
    }
    const files = [];
    collectFilesStrict(root, root, files, description);
    return files;
}

export function assertNoLinkTraversal(targetPath, managedRoot, description) {
    const root = resolve(managedRoot);
    const target = resolve(targetPath);
    const rel = relative(root, target);

    if (rel.startsWith("..") || isAbsolute(rel)) {
        throw new Error(`${description} escapes managed root: ${target}`);
    }

    let cursor = root;
    const segments = rel === "" ? [] : rel.split(/[\\/]/);
    for (const segment of ["", ...segments]) {
        if (segment !== "") {
            cursor = join(cursor, segment);
        }

        const stat = lstatIfPresent(cursor);
        if (stat === null) {
            break;
        }
        if (stat.isSymbolicLink()) {
            throw new Error(`${description} must not traverse a symlink or junction: ${cursor}`);
        }
    }

    const physicalRoot = resolvePhysicalPath(root);
    const physicalTarget = resolvePhysicalPath(target);
    const physicalRel = relative(physicalRoot, physicalTarget);
    if (physicalRel.startsWith("..") || isAbsolute(physicalRel)) {
        throw new Error(`${description} physically escapes managed root.`);
    }
}

export function resolvePhysicalPath(path) {
    const absolute = resolve(path);
    let cursor = absolute;
    const missing = [];

    while (!existsSync(cursor)) {
        const parent = dirname(cursor);
        if (parent === cursor) {
            break;
        }
        missing.unshift(basename(cursor));
        cursor = parent;
    }

    const physicalBase = realpathSync.native(cursor);
    return resolve(physicalBase, ...missing);
}

function lstatIfPresent(path) {
    try {
        return lstatSync(path);
    } catch (error) {
        if (error?.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}

function collectFilesStrict(root, dir, files, description) {
    for (const entry of readdirSync(dir).sort((a, b) => a.localeCompare(b))) {
        const path = join(dir, entry);
        const stat = lstatSync(path);
        const relativePath = relative(root, path).replaceAll("\\", "/");
        if (stat.isSymbolicLink()) {
            throw new Error(`${description} must not contain symbolic links or junctions: ${relativePath}`);
        }
        if (stat.isDirectory()) {
            collectFilesStrict(root, path, files, description);
            continue;
        }
        if (!stat.isFile()) {
            throw new Error(`${description} contains unsupported filesystem entry: ${relativePath}`);
        }
        files.push(path);
    }
}

function maybeFailAtomicWrite(requestedPhase, phase) {
    const configuredPhase = process.env.MSPACMAN_TEST_FAIL_ATOMIC_WRITE_PHASE;
    if (requestedPhase !== "" && configuredPhase === requestedPhase) {
        throw new Error(`Injected atomic write failure: ${requestedPhase}`);
    }
    if (configuredPhase === phase) {
        throw new Error(`Injected atomic write failure: ${phase}`);
    }
}
