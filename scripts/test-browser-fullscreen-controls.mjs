import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function read(relativePath) {
    return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const webApp = read("pwa/src/app/main.ts");
const viewport = read("pwa/src/app/GameViewportController.ts");
const preferences = read("pwa/src/app/BrowserPreferences.ts");
const storageKeys = read("pwa/src/app/BrowserStorageKeys.ts");
const inputInterface = read("pwa/src/mspacman/IInput.ts");
const humanInput = read("pwa/src/mspacman/HumanInput.ts");
const robotInput = read("pwa/src/mspacman/RobotInput.ts");
const translatedMain = read("pwa/src/mspacman/Main.ts");
const viteConfig = read("pwa/vite.config.ts");
const styles = read("pwa/src/app/styles.css");

test("fullscreen is a browser preference, not game state", () => {
    assert.match(preferences, /DEFAULT_FULLSCREEN_PREFERENCE\s*=\s*true/);
    assert.match(preferences, /public fullscreen = DEFAULT_FULLSCREEN_PREFERENCE/);
    assert.match(preferences, /constructor\(loadStored = true\)[\s\S]*?if \(loadStored\) this\.reload\(\)/);
    assert.match(preferences, /public reload\(\): void \{[\s\S]*?this\.fullscreen = this\.readFullscreen\(\)/);
    assert.match(preferences, /setFullscreen\(value: boolean, isAuthorized: \(\) => boolean\)/);
    assert.match(webApp, /preferences\.setFullscreen\(!preferences\.fullscreen, currentPreferenceWriteAuthorized\)/);
    assert.match(storageKeys, /readonly fullscreen: string/);
    assert.match(storageKeys, /createStorageKey\(deploymentId, "fullscreen"\)/);
    assert.doesNotMatch(webApp, /GAME_STATE.*fullscreen|fullscreen.*GAME_STATE/i);
});

test("unavailable fullscreen presents OFF without rewriting the stored preference", () => {
    assert.match(webApp, /const fullscreenUnavailable = viewport\.getFullscreenCapability\(\) === "unavailable"/);
    assert.match(webApp, /const fullscreenPresented = !fullscreenUnavailable && preferences\.fullscreen/);
    assert.match(webApp, /aria-pressed="\$\{fullscreenPresented\}"/);
    assert.match(webApp, /data-enabled="\$\{fullscreenPresented\}"/);
    assert.match(webApp, /disabled title="Fullscreen is unavailable in this browser"/);
});

test("cold New Game and retained Continue request fullscreen before their first await", () => {
    const coldStart = webApp.match(/async function startGame\([\s\S]*?\nfunction renderBoot/)?.[0] ?? "";
    const coldShell = coldStart.indexOf("viewport.createShell(generation)");
    const coldAudio = coldStart.indexOf("beginGameAudio()");
    const coldFullscreen = coldStart.indexOf("requestPreferredFullscreen()");
    const coldAwait = coldStart.indexOf("await audio.ready");
    assert.ok(coldShell >= 0 && coldAudio > coldShell && coldFullscreen > coldAudio && coldAwait > coldFullscreen);

    const liveContinue = webApp.match(/async function resumeLiveGameFromMenu\([\s\S]*?\nfunction removeMenuOverlay/)?.[0] ?? "";
    const liveAudio = liveContinue.indexOf("beginGameAudio()");
    const liveFullscreen = liveContinue.indexOf("requestPreferredFullscreen()");
    const liveAwait = liveContinue.indexOf("await audio.ready");
    assert.ok(liveAudio >= 0 && liveFullscreen > liveAudio && liveAwait > liveFullscreen);
});

test("Esc belongs to the PWA shell and translated browser fullscreen machinery is removed", () => {
    const reserved = webApp.match(/function handleBrowserReservedKey\([\s\S]*?\n}/)?.[0] ?? "";
    assert.match(reserved, /event\.key !== "Escape"|event\.key === "Escape"/);
    assert.match(reserved, /requestPwaMenu\("escape"\)/);
    for (const source of [inputInterface, humanInput, robotInput]) {
        assert.doesNotMatch(source, /isFullscreenTogglePressed|isFullscreenExitPressed/);
    }
    assert.doesNotMatch(translatedMain, /fullScreenToggleCheck/);
    assert.doesNotMatch(translatedMain, /isFullscreenTogglePressed|isFullscreenExitPressed/);
    assert.doesNotMatch(translatedMain, /nativeCursor|showMouseCursor|hideMouseCursor/);
});

test("native fullscreen invocation is fenced before and after synchronous reentry", () => {
    const request = viewport.match(/public requestFullscreen\(\): Promise<boolean> \{[\s\S]*?\n {4}}/)?.[0] ?? "";
    const preflightSession = request.indexOf("!this.callbacks.isSessionCurrent(session)");
    const preflightActivity = request.indexOf("!this.callbacks.isGameplayActive()");
    const nativeRequest = request.indexOf("requestBrowserFullscreen(shell)");
    const postflight = request.indexOf("const invocationStillCurrent");
    assert.ok(preflightSession >= 0 && preflightActivity >= 0 && nativeRequest > preflightSession && nativeRequest > preflightActivity);
    assert.ok(postflight > nativeRequest, "native fullscreen call must be revalidated after synchronous browser reentry");
    assert.match(request, /this\.fullscreenSuppressedPresentation = presentation/);
    assert.match(request, /this\.clearFullscreenSuppressionWhenSettled\(promise, shell, presentation\)/);
});

test("fullscreen authority is fenced to exact presentation and session identities", () => {
    assert.match(viewport, /private presentationGeneration = 0/);
    assert.match(viewport, /private fullscreenRequestSerial = 0/);
    assert.match(viewport, /private fullscreenSuppressedPresentation: number \| null = null/);
    assert.match(viewport, /private readonly retiredFullscreenShells = new WeakSet<HTMLElement>\(\)/);
    assert.match(viewport, /requestSerial === this\.fullscreenRequestSerial/);
    assert.match(viewport, /presentation === this\.presentationGeneration/);
    assert.match(viewport, /this\.shell === shell/);
});

test("MENU exit starts actual shell exit before bounded pending-entry wait", () => {
    assert.match(viewport, /FULLSCREEN_REQUEST_SETTLE_TIMEOUT_MS = 1500/);
    const exit = viewport.match(/private async exitFullscreenForPresentation\([\s\S]*?\n {4}}/)?.[0] ?? "";
    const actualExit = exit.indexOf("requestExitForSpecificShell(targetShell)");
    const pendingWait = exit.indexOf("waitForPendingFullscreenRequests(targetShell, targetPresentation)");
    assert.ok(actualExit >= 0 && pendingWait > actualExit);
    assert.match(exit, /this\.fullscreenRequestSerial\+\+/);
    assert.match(exit, /this\.fullscreenEntryAuthorized = false/);

    const pending = viewport.match(/private async waitForPendingFullscreenRequests\([\s\S]*?\n {4}}/)?.[0] ?? "";
    assert.match(pending, /Promise\.race/);
    assert.match(pending, /FULLSCREEN_REQUEST_SETTLE_TIMEOUT_MS/);
});

test("retired or unauthorized shell success is hidden until exact-shell exit", () => {
    const clear = viewport.match(/public clear\(\): void \{[\s\S]*?\n {4}}/)?.[0] ?? "";
    assert.match(clear, /retiredFullscreenShells\.add\(targetShell\)/);
    assert.match(clear, /this\.root\.style\.visibility = "hidden"/);
    const retired = viewport.match(/private hideRootUntilRetiredShellExits\([\s\S]*?\n {4}}/)?.[0] ?? "";
    assert.match(retired, /requestExitForSpecificShell\(shell\)/);
    assert.match(retired, /this\.root\.style\.visibility = "hidden"/);
    assert.match(retired, /this\.root\.style\.visibility = ""/);
});

test("retained Continue reconciles display before input and loop resume", () => {
    const liveContinue = webApp.match(/async function resumeLiveGameFromMenu\([\s\S]*?\nfunction removeMenuOverlay/)?.[0] ?? "";
    const reconcile = liveContinue.indexOf("viewport.reconcileDisplayModeNow()");
    const inputResume = liveContinue.indexOf("liveContainer.getInput().resume()");
    const loopResume = liveContinue.indexOf("liveContainer.setLoopSuspended(false)");
    assert.ok(reconcile >= 0 && inputResume > reconcile && loopResume > inputResume);
    assert.match(viewport, /"fullscreenchange", "webkitfullscreenchange"/);
    assert.match(viewport, /queueMicrotask/);
});

test("hamburger visibility keeps polling until the running game leaves its loading screen", () => {
    assert.match(viewport, /private hamburgerVisibilityAnimationFrame = 0/);
    const start = viewport.match(/public startHamburgerVisibilityMonitor\(\): void \{[\s\S]*?\n {4}}/)?.[0] ?? "";
    assert.match(start, /this\.stopHamburgerVisibilityMonitor\(\)/);
    assert.match(start, /this\.updateHamburgerVisibility\(\)/);

    const stop = viewport.match(/public stopHamburgerVisibilityMonitor\(\): void \{[\s\S]*?\n {4}}/)?.[0] ?? "";
    assert.match(stop, /cancelAnimationFrame\(this\.hamburgerVisibilityAnimationFrame\)/);
    assert.match(stop, /this\.hideHamburger\(\)/);

    const update = viewport.match(/private updateHamburgerVisibility\(\): void \{[\s\S]*?\n {4}}/)?.[0] ?? "";
    assert.match(update, /const gameplayRunning = this\.callbacks\.isGameplayRunning\(\)/);
    assert.match(update, /this\.callbacks\.isGameplayActive\(\) && !gameplayRunning/);
    assert.match(update, /requestAnimationFrame\(\(\) =>/);
});

test("fullscreen presentation does not alter score signing or endpoint configuration", () => {
    assert.match(viteConfig, /DEFAULT_HIGH_SCORE_API_URL = "\/api\/ms-pac-man-2010\/scores"/);
    assert.match(viteConfig, /MSPACMAN_HMAC_KEY_HEX/);
    assert.doesNotMatch(viewport, /HMAC|HIGH_SCORE|scores/i);
});

test("fullscreen CSS owns wrapper fill, safe-area chrome and disabled OFF presentation", () => {
    assert.match(styles, /\.game-shell:fullscreen/);
    assert.match(styles, /-webkit-full-screen/);
    assert.match(styles, /safe-area-inset-left/);
    assert.match(styles, /safe-area-inset-top/);
    assert.match(styles, /\.fullscreen-switch:disabled\s*\{[^}]*border-color:\s*#6f6501;[^}]*background:\s*#6f6501;/s);
    assert.match(styles, /\.fullscreen-switch:disabled span\s*\{[^}]*background:\s*#191405;[^}]*transform:\s*translateX\(0\);/s);
    assert.match(styles, /touch-action:\s*manipulation/);
});
