import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { sourceIdentity } from "./identity.mjs";
import { semanticCommands, writeSemanticReceipt } from "./semantic-floor.mjs";
const repo = process.cwd(),
    game = JSON.parse(readFileSync("package.json")).name,
    group = process.argv[2];
const command = semanticCommands[game]?.[group];
if (!command || process.argv.length !== 3) throw new Error("Unknown semantic fixture group");
for (const [name, value] of Object.entries(process.env))
    if (value && (/^QUALIFICATION_SKIP_/.test(name) || ["TEST_FILTER", "TEST_PATTERN", "PAC_BROWSER_SUITE", "STICKVANIA_BROWSER_SUITE"].includes(name)))
        throw new Error(`Semantic floor cannot credit filtered fixture: ${name}`);
const before = sourceIdentity(repo);
const result = spawnSync(process.execPath, command, { stdio: "inherit", windowsHide: true });
if (result.error) throw result.error;
writeSemanticReceipt(repo, before, group, command, result.status ?? 2);
process.exitCode = result.status ?? 2;
