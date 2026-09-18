import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({
    root: resolve(rootDir, "pwa"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true }
});

try {
    const { Main } = await server.ssrLoadModule("/src/mspacman/Main.ts");
    const { PlayingMode } = await server.ssrLoadModule("/src/mspacman/PlayingMode.ts");

    {
        const events = [];
        const gc = {};
        const main = {
            demoMode: true,
            pressedEnterSound: {},
            input: {
                isConfirmPressed: () => true
            },
            stopAllSoundEffects() {
                events.push("purge");
            },
            playSound(sound) {
                assert.equal(sound, this.pressedEnterSound);
                assert.equal(this.demoMode, false, "pressed-enter must belong to the destination transition");
                events.push("pressed-enter");
            },
            setMode(mode, actualGc) {
                assert.equal(mode, Main.selectWorldMode);
                assert.equal(actualGc, gc);
                events.push("select-world");
            }
        };
        const mode = Object.create(PlayingMode.prototype);
        Object.assign(mode, {
            main,
            gameOver: false,
            fadeState: PlayingMode.FADE_NONE
        });

        mode.update(gc);

        assert.equal(main.demoMode, false);
        assert.deepEqual(events, ["purge", "pressed-enter", "select-world"]);
    }

    {
        const events = [];
        const gc = {};
        const main = {
            demoMode: true,
            input: {
                isConfirmPressed: () => false
            },
            stopAllSoundEffects() {
                events.push("purge");
            },
            playSound() {
                throw new Error("Demo-death retirement must not create a destination SFX.");
            },
            setMode(mode, actualGc) {
                assert.equal(mode, Main.hallOfFameMode);
                assert.equal(actualGc, gc);
                events.push("hall-of-fame");
            }
        };
        const mode = Object.create(PlayingMode.prototype);
        Object.assign(mode, {
            main,
            gameOver: false,
            fadeState: PlayingMode.FADE_OUT,
            fadeIndex: 22,
            fadeReason: PlayingMode.FADE_REASON_KILLED
        });

        mode.update(gc);

        assert.equal(main.demoMode, false);
        assert.deepEqual(events, ["purge", "hall-of-fame"]);
    }

    const tsMain = readFileSync(resolve(rootDir, "pwa/src/mspacman/Main.ts"), "utf8");
    const stopAllSoundEffects = sourceBetween(tsMain, "    public stopAllSoundEffects()", "    public stopAllSounds()");
    assert.match(stopAllSoundEffects, /SoundStore\.get\(\)\.stopSoundEffects\(\)/);

    const setMode = sourceBetween(tsMain, "    public setMode(", "    public initModeForRestore(");
    assert.doesNotMatch(setMode, /stopAllSoundEffects|stopSoundEffects/, "generic mode changes must not become destructive");

    const java = readFileSync(resolve(rootDir, "desktop/src/mspacman/PlayingMode.java"), "utf8");
    const javaConfirm = sourceBetween(java, "      if (main.input.isConfirmPressed()) {", "    if (gameOver) {");
    assertInOrder(javaConfirm, [
        "main.stopAllSoundEffects();",
        "main.demoMode = false;",
        "main.playSound(main.pressedEnterSound);",
        "main.setMode(Main.selectWorldMode, gc);"
    ]);

    const javaDemoDeath = sourceBetween(java, "          case FADE_REASON_KILLED:", "          case FADE_REASON_ADVANCE:");
    assertInOrder(javaDemoDeath, ["main.stopAllSoundEffects();", "main.demoMode = false;", "main.setMode(Main.hallOfFameMode, gc);"]);

    console.log("Ms. Pac-Man autonomous demo SFX retirement checks passed.");
} finally {
    await server.close();
}

function sourceBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0 && end > start, `Unable to isolate source between ${startMarker} and ${endMarker}.`);
    return source.slice(start, end);
}

function assertInOrder(source, snippets) {
    let previous = -1;
    for (const snippet of snippets) {
        const index = source.indexOf(snippet);
        assert.ok(index > previous, `Expected ordered source snippet: ${snippet}`);
        previous = index;
    }
}
