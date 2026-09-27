import assert from "node:assert/strict";
import { test } from "node:test";
import { withCounterModules } from "./counter-test-utils.mjs";

test("actual decimal renderer and resource awards preserve Java behavior", async () => {
    await withCounterModules({}, async (load) => {
        const { Main } = await load("Main");
        const main = Object.create(Main.prototype);
        const calls = [];
        const glyphs = Array.from({ length: 256 }, (_, code) => ({
            draw(x, y) {
                calls.push({ code, x, y });
            }
        }));
        main.symbols = Array.from({ length: 6 }, () => glyphs);
        for (const [score, expected] of [
            [0, "0"],
            [123, "123"],
            [1000000, "1000000"],
            [2147483647, "2147483647"]
        ]) {
            calls.length = 0;
            main.score = score;
            main.drawNumber(score, 10, 160, 32, Main.WHITE);
            const sorted = calls.toSorted((a, b) => a.x - b.x);
            assert.equal(sorted.map((c) => String.fromCharCode(c.code)).join(""), expected);
            assert.equal(sorted.at(-1).x, 304);
            assert.equal(main.score, score, "render never changes logical score");
        }
        const { HallOfFameMode } = await load("HallOfFameMode");
        const blank = { draw() {} };
        main.tiles = [Array(50).fill(blank)];
        main.redEnergizerSprite = blank;
        main.fades = [];
        main.input = { clearKeyPressedRecord() {} };
        main.drawString = () => {};
        main.highScores = Array.from({ length: 4 }, () => Array.from({ length: 5 }, () => ({ score: 1234567, initials: "ABC" })));
        const hall = new HallOfFameMode();
        hall.init(main, {});
        calls.length = 0;
        hall.render({}, { setColor() {}, fillRect() {} });
        for (let world = 0; world < 4; world++)
            for (let rank = 0; rank < 5; rank++) {
                const y = 18 * (6 + world * 6 + rank),
                    row = calls.filter((c) => c.y === y).toSorted((a, b) => a.x - b.x);
                assert.equal(row.map((c) => String.fromCharCode(c.code)).join(""), "1234567", "actual Hall of Fame numeric field");
                assert.equal(row.at(-1).x, 528, "Hall of Fame ten-position alignment");
            }
        let sounds = 0;
        main.playSound = () => sounds++;
        const { PlayingMode } = await load("PlayingMode");
        const playing = new PlayingMode();
        playing.main = main;
        main.score = 9990;
        main.lives = 5;
        playing.addPoints(10);
        assert.equal(main.score, 10000);
        assert.equal(main.lives, 6);
        assert.equal(sounds, 1);
        playing.addPoints(10000);
        assert.equal(main.score, 20000);
        assert.equal(main.lives, 6);
        assert.equal(sounds, 1, "no cap cue");
    });
});
