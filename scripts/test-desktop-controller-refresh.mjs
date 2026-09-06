import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rootDir } from "./build-utils.mjs";

const humanInputSource = readFileSync(join(rootDir, "desktop", "src", "mspacman", "HumanInput.java"), "utf8");
const mainSource = readFileSync(join(rootDir, "desktop", "src", "mspacman", "Main.java"), "utf8");

// Behavioral coverage lives in HumanInputTest and runs with the desktop tests.
// Keep these guards against reintroducing unsafe native-environment replacement.
assert.doesNotMatch(humanInputSource, /defaultEnvironment|resetLwjglControllerCaches|resetJInputControllerEnvironment|refreshControllersIfNeeded/);
assert.doesNotMatch(mainSource, /setControllerRefreshEnabled|updateControllerRefreshPolicy/);
assert.match(mainSource, /public void update\(GameContainer gc, int delta\) throws SlickException \{\s*\(\(HumanInput\)input\)\.beginFrame\(\);/);
assert.doesNotMatch(humanInputSource, /runWithFilteredJInputPollErrors/);
console.log("ok - desktop controller discovery stays startup-only");
