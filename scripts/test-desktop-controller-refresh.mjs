import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rootDir } from "./build-utils.mjs";

const humanInputSource = readFileSync(join(rootDir, "desktop", "src", "mspacman", "HumanInput.java"), "utf8");
const mainSource = readFileSync(join(rootDir, "desktop", "src", "mspacman", "Main.java"), "utf8");

await runTest("desktop controller rediscovery is gated by explicit policy", () => {
    assert.match(humanInputSource, /private boolean controllerRefreshEnabled = false;/);
    assert.match(humanInputSource, /public void setControllerRefreshEnabled\(boolean enabled\) \{\s*controllerRefreshEnabled = enabled;\s*\}/);
    assert.match(humanInputSource, /private boolean refreshControllersIfNeeded\(\) \{\s*if \(!controllerRefreshEnabled\s*\|\|\s*controllerRefreshInProgress/);
});

await runTest("desktop controller policy disables rediscovery only during active gameplay", () => {
    assert.match(
        mainSource,
        /private void updateControllerRefreshPolicy\(\) \{\s*if \(input instanceof HumanInput\) \{\s*\(\(HumanInput\)input\)\.setControllerRefreshEnabled\(\s*shouldRefreshControllers\(\)\);\s*\}\s*\}/
    );
    assert.match(mainSource, /private boolean shouldRefreshControllers\(\) \{\s*return paused \|\| mode != Main\.playingMode \|\| demoMode;\s*\}/);
    assert.match(mainSource, /public void update\(GameContainer gc, int delta\) throws SlickException \{\s*updateControllerRefreshPolicy\(\);/);
    assert.match(
        mainSource,
        /public void setMode\(IMode mode, GameContainer gc\) throws SlickException \{\s*this\.mode = mode;\s*updateControllerRefreshPolicy\(\);/
    );
});

await runTest("desktop controller reads still create and poll known controller state", () => {
    assert.match(
        humanInputSource,
        /private Controller getLwjglController\(int controllerIndex\) \{\s*try \{\s*refreshControllersIfNeeded\(\);[\s\S]*ensureControllersCreated\(\);\s*pollControllers\(\);/
    );
    assert.match(
        humanInputSource,
        /private int getControllerCount\(\) \{\s*try \{\s*refreshControllersIfNeeded\(\);[\s\S]*ensureControllersCreated\(\);\s*pollControllers\(\);/
    );
});

await runTest("desktop JInput noise filter suppresses poll failures and plugin-load notice", () => {
    assert.match(humanInputSource, /text\.startsWith\("Failed to poll device:"\)/);
    assert.match(humanInputSource, /text\.startsWith\("Failed to poll component:"\)/);
    assert.match(humanInputSource, /"Loading: net\.java\.games\.input\.DirectAndRawInputEnvironmentPlugin"/);
    assert.match(humanInputSource, /return pollFailure \|\| pluginLoadNotice;/);
});

async function runTest(name, fn) {
    try {
        await fn();
        console.log(`ok - ${name}`);
    } catch (error) {
        console.error(`not ok - ${name}`);
        console.error(error);
        process.exitCode = 1;
    }
}
