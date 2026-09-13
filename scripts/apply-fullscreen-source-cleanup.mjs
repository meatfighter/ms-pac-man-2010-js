import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const mainPath = "pwa/src/mspacman/Main.ts";
const appMainPath = "pwa/src/app/main.ts";
const lifecycleStressPath = "scripts/run-lifecycle-stress-qualification.mjs";
const stateTestPath = "scripts/test-pwa-state.mjs";
const stateFieldPolicyPath = "pwa/src/mspacman/persistence/StateFieldPolicy.ts";
const stylesPath = "pwa/src/app/styles.css";

let mainSource = readFileSync(mainPath, "utf8");
let appMainSource = readFileSync(appMainPath, "utf8");
let lifecycleStressSource = readFileSync(lifecycleStressPath, "utf8");
let stateTestSource = readFileSync(stateTestPath, "utf8");
let stateFieldPolicySource = readFileSync(stateFieldPolicyPath, "utf8");
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
mainSource = replaceExactlyOnce(mainSource, /\n    public nativeCursor: unknown;/, "", "nativeCursor field");
mainSource = replaceExactlyOnce(
    mainSource,
    /\n    private showMouseCursor\(\): void \{\}\n\n    private hideMouseCursor\(\): void \{\}/,
    "",
    "translated cursor fullscreen helpers"
);

for (const forbidden of [
    "fullScreenToggleCheck",
    "isFullscreenTogglePressed",
    "isFullscreenExitPressed",
    "showMouseCursor",
    "hideMouseCursor",
    "nativeCursor"
]) {
    if (mainSource.includes(forbidden)) {
        throw new Error(`Cleanup incomplete: ${forbidden} still exists in ${mainPath}`);
    }
}

appMainSource = replaceTextExactlyOnce(
    appMainSource,
    '                <div class="setting-fullscreen-row" role="group" aria-label="Fullscreen">\n                    <span>Fullscreen</span>\n                    <button id="fullscreen-switch-button" class="menu-switch fullscreen-switch" type="button" aria-label="Toggle fullscreen" aria-pressed="${fullscreenPresented}" data-enabled="${fullscreenPresented}"${fullscreenUnavailable ? \' disabled title="Fullscreen is unavailable in this browser"\' : ""}><span></span></button>\n                </div>\n                <div class="setting-scaling-row" role="group" aria-label="Scaling">\n                    <span>Scaling</span>\n                    ${scalingPickerHtml()}\n                </div>',
    '                <div class="settings-row settings-fullscreen-scaling-row">\n                    <div class="setting-fullscreen-row" role="group" aria-label="Fullscreen">\n                        <span>Fullscreen</span>\n                        <button id="fullscreen-switch-button" class="menu-switch fullscreen-switch" type="button" aria-label="Toggle fullscreen" aria-pressed="${fullscreenPresented}" data-enabled="${fullscreenPresented}"${fullscreenUnavailable ? \' disabled title="Fullscreen is unavailable in this browser"\' : ""}><span></span></button>\n                    </div>\n                    <div class="setting-scaling-row" role="group" aria-label="Scaling">\n                        <span>Scaling</span>\n                        ${scalingPickerHtml()}\n                    </div>\n                </div>',
    "Fullscreen/Scaling responsive settings group"
);

lifecycleStressSource = replaceTextExactlyOnce(
    lifecycleStressSource,
    '    if (finalLifecycle.wakeInstrumented) {\n        assert.ok(finalLifecycle.wakeLive <= 1, `Wake-lock sentinels accumulated: ${JSON.stringify(finalLifecycle)}`);\n    }',
    '    if (finalLifecycle.wakeInstrumented) {\n        assert.ok(finalLifecycle.wakeLive <= 1, `Wake-lock sentinels accumulated: ${JSON.stringify(finalLifecycle)}`);\n        assert.equal(\n            finalLifecycle.wakeAcquired - finalLifecycle.wakeReleased,\n            finalLifecycle.wakeLive,\n            `Wake-lock acquisition/release accounting is unbalanced: ${JSON.stringify(finalLifecycle)}`\n        );\n    }',
    "exact wake-lock accounting assertion"
);

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

stateFieldPolicySource = replaceExactlyOnce(
    stateFieldPolicySource,
    /\n            "nativeCursor",/,
    "",
    "nativeCursor state-field policy entry"
);
if (stateFieldPolicySource.includes('"nativeCursor"')) {
    throw new Error(`Obsolete fullscreen state-field policy still exists in ${stateFieldPolicyPath}`);
}

stylesSource = replaceTextExactlyOnce(
    stylesSource,
    ".menu-actions {\n    display: grid;\n    gap: 25px;\n    justify-items: center;\n}\n",
    ".menu-actions {\n    display: grid;\n    gap: 25px;\n    justify-items: center;\n}\n\n.settings-row {\n    display: flex;\n    width: min(480px, 100%);\n    flex-wrap: wrap;\n    align-items: center;\n    justify-content: center;\n    gap: 20px 24px;\n}\n\n.settings-row > .setting-fullscreen-row,\n.settings-row > .setting-scaling-row {\n    flex: 0 0 auto;\n}\n",
    "responsive settings-row CSS"
);
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
writeFileSync(appMainPath, appMainSource);
writeFileSync(lifecycleStressPath, lifecycleStressSource);
writeFileSync(stateTestPath, stateTestSource);
writeFileSync(stateFieldPolicyPath, stateFieldPolicySource);
writeFileSync(stylesPath, stylesSource);
unlinkSync(fileURLToPath(import.meta.url));
console.log(
    "Removed obsolete Ms. Pac-Man browser fullscreen/cursor code and pre-release save-schema fixture; removed stale state-field policy; grouped Fullscreen/Scaling responsively; strengthened wake-lock accounting; aligned unavailable Fullscreen styling; cleanup helper deleted itself. Regenerate StateFieldRegistry.generated.ts with npm run generate:state-fields before qualification."
);

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
