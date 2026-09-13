import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const mainPath = "pwa/src/mspacman/Main.ts";
const appMainPath = "pwa/src/app/main.ts";
const stateFieldPolicyPath = "pwa/src/mspacman/persistence/StateFieldPolicy.ts";

let mainSource = readFileSync(mainPath, "utf8");
let appMainSource = readFileSync(appMainPath, "utf8");
let stateFieldPolicySource = readFileSync(stateFieldPolicyPath, "utf8");

mainSource = replaceExactlyOnce(
    mainSource,
    /\nexport type WindowedDisplayModeProvider = \(\) => \{\n    width: number;\n    height: number;\n\};\n/,
    "",
    "WindowedDisplayModeProvider type"
);
mainSource = replaceExactlyOnce(
    mainSource,
    /\n    public windowedDisplayModeProvider: WindowedDisplayModeProvider \| null = null;/,
    "",
    "windowedDisplayModeProvider field"
);
mainSource = replaceExactlyOnce(
    mainSource,
    /\n    private getWindowedDisplayMode\(\): \{ width: number; height: number \} \{[\s\S]*?\n    \}\n(?=\n    private )/,
    "\n",
    "getWindowedDisplayMode method"
);
appMainSource = replaceExactlyOnce(
    appMainSource,
    /\n    mainGame\.windowedDisplayModeProvider = \(\) => viewport\.getResponsiveDisplayMode\(\);/,
    "",
    "windowedDisplayModeProvider assignment"
);
stateFieldPolicySource = replaceExactlyOnce(
    stateFieldPolicySource,
    /\n            "windowedDisplayModeProvider",/,
    "",
    "windowedDisplayModeProvider state-field policy entry"
);

for (const [label, source] of [
    [mainPath, mainSource],
    [appMainPath, appMainSource],
    [stateFieldPolicyPath, stateFieldPolicySource]
]) {
    if (source.includes("windowedDisplayModeProvider") || source.includes("WindowedDisplayModeProvider") || source.includes("getWindowedDisplayMode")) {
        throw new Error(`Obsolete windowed-display compatibility code remains in ${label}. Source was not modified.`);
    }
}

writeFileSync(mainPath, mainSource);
writeFileSync(appMainPath, appMainSource);
writeFileSync(stateFieldPolicyPath, stateFieldPolicySource);
unlinkSync(fileURLToPath(import.meta.url));
console.log(
    "Removed obsolete translated windowed-display provider/type/method/assignment/state policy. Regenerate StateFieldRegistry.generated.ts with npm run generate:state-fields."
);

function replaceExactlyOnce(text, pattern, replacement, label) {
    const globalPattern = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    const matches = [...text.matchAll(globalPattern)];
    if (matches.length !== 1) {
        throw new Error(`Expected exactly one ${label}; found ${matches.length}. Source was not modified.`);
    }
    return text.replace(pattern, replacement);
}
