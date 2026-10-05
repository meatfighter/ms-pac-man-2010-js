import assert from "node:assert/strict";
import { test } from "node:test";
import { withCounterModules } from "./counter-test-utils.mjs";

test("standalone timer representation, compiled dialog limits and credits terminal retention", async () => {
    await withCounterModules({ "persistence/MsPacManGameStateSerializer": (s) => s + "\nexport {isValidStandaloneModeFieldState};" }, async (load) => {
        const { isValidStandaloneModeFieldState: valid } = await load("persistence/MsPacManGameStateSerializer");
        const { Act4Mode } = await load("Act4Mode");
        const { Act5Mode } = await load("Act5Mode");
        const { Act7Mode } = await load("Act7Mode");
        const { EndingMode } = await load("EndingMode");
        const main = {
            speaking: Array.from({ length: 2 }, () => Array.from({ length: 10 }, () => ({ play() {} }))),
            random: { nextInt: () => 0 },
            stageIndex: 4,
            fadeMusic() {},
            setMode() {
                this.handoffs = (this.handoffs ?? 0) + 1;
            },
            loopMusic() {},
            playMusic() {},
            stopMusic() {},
            playSound() {},
            stopSound() {},
            tiles: [[...Array(49), {}]]
        };
        const act = new Act4Mode();
        act.init(main, {});
        act.initTraining();
        let callbacks = 0;
        while (!main.handoffs && callbacks++ < 4000) {
            act.updateTraining({});
            assert.equal(valid("act4", act), true);
        }
        assert.equal(main.handoffs, 1);
        assert.equal(act.timer, Act4Mode.PAUSE_CENTERED + 68 + 23);
        assert.equal(valid("act4", { ...act, timer: 1000001 }), true, "no arbitrary elapsed-counter ceiling");
        for (const timer of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.equal(valid("act4", { ...act, timer }), false);
        for (const [id, Type] of [
            ["act5", Act5Mode],
            ["act7", Act7Mode],
            ["ending", EndingMode]
        ]) {
            const mode = new Type();
            mode.init(main, {});
            for (let line = 0; line < Type.dialog.length; line++) {
                mode.initString(line, 0);
                let ticks = 0;
                while (!mode.stringDone && ticks++ < 10000) {
                    mode.updateString();
                    assert.equal(valid(id, mode), true);
                }
                assert.equal(mode.stringIndex, Type.dialog[line].length);
                assert.equal(valid(id, { ...mode, stringIndex: mode.stringIndex + 1 }), false);
            }
        }
        const ending = new EndingMode();
        ending.init(main, {});
        ending.initCredits();
        const startState = ending.state;
        let steps = 0;
        while (ending.state === startState && steps++ < 20000) {
            ending.updateCredits();
            assert.equal(valid("ending", ending), true);
        }
        assert.equal(ending.creditsY, -EndingMode.credits.length * 28 - 0.5);
        const retained = ending.creditsY;
        ending.updatePresented({});
        assert.equal(ending.creditsY, retained);
        assert.equal(valid("ending", ending), true);
        assert.equal(valid("ending", { ...ending, creditsY: retained - 0.5 }), false);
    });
});
