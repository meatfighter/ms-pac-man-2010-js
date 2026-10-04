import "./validator-common.test.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Main } from "../../pwa/src/mspacman/Main.ts";
import { PlayingMode } from "../../pwa/src/mspacman/PlayingMode.ts";
import { RobotInput } from "../../pwa/src/mspacman/RobotInput.ts";
import { MsPacManGameStateSerializer } from "../../pwa/src/mspacman/persistence/MsPacManGameStateSerializer.ts";
import { MsPacManGameStateStore } from "../../pwa/src/mspacman/persistence/MsPacManGameStateStore.ts";
import { hasReasonableSnapshotValues } from "../../pwa/src/mspacman/persistence/SnapshotValuePolicy.ts";
import { createBrowserStorageKeys } from "../../pwa/src/app/BrowserStorageKeys.ts";
import { memoryStorage } from "../persistence-test-loader.mjs";

function fixture() {
    const main = new Main();
    const input = new Proxy(
        {},
        {
            get() {
                return () => false;
            }
        }
    );
    const gc = { getInput: () => input };
    main.input = input;
    const music = () => ({
        capturePlaybackState: () => ({ transport: "stopped", looped: false, playbackRate: 1, positionSeconds: 0, volume: 1, fade: null }),
        restorePlaybackState() {},
        stop() {},
        play() {},
        loop() {},
        setVolume() {}
    });
    main.actMusic = Array.from({ length: 3 }, music);
    main.stageMusic = Array.from({ length: 4 }, music);
    for (const id of ["trainingMusic", "introMusic", "levelSelectMusic", "highScoreMusic", "gameOverMusic"]) main[id] = music();
    main.robotInputs = Array.from({ length: 4 }, () => new RobotInput(new Uint8Array([1, 2, 4, 8]), gc));
    main.tiles[0][49] = {};
    main.startupLoadingComplete = true;
    main.setMode(Main.attractMode, gc);
    return { main, gc, serializer: new MsPacManGameStateSerializer(), store: new MsPacManGameStateStore("test") };
}
function withStorage(fn) {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
        storage = memoryStorage();
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    try {
        fn(storage);
    } finally {
        if (original) Object.defineProperty(globalThis, "localStorage", original);
        else delete globalThis.localStorage;
    }
}

test("actual RobotInput exhaustion is preserved, never clamped or rejected", () => {
    const gc = { getInput: () => ({}) },
        input = new RobotInput(new Uint8Array([1, 2, 4, 8]), gc);
    for (let i = 0; i < 20; i++) input.update();
    assert.equal(input.getState().index, 20);
    for (const cursor of [3, 4, 5, 20, 100001, 1000001]) {
        const restored = new RobotInput(new Uint8Array([1, 2, 4, 8]), gc);
        restored.setState({ index: cursor });
        assert.equal(restored.getState().index, cursor);
        if (cursor >= 4) assert.equal(restored.isUp() || restored.isDown() || restored.isLeft() || restored.isRight(), false);
        restored.update();
        assert.equal(restored.getState().index, cursor + 1);
    }
    for (const cursor of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => input.setState({ index: cursor }));
});

test("inactive exhausted recording survives real capture/store/restore with a score beyond int32", () =>
    withStorage((storage) => {
        const { main, serializer, store } = fixture();
        for (let i = 0; i < 20; i++) main.robotInputs[3].update();
        main.robotInputs[1].setState({ index: 1000001 });
        main.score = 2147483600;
        const producer = new PlayingMode();
        producer.main = main;
        producer.addPoints(50);
        assert.equal(main.score, 2147483650);
        assert.equal(store.save(main, () => true).saved, true);
        const saved = JSON.parse(storage.values.get(createBrowserStorageKeys().gameState));
        assert.equal(saved.robotInputs[3].index, 20);
        assert.equal(saved.robotInputs[1].index, 1000001);
        const fresh = fixture();
        assert.equal(store.restore(fresh.main, fresh.gc), true);
        assert.equal(fresh.main.score, 2147483650);
        assert.equal(fresh.main.robotInputs[3].getState().index, 20);
        assert.equal(fresh.main.robotInputs[1].getState().index, 1000001);
        const restored = serializer.createSnapshot(fresh.main, "test");
        delete saved.savedAt;
        delete restored.savedAt;
        assert.deepEqual(restored, saved);
        const bad = structuredClone(restored);
        bad.robotInputs[1].index = -1;
        assert.equal(serializer.isSupportedSnapshot(bad), false);
    }));

test("JSON-budget pass does not secretly reimpose a 100,000 gameplay-number bound", () => {
    for (const value of [100001, 1000001, 2147483648, -100001, 1e20]) assert.equal(hasReasonableSnapshotValues({ mode: { fields: { timer: value } } }), true);
    for (const value of [NaN, Infinity, -Infinity]) assert.equal(hasReasonableSnapshotValues({ mode: { fields: { timer: value } } }), false);
    assert.equal(hasReasonableSnapshotValues({ text: "x".repeat(4097) }), false);
});
