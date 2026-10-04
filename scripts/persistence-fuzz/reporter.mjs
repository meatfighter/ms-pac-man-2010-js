import { mkdirSync, lstatSync, existsSync, realpathSync, readFileSync, writeFileSync, renameSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { dirname, resolve, relative, isAbsolute, join } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { issueSignature } from "./compare.mjs";

export function assertExternalPath(directory, repo) {
    const absolute = resolve(directory),
        root = realpathSync(repo);
    let cursor = absolute;
    while (!existsSync(cursor)) cursor = dirname(cursor);
    // Reject every existing symlink ancestor, not merely the final directory.
    for (let node = cursor; ; node = dirname(node)) {
        if (lstatSync(node).isSymbolicLink()) throw new Error("Evidence path must not traverse a symlink.");
        if (dirname(node) === node) break;
    }
    const actual = resolve(realpathSync(cursor), relative(cursor, absolute));
    const inside = relative(root, actual);
    if (inside === "" || (!inside.startsWith(`..`) && !isAbsolute(inside))) throw new Error("Fuzz evidence must be outside the repository and release output.");
    const names = new Set(["jackal-js", "stickvania-js", "ms-pac-man-2010-js", "slick2d-ts"]);
    // Protect sibling checkouts too, even with nonstandard folder names.
    for (let node = cursor; ; node = dirname(node)) {
        const packageFile = join(node, "package.json");
        if (existsSync(packageFile)) {
            let name;
            try {
                name = JSON.parse(readFileSync(packageFile, "utf8")).name;
            } catch {
                /* Not a package root. */
            }
            if (names.has(name)) throw new Error("Fuzz evidence must not be inside any game or engine codebase.");
        }
        if (dirname(node) === node) break;
    }
    return absolute;
}
export class Reporter {
    constructor(directory, repo, budget = 128 * 1024 * 1024) {
        this.directory = assertExternalPath(directory, repo);
        this.budget = budget;
        this.bytes = 0;
        this.fileSizes = new Map();
        this.incomplete = false;
        this.issues = new Map();
        if (existsSync(this.directory)) throw new Error(`Refusing to reuse evidence directory: ${this.directory}`);
        mkdirSync(this.directory, { recursive: true });
        this.fd = openSync(join(this.directory, "events.jsonl"), "wx");
    }

    reserve(bytes) {
        if (this.bytes + bytes > this.budget) {
            this.incomplete = true;
            throw new Error("Evidence budget exhausted; campaign is incomplete, not passing.");
        }
        this.bytes += bytes;
    }

    event(value) {
        const text = JSON.stringify(value) + "\n";
        this.reserve(Buffer.byteLength(text));
        writeSync(this.fd, text);
        fsyncSync(this.fd);
    }

    atomic(name, value) {
        const target = join(this.directory, name);
        const data = JSON.stringify(value, null, 2) + "\n";
        const size = Buffer.byteLength(data),
            previous = this.fileSizes.get(name) ?? 0;
        this.reserve(size - previous);
        mkdirSync(dirname(target), { recursive: true });
        const tmp = `${target}.pending`;
        const file = openSync(tmp, "w");
        try {
            writeSync(file, data);
            fsyncSync(file);
        } finally {
            closeSync(file);
        }
        renameSync(tmp, target);
        this.fileSizes.set(name, size);
    }

    finding(issue, reproduction) {
        const signature = issueSignature(issue);
        let row = this.issues.get(signature);
        if (row) {
            row.occurrences++;
            return row.id;
        }
        if (this.issues.size >= 256) {
            this.incomplete = true;
            throw new Error("Unique-issue budget exhausted.");
        }
        const id = createHash("sha256").update(signature).digest("hex").slice(0, 16);
        row = { id, signature, occurrences: 1, category: issue.category, ruleCode: issue.ruleCode ?? null };
        this.issues.set(signature, row);
        // gzip is used for large snapshots; repro.json remains directly readable.
        const { snapshot, previousSnapshot, ...description } = issue;
        this.atomic(`issues/${id}/issue.json`, description);
        this.atomic(`issues/${id}/repro.json`, { ...reproduction, targetSignature: signature });
        for (const [name, value] of [
            ["snapshot", snapshot],
            ["previous-snapshot", previousSnapshot]
        ]) {
            if (value === undefined || value === null) continue;
            const bytes = gzipSync(JSON.stringify(value));
            this.reserve(bytes.length);
            writeFileSync(join(this.directory, `issues/${id}/${name}.json.gz`), bytes, { flag: "wx" });
        }
        return id;
    }

    close() {
        if (this.fd !== null) {
            fsyncSync(this.fd);
            closeSync(this.fd);
            this.fd = null;
        }
    }
}
