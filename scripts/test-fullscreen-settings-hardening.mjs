import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const rootDir = process.cwd();
const mainSource = readFileSync(join(rootDir, "pwa", "src", "app", "main.ts"), "utf8");
const stylesSource = readFileSync(join(rootDir, "pwa", "src", "app", "styles.css"), "utf8");
const lifecycleStressSource = readFileSync(join(rootDir, "scripts", "run-lifecycle-stress-qualification.mjs"), "utf8");

test("menu launch admission is state-gated without sticky disabled buttons", () => {
    assert.doesNotMatch(mainSource, /newGameButton\??\.disabled\s*=\s*true|continueButton\??\.disabled\s*=\s*true|disableLaunchButtons/);

    const menu = mainSource.slice(mainSource.indexOf("function renderMenuUi"), mainSource.indexOf("async function startGame"));
    assert.match(menu, /newGameButton\?\.addEventListener\("click", \(\) => \{\s*if \(!canActivateFromMenu\(\)\)/);
    assert.match(menu, /continueButton\?\.addEventListener\("click", \(\) => \{\s*if \(!canActivateFromMenu\(\)\)/);
});

test("Fullscreen and Scaling share a non-compressing responsive row", () => {
    assert.match(mainSource, /class="settings-row settings-fullscreen-scaling-row"[\s\S]*?class="setting-fullscreen-row"[\s\S]*?class="setting-scaling-row"/);
    assert.match(stylesSource, /\.settings-row\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/s);
    assert.match(stylesSource, /\.settings-row\s*>\s*\.setting-fullscreen-row,\s*\.settings-row\s*>\s*\.setting-scaling-row\s*\{[^}]*flex:\s*0\s+0\s+auto;/s);
});

test("Scaling preference is applied both to fresh and retained gameplay", () => {
    const mount = mainSource.slice(mainSource.indexOf("async function mountGame"), mainSource.indexOf("function applyVolume"));
    assert.match(mount, /scalableGame\.setScalingPreference\(scalingPreference\)/);

    const setter = mainSource.slice(mainSource.indexOf("function setScalingPreference"), mainSource.indexOf("function requestPreferredFullscreen"));
    assert.match(setter, /preferences\.setScaling\(value, currentPreferenceWriteAuthorized\)/);
    assert.match(setter, /activeScalableGame\?\.setScalingPreference\(value\)/);
    assert.match(setter, /viewport\.scheduleResize\(\)/);
});

test("lifecycle stress requires exact wake-lock acquisition and release accounting", () => {
    assert.match(lifecycleStressSource, /finalLifecycle\.wakeAcquired\s*-\s*finalLifecycle\.wakeReleased/);
    assert.match(lifecycleStressSource, /finalLifecycle\.wakeLive/);
    assert.match(lifecycleStressSource, /Wake-lock acquisition\/release accounting is unbalanced/);
});
