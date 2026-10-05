import { issueSignature } from "./compare.mjs";
/** Bounded per-document representatives plus exact occurrence deltas. */
export class FindingBuffer {
    constructor() {
        this.groups = new Map();
        this.bytes = 0;
        this.sequence = 0;
        this.omitted = 0;
        this.reportedOmitted = 0;
    }

    add(issue) {
        const signature = issueSignature(issue);
        let variants = this.groups.get(signature);
        if (!variants) {
            if (this.groups.size >= 24) {
                this.omitted++;
                return;
            }
            this.groups.set(signature, (variants = new Map()));
        }
        const uncertain =
            !issue.path &&
            !issue.difference?.path &&
            (!issue.ruleCode || ["structure-and-graph", "loaded-resources", "values-and-audio", "entity-fields", "thing-fields"].includes(issue.ruleCode));
        // Exact variant keys avoid hash collisions; a separate byte bound caps
        // retained failure evidence (no work on successful captures).
        const hash = uncertain ? JSON.stringify(issue.snapshot ?? issue.error ?? {}) : "typed";
        let row = variants.get(hash);
        if (!row) {
            if (variants.size >= 4) {
                this.omitted++;
                return;
            }
            const bytes = JSON.stringify(issue).length * 2 + hash.length * 2;
            if (this.bytes + bytes > 8 * 1024 * 1024) {
                this.omitted++;
                return;
            }
            this.bytes += bytes;
            variants.set(hash, (row = { issue, occurrences: 0, drained: 0 }));
        }
        row.occurrences++;
    }

    values() {
        return [...this.groups.values()].flatMap((variants) => [...variants.values()].map((row) => ({ ...row.issue, occurrences: row.occurrences })));
    }

    drain() {
        const rows = [];
        for (const variants of this.groups.values())
            for (const row of variants.values()) {
                if (row.occurrences === row.drained) continue;
                rows.push({ ...row.issue, occurrences: row.occurrences - row.drained, sequence: ++this.sequence });
                row.drained = row.occurrences;
            }
        if (this.omitted > this.reportedOmitted) {
            rows.push({ category: "FINDING_EVIDENCE_LIMIT", phase: "evidence", omitted: this.omitted - this.reportedOmitted, sequence: ++this.sequence });
            this.reportedOmitted = this.omitted;
        }
        return rows;
    }
}
