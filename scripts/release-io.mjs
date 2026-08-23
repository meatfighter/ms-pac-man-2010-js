import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, realpathSync, renameSync, writeSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

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

export function writeTextFileAtomically(path, text, { failPhase = "", mode = 0o600 } = {}) {
    if (failPhase !== "") {
        maybeFailAtomicWrite(failPhase);
    }

    const dir = dirname(path);
    mkdirSync(dir, { recursive: true });
    const temp = join(dir, `.${basename(path)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const fd = openSync(temp, "wx", mode);
    try {
        writeSync(fd, text, null, "utf8");
        fsyncSync(fd);
    } finally {
        closeSync(fd);
    }
    renameSync(temp, path);
    fsyncDirectoryIfSupported(dir);
}

export function listFilesStrict(root, description = "Release output") {
    if (!existsSync(root)) {
        return [];
    }
    const files = [];
    collectFilesStrict(root, root, files, description);
    return files;
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

function maybeFailAtomicWrite(phase) {
    if (process.env.MSPACMAN_TEST_FAIL_ATOMIC_WRITE_PHASE === phase) {
        throw new Error(`Injected atomic write failure: ${phase}`);
    }
}
