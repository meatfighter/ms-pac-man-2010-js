import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
const server = await createServer({
    root: fileURLToPath(new URL("../pwa/", import.meta.url)),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true }
});
try {
    const { EnterInitialsMode } = await server.ssrLoadModule("/src/mspacman/EnterInitialsMode.ts");
    const names = ["Confirm", "Left", "Right", "Down", "Up"];
    for (let mask = 0; mask < 32; mask++)
        for (const index of [0, 1, 2])
            for (const submitted of [false, true]) {
                const edges = new Set(),
                    calls = [];
                const input = {
                    clearKeyPressedRecord() {
                        edges.clear();
                    }
                };
                for (const name of names)
                    input[`is${name}Pressed`] = () => {
                        calls.push(name);
                        return edges.delete(name);
                    };
                let uploads = 0,
                    handoffs = 0;
                const main = {
                    input,
                    tiles: [Array(50).fill(null)],
                    score: 123,
                    worldIndex: 0,
                    playSound() {},
                    accessScoresDatabaseAsync() {
                        uploads++;
                    },
                    setMode() {
                        handoffs++;
                    }
                };
                const mode = new EnterInitialsMode();
                mode.init(main, null);
                mode.editingIndex = index;
                mode.enterPressed = submitted;
                main.uploadComplete = false;
                for (let i = 0; i < 5; i++) if (mask & (1 << i)) edges.add(names[i]);
                const has = (n) => (mask & (1 << names.indexOf(n))) !== 0;
                let expectedIndex = index,
                    initials = "AAA",
                    expectedUpload = 0;
                if (!submitted) {
                    if (has("Left")) expectedIndex = Math.max(0, index - 1);
                    else if (has("Right") || (index !== 2 && has("Confirm"))) expectedIndex = Math.min(2, index + 1);
                    else if (has("Down")) initials = initials.slice(0, index) + "B" + initials.slice(index + 1);
                    else if (has("Up")) initials = initials.slice(0, index) + " " + initials.slice(index + 1);
                    else if (has("Confirm")) expectedUpload = 1;
                }
                mode.update(null);
                assert.deepEqual(calls, names, `drain mask ${mask}, index ${index}, submitted ${submitted}`);
                assert.equal(mode.editingIndex, expectedIndex);
                assert.equal(mode.initials, initials);
                assert.equal(uploads, expectedUpload);
                calls.length = 0;
                mode.update(null);
                assert.deepEqual(calls, names);
                assert.equal(mode.editingIndex, expectedIndex);
                assert.equal(mode.initials, initials);
                assert.equal(uploads, expectedUpload);
                if (!submitted && !expectedUpload) {
                    edges.add("Down");
                    mode.update(null);
                    assert.notEqual(mode.initials, initials);
                }
                calls.length = 0;
                mode.fadeState = EnterInitialsMode.FADE_OUT;
                mode.fadeIndex = 22;
                mode.update(null);
                assert.equal(handoffs, 1);
                assert.deepEqual(calls, []);
            }
    const { HumanInput } = await server.ssrLoadModule("/src/mspacman/HumanInput.ts");
    for (const pair of [
        [0, 3],
        [1, 2],
        [0, 1],
        [2, 3]
    ]) {
        const edges = new Set();
        const raw = {
            setAdditionalControllerDirectionAxes() {},
            clearKeyPressedRecord() {},
            clearControlPressedRecord() {
                edges.clear();
            },
            isKeyPressed() {
                return false;
            },
            getControllerCount() {
                return 2;
            },
            getButtonCount() {
                return 0;
            },
            isControlPressed(control, controller) {
                return edges.delete(`${controller}:${control}`);
            }
        };
        const input = new HumanInput({ getInput: () => raw });
        const main = {
            input,
            tiles: [Array(50).fill(null)],
            score: 0,
            playSound() {},
            accessScoresDatabaseAsync() {
                throw new Error("Unexpected score submission");
            }
        };
        const mode = new EnterInitialsMode();
        mode.init(main, null);
        mode.editingIndex = 1;
        for (const controller of [0, 1]) for (const control of pair) edges.add(`${controller}:${control}`);
        mode.update(null);
        const state = [mode.editingIndex, mode.initials];
        mode.update(null);
        assert.deepEqual([mode.editingIndex, mode.initials], state);
        assert.equal(edges.size, 0, "Actual HumanInput drains both controllers");
    }
    console.log("ok - actual initials mode: all 32 input subsets, boundaries, repeated updates, fresh edges, upload wait and terminal handoff");
} finally {
    await server.close();
}
