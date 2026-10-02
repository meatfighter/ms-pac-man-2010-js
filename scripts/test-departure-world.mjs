import test from "node:test";
import assert from "node:assert/strict";
import { departureWorld } from "./departure-world.mjs";
test("timestamps and independent audio clocks cannot count as world progress", () => {
    const baseline = {
        version: 12,
        savedAt: "old",
        mode: { ticks: 36 },
        music: { playback: { positionSeconds: 0.3 } },
        soundEffects: [],
        currentSongState: { activeMusic: { playback: { positionSeconds: 1 } } },
        audioState: { cooldowns: [{ remainingMs: 65 }] }
    };
    const audioOnly = structuredClone(baseline);
    audioOnly.savedAt = "new";
    audioOnly.music.playback.positionSeconds = 0.4;
    audioOnly.currentSongState.activeMusic.playback.positionSeconds = 2;
    audioOnly.audioState.cooldowns = [];
    assert.equal(departureWorld(baseline), departureWorld(audioOnly));
    audioOnly.mode.ticks++;
    assert.notEqual(departureWorld(baseline), departureWorld(audioOnly));
});
