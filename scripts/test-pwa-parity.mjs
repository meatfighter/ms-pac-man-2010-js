import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const rootDir = resolve(".");
const metadataPath = join(rootDir, "scripts", "generated", "java-parity-metadata.json");
assert.ok(existsSync(metadataPath), "Java parity metadata is missing. Run npm run generate:java-parity-metadata.");
const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
assert.equal(metadata.version, 1);
assert.ok(Array.isArray(metadata.classes) && metadata.classes.length > 0, "Java parity metadata must contain mapped classes.");

for (const info of metadata.classes) {
    const tsPath = join(rootDir, "pwa", "src", "mspacman", `${info.className}.ts`);
    assert.ok(existsSync(tsPath), `Missing TypeScript counterpart for Java class ${info.className}.`);
    const source = readFileSync(tsPath, "utf8");
    for (const field of info.floatFields) {
        assert.match(source, new RegExp(`\\b${field}\\b`), `${info.className} no longer contains Java float field ${field}.`);
    }
}

const javaMain = readFileSync(join(rootDir, "desktop", "src", "mspacman", "Main.java"), "utf8");
const tsMain = readFileSync(join(rootDir, "pwa", "src", "mspacman", "Main.ts"), "utf8");
assert.match(javaMain, /nextFrameTime \+= Sys\.getTimerResolution\(\) \/ 91;/);
assert.match(tsMain, /nextFrameTime \+= intDiv\(Sys\.getTimerResolution\(\), 91\);/);
assert.equal(Math.trunc(1000 / 91), 10, "The historical /91 loop must remain the Java 10 ms fixed-step cadence.");

// Browser gameplay Pause deliberately uses logical Music transport ownership.
assert.match(javaMain, /gc\.setMusicOn\(false\)/, "Java desktop retains its legacy global Music-off Pause implementation.");
assert.match(javaMain, /gc\.setMusicOn\(true\)/, "Java desktop retains its legacy global Music-on unpause implementation.");
assert.doesNotMatch(tsMain, /gc\.setMusicOn\(/, "Browser gameplay must not mutate application-wide Music policy.");
assert.match(tsMain, /this\.currentMusic\?\.pause\(\)/, "Browser gameplay Pause must pause the exact logical Music transport.");
assert.match(tsMain, /this\.currentMusic\?\.resume\(\)/, "Browser gameplay unpause must resume the exact logical Music transport.");

const javaStopSound = /public void stopSound\(Sound sound\)\s*\{\s*sound\.stop\(\);\s*\}/s;
const tsStopSoundMethod = /public stopSound\(sound: Sound\): void\s*\{([\s\S]*?)\n {4}\}/.exec(tsMain);
assert.match(javaMain, javaStopSound, "Java stopSound must stop the Sound instance passed by the caller.");
assert.ok(tsStopSoundMethod, "TypeScript stopSound method is missing.");
assert.match(tsStopSoundMethod[1], /sound\.stop\(\);/, "TypeScript stopSound must stop the Sound instance passed by the caller.");
assert.doesNotMatch(tsStopSoundMethod[1], /blueGhostsSound/, "TypeScript stopSound must not hard-code blueGhostsSound.");

const javaAttractMode = readFileSync(join(rootDir, "desktop", "src", "mspacman", "AttractMode.java"), "utf8");
const tsAttractMode = readFileSync(join(rootDir, "pwa", "src", "mspacman", "AttractMode.ts"), "utf8");
const desktopFullscreenInstruction = "SPACE BAR - TOGGLE FULL-SCREEN MODE";
assert.ok(javaAttractMode.includes(desktopFullscreenInstruction), "Java desktop title screen must retain its Space-bar fullscreen instruction.");
assert.ok(!tsAttractMode.includes(desktopFullscreenInstruction), "Browser title screen must not advertise the Java desktop Space-bar fullscreen control.");

const hotFloatSources = {
    Thing: readFileSync(join(rootDir, "pwa", "src", "mspacman", "Thing.ts"), "utf8"),
    MsPacMan: readFileSync(join(rootDir, "pwa", "src", "mspacman", "MsPacMan.ts"), "utf8"),
    Ghost: readFileSync(join(rootDir, "pwa", "src", "mspacman", "Ghost.ts"), "utf8"),
    FruitTarget: readFileSync(join(rootDir, "pwa", "src", "mspacman", "FruitTarget.ts"), "utf8")
};
assert.match(hotFloatSources.MsPacMan, /this\.speed\s*=\s*toFloat\(/);
assert.match(hotFloatSources.MsPacMan, /this\.speedRemainder\s*=\s*toFloat\(this\.speedRemainder \+ speed\)/);
assert.match(hotFloatSources.Ghost, /this\.speedRemainder\s*=\s*toFloat\(this\.speedRemainder \+ speed\)/);
assert.match(hotFloatSources.FruitTarget, /this\.speedRemainder\s*=\s*toFloat\(this\.speedRemainder \+ this\.speed\)/);

const act1 = metadata.classes.find((entry) => entry.className === "Act1Mode");
assert.ok(act1, "Act1Mode must participate in generated parity metadata.");
for (const field of ["cyanX", "pacmanX", "pinkX", "mspacmanX", "mspacmanY", "bumpedAlpha", "bumpedSpeed", "ghostY", "ghostYAngle"]) {
    assert.ok(act1.floatFields.includes(field), `Generated Java float metadata is missing Act1Mode.${field}.`);
}

console.log(`Java/TypeScript parity metadata covers ${metadata.classes.length} mapped classes and preserves hot float/timing contracts.`);
