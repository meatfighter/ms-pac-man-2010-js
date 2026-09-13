import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const mainPath = "pwa/src/mspacman/Main.ts";
const stateTestPath = "scripts/test-pwa-state.mjs";
const stylesPath = "pwa/src/app/styles.css";

let mainSource = readFileSync(mainPath, "utf8");
let stateTestSource = readFileSync(stateTestPath, "utf8");
let stylesSource = readFileSync(stylesPath, "utf8");

mainSource = replaceExactlyOnce(
    mainSource,
    /\n            this\.fullScreenToggleCheck\(gc\);/,
    "",
    "fullScreenToggleCheck call"
);
mainSource = replaceExactlyOnce(
    mainSource,
    /\n    private fullScreenToggleCheck\(gc: GameContainer\): void \{[\s\S]*?\n    \}\n(?=\n    (?:private|public|protected) )/,
    "\n",
    "fullScreenToggleCheck method"
);

for (const forbidden of ["fullScreenToggleCheck", "isFullscreenTogglePressed", "isFullscreenExitPressed"]) {
    if (mainSource.includes(forbidden)) {
        throw new Error(`Cleanup incomplete: ${forbidden} still exists in ${mainPath}`);
    }
}

stateTestSource = replaceTextExactlyOnce(
    stateTestSource,
    'await runTest("obsolete and future saves remain untouched by inspection while explicit writes stay explicit", () => {',
    'await runTest("future saves remain untouched by inspection while explicit writes stay explicit", () => {',
    "old-schema test title"
);
stateTestSource = replaceExactlyOnce(
    stateTestSource,
    /\n        const obsoleteSnapshot = JSON\.stringify\(\{ version: 4 \}\);\n        storage\.setItem\(storageKey, obsoleteSnapshot\);\n        assert\.equal\(store\.hasValidSave\(\), false\);\n        assert\.equal\(storage\.getItem\(storageKey\), obsoleteSnapshot\);\n/,
    "\n",
    "obsolete v4 save fixture"
);
if (/\bobsoleteSnapshot\b|\bversion:\s*4\b/.test(stateTestSource)) {
    throw new Error(`Old development save fixture still exists in ${stateTestPath}`);
}

stylesSource = replaceExactlyOnce(
    stylesSource,
    /\.fullscreen-switch:disabled \{\n    border-color: #5b2448;\n    background: #5b2448;/,
    ".fullscreen-switch:disabled {\n    border-color: #6f6501;\n    background: #6f6501;",
    "disabled fullscreen track colors"
);
stylesSource = replaceExactlyOnce(
    stylesSource,
    /\.fullscreen-switch:disabled span \{\n    background: #111111;/,
    ".fullscreen-switch:disabled span {\n    background: #191405;",
    "disabled fullscreen thumb color"
);

writeFileSync(mainPath, mainSource);
writeFileSync(stateTestPath, stateTestSource);
writeFileSync(stylesPath, stylesSource);
unlinkSync(fileURLToPath(import.meta.url));
console.log("Removed obsolete Ms. Pac-Man browser fullscreen code and pre-release save-schema fixture; aligned unavailable Fullscreen styling; cleanup helper deleted itself.");

function replaceExactlyOnce(text, pattern, replacement, label) {
    const globalPattern = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    const matches = [...text.matchAll(globalPattern)];
    if (matches.length !== 1) {
        throw new Error(`Expected exactly one ${label}; found ${matches.length}. Source was not modified.`);
    }
    return text.replace(pattern, replacement);
}

function replaceTextExactlyOnce(text, search, replacement, label) {
    const first = text.indexOf(search);
    const last = text.lastIndexOf(search);
    if (first < 0 || first !== last) {
        throw new Error(`Expected exactly one ${label}; found ${first < 0 ? 0 : "multiple"}. Source was not modified.`);
    }
    return text.replace(search, replacement);
}
