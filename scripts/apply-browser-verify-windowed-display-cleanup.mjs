import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = "pwa/src/browser-verify.ts";
let source = readFileSync(path, "utf8");
const obsolete = '    main.windowedDisplayModeProvider = () => ({ width: 1000, height: 750 });\n';
const first = source.indexOf(obsolete);
const last = source.lastIndexOf(obsolete);
if (first < 0 || first !== last) {
    throw new Error(`Expected exactly one obsolete browser verification windowedDisplayModeProvider assignment; found ${first < 0 ? 0 : "multiple"}. Source was not modified.`);
}
source = source.replace(obsolete, "");
writeFileSync(path, source);
unlinkSync(fileURLToPath(import.meta.url));
console.log("Removed obsolete browser verification windowedDisplayModeProvider assignment and deleted the one-shot helper.");
