import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { sourceIdentity } from "./identity.mjs";
import { assertExternalPath } from "./reporter.mjs";

export const semanticCommands = {
    "jackal-js": {
        producers: ["--loader", "./scripts/persistence-fuzz/typescript-loader.mjs", "--test", "scripts/persistence-fuzz/validator-repairs.test.mjs"],
        browser: ["scripts/run-browser-verification.mjs"],
        boundaries: ["scripts/run-game-mode-persistence-qualification.mjs"],
        departure: ["scripts/run-departure-save-qualification.mjs"]
    },
    "stickvania-js": {
        producers: ["--loader", "./scripts/persistence-fuzz/typescript-loader.mjs", "--test", "scripts/persistence-fuzz/validator-repairs.test.mjs"],
        browser: ["scripts/run-browser-verification.mjs"],
        departure: ["scripts/run-departure-save-qualification.mjs"],
        pit: ["scripts/run-save-pit-verification.mjs"],
        castle: ["scripts/run-rumble-castle-qualification.mjs"]
    },
    "ms-pac-man-2010-js": {
        producers: ["--loader", "./scripts/persistence-fuzz/typescript-loader.mjs", "--test", "scripts/persistence-fuzz/validator-repairs.test.mjs"],
        browser: ["scripts/run-browser-verification.mjs"],
        ghosts: ["scripts/run-ghost-house-verification.mjs"],
        departure: ["scripts/run-departure-save-qualification.mjs"]
    }
};
export function semanticDirectory(repo, identity) {
    return assertExternalPath(
        resolve(repo, "..", "qualification-evidence", "persistence-semantic-floor", JSON.parse(readFileSync(join(repo, "package.json"))).name, identity.digest),
        repo
    );
}
export function readSemanticFloor(repo, identity) {
    const game = JSON.parse(readFileSync(join(repo, "package.json"))).name,
        directory = semanticDirectory(repo, identity),
        receipts = [];
    if (existsSync(directory))
        for (const name of readdirSync(directory)) {
            if (!name.endsWith(".json")) continue;
            const bytes = readFileSync(join(directory, name)),
                row = JSON.parse(bytes);
            if (
                row.formatVersion === 2 &&
                row.exitCode === 0 &&
                row.sourceDigest === identity.digest &&
                row.engineDigest === identity.engineDigest &&
                JSON.stringify(row.command) === JSON.stringify(semanticCommands[game][row.group])
            )
                receipts.push({ ...row, path: join(directory, name), sha256: createHash("sha256").update(bytes).digest("hex") });
        }
    const missing = Object.keys(semanticCommands[game]).filter((group) => !receipts.some((row) => row.group === group));
    return { formatVersion: 2, receipts, missing };
}
export function writeSemanticReceipt(repo, before, group, command, result) {
    const after = sourceIdentity(repo);
    if (before.digest !== after.digest || before.engineDigest !== after.engineDigest) throw new Error("Semantic fixture changed source/engine identity");
    const directory = semanticDirectory(repo, before);
    mkdirSync(directory, { recursive: true });
    const receipt = {
        formatVersion: 2,
        group,
        command,
        exitCode: result,
        sourceDigest: before.digest,
        engineDigest: before.engineDigest,
        gitCommit: before.gitCommit,
        nodeVersion: process.version,
        completedAt: new Date().toISOString(),
        evidenceDirectory: process.env.QUALIFICATION_EVIDENCE_DIR ?? null
    };
    writeFileSync(join(directory, `${group}-${randomUUID()}.json`), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
    return receipt;
}
