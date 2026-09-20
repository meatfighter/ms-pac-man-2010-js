import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pwaRoot = resolve(rootDir, "pwa");

const server = await createServer({
    root: pwaRoot,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true }
});

try {
    const { HumanInput } = await server.ssrLoadModule("/src/mspacman/HumanInput.ts");
    const { Main } = await server.ssrLoadModule("/src/mspacman/Main.ts");
    const { Input } = await import("slick2d-ts");

    await runTest("direction presses drain simultaneous keyboard and controller edges", () => {
        const cases = [
            ["isUpPressed", Input.KEY_UP, 2],
            ["isDownPressed", Input.KEY_DOWN, 3],
            ["isLeftPressed", Input.KEY_LEFT, 0],
            ["isRightPressed", Input.KEY_RIGHT, 1]
        ];
        for (const [method, key, control] of cases) {
            const harness = createHumanInputHarness(HumanInput, Input);
            harness.keyEdges.add(key);
            harness.controlEdges.add(`0:${control}`);

            assert.equal(harness.human[method](), true, method);
            assert.equal(harness.keyEdges.size, 0, `${method} must consume the keyboard edge`);
            assert.equal(harness.controlEdges.size, 0, `${method} must consume the controller edge`);
        }
    });

    await runTest("confirm/menu start drain simultaneous keyboard and controller edges", () => {
        for (const method of ["isConfirmPressed", "isMenuStartPressed"]) {
            const harness = createHumanInputHarness(HumanInput, Input);
            harness.keyEdges.add(Input.KEY_ENTER);
            harness.controlEdges.add("0:4");

            assert.equal(harness.human[method](), true, method);
            assert.equal(harness.keyEdges.size, 0, `${method} must consume the keyboard edge`);
            assert.equal(harness.controlEdges.size, 0, `${method} must consume the controller edge`);
        }
    });

    await runTest("accepting Pause performs zero simulation steps and freezes music fade", () => {
        const main = new Main();
        const originalUpdate = Main.playingMode.update;
        let simulationSteps = 0;
        let effectsStops = 0;
        let musicPauses = 0;
        const volumeWrites = [];

        Main.playingMode.update = () => {
            simulationSteps++;
        };
        try {
            main.mode = Main.playingMode;
            main.demoMode = false;
            main.nextFrameTime = Number.NEGATIVE_INFINITY;
            main.fadeMusicFlag = true;
            main.musicVolume = 1;
            main.musicVolumeFadeStep = 0.25;
            main.currentMusic = {
                pause() {
                    musicPauses++;
                },
                resume() {},
                setVolume(value) {
                    volumeWrites.push(value);
                }
            };
            main.stopAllSoundEffects = () => {
                effectsStops++;
            };
            main.input = pauseInput({ pausePressed: true, startPressed: false });

            main.update({}, 0);

            assert.equal(main.paused, true);
            assert.equal(simulationSteps, 0);
            assert.equal(effectsStops, 1);
            assert.equal(musicPauses, 1);
            assert.equal(main.musicVolume, 1, "fade clock must be frozen on the pause-accepting update");
            assert.deepEqual(volumeWrites, []);
            assert.notEqual(main.nextFrameTime, Number.NEGATIVE_INFINITY);
        } finally {
            Main.playingMode.update = originalUpdate;
        }
    });

    await runTest("unpausing resets scheduling and does not simulate in the same outer update", () => {
        const main = new Main();
        const originalUpdate = Main.playingMode.update;
        let simulationSteps = 0;
        let resumes = 0;
        const volumeWrites = [];

        Main.playingMode.update = () => {
            simulationSteps++;
        };
        try {
            main.mode = Main.playingMode;
            main.demoMode = false;
            main.paused = true;
            main.nextFrameTime = Number.NEGATIVE_INFINITY;
            main.fadeMusicFlag = true;
            main.musicVolume = 0.75;
            main.musicVolumeFadeStep = 0.25;
            main.currentMusic = {
                pause() {},
                resume() {
                    resumes++;
                },
                setVolume(value) {
                    volumeWrites.push(value);
                }
            };
            main.input = pauseInput({ pausePressed: true, startPressed: false });

            main.update({}, 0);

            assert.equal(main.paused, false);
            assert.equal(simulationSteps, 0);
            assert.equal(resumes, 1);
            assert.equal(main.musicVolume, 0.75);
            assert.deepEqual(volumeWrites, []);
            assert.notEqual(main.nextFrameTime, Number.NEGATIVE_INFINITY);
        } finally {
            Main.playingMode.update = originalUpdate;
        }
    });

    await runTest("advanceStage reaches the ending with completed-world stage sentinel 8", () => {
        const main = new Main();
        const transitions = [];
        main.stageIndex = 7;
        main.setMode = (mode) => {
            transitions.push(mode);
            main.mode = mode;
        };

        main.advanceStage({});

        assert.equal(main.stageIndex, 8);
        assert.deepEqual(transitions, [Main.endingMode]);
        assert.equal(main.mode, Main.endingMode);
    });

    await runTest("a mode transition terminates the current catch-up batch", () => {
        const main = new Main();
        let firstModeSteps = 0;
        let nextModeSteps = 0;
        const nextMode = {
            init() {},
            render() {},
            update() {
                nextModeSteps++;
            }
        };
        const firstMode = {
            init() {},
            render() {},
            update() {
                firstModeSteps++;
                main.mode = nextMode;
            }
        };

        main.mode = firstMode;
        main.demoMode = false;
        main.nextFrameTime = Number.NEGATIVE_INFINITY;
        main.fadeMusicFlag = false;
        main.input = pauseInput({ pausePressed: false, startPressed: false });

        main.update({}, 0);

        assert.equal(firstModeSteps, 1);
        assert.equal(nextModeSteps, 0, "new mode must not inherit the old mode's catch-up batch");
        assert.notEqual(main.nextFrameTime, Number.NEGATIVE_INFINITY);
    });
} finally {
    await server.close();
}

function createHumanInputHarness(HumanInput, Input) {
    const keyEdges = new Set();
    const controlEdges = new Set();
    const fakeInput = {
        setAdditionalControllerDirectionAxes() {},
        isKeyDown() {
            return false;
        },
        isControllerUp() {
            return false;
        },
        isControllerDown() {
            return false;
        },
        isControllerLeft() {
            return false;
        },
        isControllerRight() {
            return false;
        },
        isKeyPressed(key) {
            const pressed = keyEdges.has(key);
            keyEdges.delete(key);
            return pressed;
        },
        getControllerCount() {
            return 1;
        },
        isControlPressed(control, controller) {
            const id = `${controller}:${control}`;
            const pressed = controlEdges.has(id);
            controlEdges.delete(id);
            return pressed;
        },
        getButtonCount() {
            return 1;
        },
        clearKeyPressedRecord() {
            keyEdges.clear();
        },
        clearControlPressedRecord() {
            controlEdges.clear();
        }
    };

    return {
        human: new HumanInput({ getInput: () => fakeInput }),
        keyEdges,
        controlEdges,
        Input
    };
}

function pauseInput({ pausePressed, startPressed }) {
    let pause = pausePressed;
    let start = startPressed;
    return {
        isPausePressed() {
            const value = pause;
            pause = false;
            return value;
        },
        isGameplayStartPressed() {
            const value = start;
            start = false;
            return value;
        },
        clearKeyPressedRecord() {},
        isUp() { return false; },
        isDown() { return false; },
        isLeft() { return false; },
        isRight() { return false; },
        isUpPressed() { return false; },
        isDownPressed() { return false; },
        isLeftPressed() { return false; },
        isRightPressed() { return false; },
        isMenuStartPressed() { return false; },
        isConfirmPressed() { return false; },
        reset() {},
        update() { return true; }
    };
}

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
