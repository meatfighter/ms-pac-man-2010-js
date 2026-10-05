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
        this.deliveries = new Map();
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
        const delivery = issue.evidenceId;
        if (delivery && this.deliveries.has(delivery)) return this.deliveries.get(delivery);
        const signature = issueSignature(issue);
        let row = this.issues.get(signature);
        if (row) {
            row.occurrences += issue.occurrences ?? 1;
            this.retainVariant(row, issue);
            this.event({ event: "finding-delivery", evidenceId: delivery, ...row });
            if (delivery) this.deliveries.set(delivery, row.id);
            return row.id;
        }
        if (this.issues.size >= 256) {
            this.incomplete = true;
            throw new Error("Unique-issue budget exhausted.");
        }
        const id = createHash("sha256").update(signature).digest("hex").slice(0, 16);
        row = { id, signature, occurrences: issue.occurrences ?? 1, category: issue.category, ruleCode: issue.ruleCode ?? null };
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
            writeFileSync(join(this.directory, `issues/${id}/${name}.json.gz`), bytes, { flag: "wx", flush: true });
        }
        row.variants = [];
        row.omittedVariants = 0;
        this.retainVariant(row, issue);
        this.event({ event: "finding-delivery", evidenceId: delivery, ...row });
        if (delivery) this.deliveries.set(delivery, id);
        return id;
    }

    retainVariant(row, issue) {
        // Boolean gates are uncertain families, not proven root causes.
        if (
            issue.path ||
            issue.difference?.path ||
            (issue.ruleCode && !["structure-and-graph", "loaded-resources", "values-and-audio", "thing-fields", "entity-fields"].includes(issue.ruleCode))
        )
            return;
        const bytes = JSON.stringify(issue.snapshot ?? issue);
        const hash = createHash("sha256").update(bytes).digest("hex");
        if (row.variants?.includes(hash)) return;
        row.variants ??= [];
        if (row.variants.length >= 4) {
            row.omittedVariants++;
            return;
        }
        const zipped = gzipSync(bytes);
        this.reserve(zipped.length);
        writeFileSync(join(this.directory, `issues/${row.id}/variant-${hash}.json.gz`), zipped, { flag: "wx", flush: true });
        row.variants.push(hash);
    }

    terminal(summary) {
        // Dedicated 16 KiB terminal allowance does not consume normal evidence.
        // Absence of this receipt always means incomplete, regardless of summary.json.
        const summaryBytes = existsSync(join(this.directory, "summary.json")) ? readFileSync(join(this.directory, "summary.json")) : null;
        const receipt = {
            formatVersion: 2,
            status: summary.status,
            exitCode: summary.exitCode,
            planCompleted: summary.planCompleted,
            stopReason: summary.stopReason,
            completedCases: summary.completed,
            integrityVerified: summary.integrityVerified,
            evidenceIncomplete: this.incomplete || summary.evidenceIncomplete,
            summarySha256: summaryBytes ? createHash("sha256").update(summaryBytes).digest("hex") : null
        };
        if (receipt.evidenceIncomplete && receipt.exitCode !== 130) {
            receipt.status = "incomplete";
            receipt.exitCode = 2;
        }
        const text = JSON.stringify(receipt, null, 2) + "\n";
        if (Buffer.byteLength(text) > 16384) throw new Error("Terminal receipt exceeded reserved allowance");
        const target = join(this.directory, "terminal.json");
        const fd = openSync(`${target}.pending`, "w");
        try {
            writeSync(fd, text);
            fsyncSync(fd);
        } finally {
            closeSync(fd);
        }
        renameSync(`${target}.pending`, target);
        return receipt;
    }

    close() {
        if (this.fd !== null) {
            fsyncSync(this.fd);
            closeSync(this.fd);
            this.fd = null;
        }
    }
}
