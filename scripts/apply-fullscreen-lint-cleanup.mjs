import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const qualificationPath = "scripts/run-fullscreen-qualification.mjs";
const reentryPath = "scripts/run-fullscreen-reentry-qualification.mjs";
const settingsPath = "scripts/run-fullscreen-settings-qualification.mjs";
const timeoutPath = "scripts/run-fullscreen-timeout-qualification.mjs";
const fullscreenControlsPath = "scripts/test-browser-fullscreen-controls.mjs";
const machineryPath = "scripts/test-pwa-machinery-hardening.mjs";

let qualificationSource = readFileSync(qualificationPath, "utf8");
let reentrySource = readFileSync(reentryPath, "utf8");
let settingsSource = readFileSync(settingsPath, "utf8");
let timeoutSource = readFileSync(timeoutPath, "utf8");
let fullscreenControlsSource = readFileSync(fullscreenControlsPath, "utf8");
let machinerySource = readFileSync(machineryPath, "utf8");

qualificationSource = replaceTextExactlyOnce(
    qualificationSource,
    "/* global document, navigator, window, HTMLElement */",
    "/* global document, window, HTMLElement */",
    "fullscreen qualification global declaration"
);
qualificationSource = addSyntheticFullscreenSetter(qualificationSource, 12, "fullscreen qualification setter");
qualificationSource = replaceTextExactlyCount(
    qualificationSource,
    "fullscreenElement = this;",
    "setSyntheticFullscreenElement(this);",
    3,
    "fullscreen qualification this aliases"
);

reentrySource = replaceTextExactlyOnce(
    reentrySource,
    "/* global document, navigator, window, HTMLElement */",
    "/* global document, window, HTMLElement */",
    "fullscreen reentry global declaration"
);
reentrySource = addSyntheticFullscreenSetter(reentrySource, 8, "fullscreen reentry setter");
reentrySource = replaceTextExactlyCount(
    reentrySource,
    "fullscreenElement = this;",
    "setSyntheticFullscreenElement(this);",
    2,
    "fullscreen reentry this aliases"
);

settingsSource = replaceTextExactlyOnce(
    settingsSource,
    "/* global document, navigator, window, HTMLElement, EventTarget */",
    "/* global document, HTMLElement */",
    "fullscreen settings global declaration"
);
settingsSource = addSyntheticFullscreenSetter(settingsSource, 8, "fullscreen settings setter");
settingsSource = replaceTextExactlyCount(
    settingsSource,
    "fullscreenElement = this;",
    "setSyntheticFullscreenElement(this);",
    1,
    "fullscreen settings this alias"
);

timeoutSource = replaceTextExactlyOnce(
    timeoutSource,
    "/* global document, navigator, HTMLElement */",
    "/* global document, HTMLElement */",
    "fullscreen timeout global declaration"
);
timeoutSource = addSyntheticFullscreenSetter(timeoutSource, 8, "fullscreen timeout setter");
timeoutSource = replaceTextExactlyCount(
    timeoutSource,
    "fullscreenElement = this;",
    "setSyntheticFullscreenElement(this);",
    1,
    "fullscreen timeout this alias"
);

fullscreenControlsSource = replaceTextExactlyCount(
    fullscreenControlsSource,
    "\\n    }/",
    "\\n {4}}/",
    8,
    "fullscreen source-regex indentation guards"
);

machinerySource = replaceExactlyOnce(
    machinerySource,
    /\nfunction sliceBetween\(source, start, end\) \{[\s\S]*?\n\}\n(?=\ntest\()/,
    "\n",
    "unused sliceBetween helper"
);

writeFileSync(qualificationPath, qualificationSource);
writeFileSync(reentryPath, reentrySource);
writeFileSync(settingsPath, settingsSource);
writeFileSync(timeoutPath, timeoutSource);
writeFileSync(fullscreenControlsPath, fullscreenControlsSource);
writeFileSync(machineryPath, machinerySource);
unlinkSync(fileURLToPath(import.meta.url));
console.log("Cleaned fullscreen qualification/test lint issues and deleted the one-shot helper.");

function addSyntheticFullscreenSetter(source, indentation, label) {
    const spaces = " ".repeat(indentation);
    return replaceTextExactlyOnce(
        source,
        `${spaces}let fullscreenElement = null;`,
        `${spaces}let fullscreenElement = null;\n${spaces}const setSyntheticFullscreenElement = (element) => {\n${spaces}    fullscreenElement = element;\n${spaces}};`,
        label
    );
}

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

function replaceTextExactlyCount(text, search, replacement, expectedCount, label) {
    const matches = text.split(search).length - 1;
    if (matches !== expectedCount) {
        throw new Error(`Expected ${expectedCount} ${label}; found ${matches}. Source was not modified.`);
    }
    return text.split(search).join(replacement);
}
