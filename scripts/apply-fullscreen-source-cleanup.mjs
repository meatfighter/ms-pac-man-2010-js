import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const targetPath = "pwa/src/mspacman/Main.ts";
let source = readFileSync(targetPath, "utf8");

source = replaceExactlyOnce(
    source,
    /\n            this\.fullScreenToggleCheck\(gc\);/,
    "",
    "fullScreenToggleCheck call"
);
source = replaceExactlyOnce(
    source,
    /\n    private fullScreenToggleCheck\(gc: GameContainer\): void \{[\s\S]*?\n    \}\n(?=\n    (?:private|public|protected) )/,
    "\n",
    "fullScreenToggleCheck method"
);

for (const forbidden of ["fullScreenToggleCheck", "isFullscreenTogglePressed", "isFullscreenExitPressed"]) {
    if (source.includes(forbidden)) {
        throw new Error(`Cleanup incomplete: ${forbidden} still exists in ${targetPath}`);
    }
}

writeFileSync(targetPath, source);
unlinkSync(fileURLToPath(import.meta.url));
console.log(`Removed obsolete PWA fullscreen machinery from ${targetPath}; cleanup helper deleted itself.`);

function replaceExactlyOnce(text, pattern, replacement, label) {
    const globalPattern = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    const matches = [...text.matchAll(globalPattern)];
    if (matches.length !== 1) {
        throw new Error(`Expected exactly one ${label}; found ${matches.length}. Source was not modified.`);
    }
    return text.replace(pattern, replacement);
}
