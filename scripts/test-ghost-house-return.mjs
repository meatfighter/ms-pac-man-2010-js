import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { executeTs, methods } from "./terminal-boundary-test-utils.mjs";

// These are production method bodies, including route lookup, movement,
// capture, fractional dispatch and region bookkeeping, not copied algorithms.
const { Ghost, PlayingMode } = executeTs(`
const Main={UP:0,DOWN:1,LEFT:2,RIGHT:3,RED:0,PINK:1,CYAN:2,ORANGE:3};
const TYPE_WALL=3, INT_MAX=2147483647;
const toFloat=Math.fround, toInt=Math.trunc, intDiv=(x,y)=>Math.trunc(x/y);
class Thing {
 ${methods("Thing", ["tileX", "tileY", "getType", "getHomeDirection", "getMsPacManDistance", "canMoveUp", "canMoveDown", "canMoveLeft", "canMoveRight"])}
}
class Ghost extends Thing {
 static FLUTTER_SPEED=15; static REVERSE_DIRECTION=[1,0,3,2];
 updateGhost() {};
 ${methods("Ghost", ["update", "reset", "moveInHome", "moveEyeBalls", "enterHome", "moveRandomly", "moveOnePixel", "reverseDirection", "getDist", "chase", "render", "drawWrapped"])}
}
class PlayingMode {
 ${methods("PlayingMode", ["tileX", "tileY", "getRegionCount", "incrementRegionCount", "decrementRegionCount", "ghostEaten", "addPoints", "ateEnergizer", "distanceToMsPacMan", "distance"])}
}
({Ghost,PlayingMode});
`);

test("production fruit reset retires its previous stage exit path", () => {
    const Fruit = executeTs(`class Fruit { ${methods("FruitTarget", ["reset"])} }; Fruit;`);
    const fruit = Object.assign(new Fruit(), { exitPath: [[1]], exiting: true });
    fruit.reset();
    assert.equal(fruit.exitPath, null);
    assert.equal(fruit.exiting, false);
});

function maze(world = 0, stage = 0) {
    const bytes = readFileSync(new URL(`../pwa/public/stages/stage_${world}_${stage}.dat`, import.meta.url));
    let offset = 8;
    const grid = () => Array.from({ length: 31 }, () => Array.from({ length: 28 }, () => bytes[offset++]));
    const tileMap = grid(),
        regionMap = grid(),
        homeTree = grid();
    return {
        tileMap,
        regionMap,
        homeTree,
        typeMap: tileMap.map((row) => row.map((tile) => (tile === 47 ? 0 : tile === 48 ? 1 : tile === 49 ? 2 : 3))),
        regionCounts: Array(256).fill(0)
    };
}
function fixture(index = 0, maps = maze()) {
    const sounds = [],
        main = { stageIndex: 0, score: 0, lives: 3, playSound: (s) => sounds.push(s), ateGhostSound: "eaten", random: { nextInt: () => 0 } };
    const playing = Object.assign(new PlayingMode(), maps, {
        main,
        mspacman: { x: 216, y: 176, speed: 1 },
        pelletsRemaining: 100,
        pelletCountFraction: 0.001,
        ghostPointsIndex: -1,
        showGhostPoints: false,
        eatenGhost: null,
        playerKilledFlag: false,
        ghostsBlueOffset: 0
    });
    const ghost = Object.assign(new Ghost(), { main, playingMode: playing, ghostIndex: index, x: 216, y: 224, direction: 0 });
    ghost.reset();
    ghost.inHome = true;
    ghost.exitingHome = true;
    ghost.blue = true;
    playing.ghosts = [ghost];
    playing.incrementRegionCount(ghost);
    return { ghost, playing, main, sounds };
}
function occupancy({ playing }) {
    const expected = Array(256).fill(0);
    for (const g of playing.ghosts) {
        const r = playing.regionMap[playing.tileY(g.y)][playing.tileX(g.x)];
        if (r > 0) expected[r]++;
    }
    assert.deepEqual(playing.regionCounts, expected, "real region transaction remains balanced");
}

test("actual frightened house exit and capture enters immediately for every identity", () => {
    for (let index = 0; index < 4; index++) {
        const f = fixture(index),
            { ghost: g, playing: w, main, sounds } = f;
        for (let i = 0; g.inHome && i < 200; i++) {
            g.update(null);
            occupancy(f);
        }
        assert.equal(g.inHome, false);
        assert.equal(g.x, 216);
        assert.equal(g.y, 176);
        assert.equal(g.direction, 0);
        for (let i = 0; !g.eyeBalls && i < 4; i++) g.update(null);
        assert(g.eyeBalls && w.showGhostPoints);
        assert.equal(w.showGhostPointsTimer, 91);
        assert.equal(main.score, 200);
        assert.deepEqual(sounds, ["eaten"]);
        const before = JSON.stringify([g.x, g.y, g.speedRemainder]);
        g.update(null);
        assert.equal(JSON.stringify([g.x, g.y, g.speedRemainder]), before, "newly eaten ghost pauses");
        // Exactly the first return-routing opportunity, without changing facing or position.
        g.moveEyeBalls();
        assert.equal(g.y, 176, "eyes must not depart an already reached doorway");
        assert.equal(g.x, 216);
        assert(g.enteringHome && !g.inHome && g.eyeBalls);
        w.showGhostPoints = false;
        for (let i = 0; g.eyeBalls && i < 400; i++) {
            g.update(null);
            occupancy(f);
            assert(g.y >= 176 && g.y <= 224);
        }
        assert(!g.eyeBalls && g.inHome && g.exitingHome && !g.blue && !g.enteringHome);
        assert.equal(g.x, index === 2 ? 184 : index === 3 ? 248 : 216);
        assert.equal(g.y, 224);
        assert.equal(main.score, 200);
        assert.deepEqual(sounds, ["eaten"], "entry does not replay capture");
        w.mspacman = { x: 400, y: 400, speed: 1 };
        for (let i = 0; g.inHome && i < 300; i++) {
            g.update(null);
            occupancy(f);
        }
        assert(!g.inHome && !g.eyeBalls);
        assert.equal(g.y, 176);
        assert.equal(g.x, 216);
    }
});

test("house alignment facing follows movement without changing its path", () => {
    for (const [y, direction, next] of [
        [223, 1, 224],
        [225, 0, 224]
    ]) {
        const { ghost: g } = fixture(2);
        g.x = 184;
        g.y = y;
        g.moveInHome();
        assert.equal(g.y, next);
        assert.equal(g.x, 184);
        assert.equal(g.direction, direction);
        assert(g.inHome && g.exitingHome && g.blue);
    }
});

test("doorway headings, one-pixel neighbors and fractional entry preserve dispatch", () => {
    for (let direction = 0; direction < 4; direction++) {
        const { ghost: g } = fixture();
        Object.assign(g, { inHome: false, eyeBalls: true, y: 176, direction });
        g.getHomeDirection = () => {
            throw Error("doorway must not route");
        };
        g.moveEyeBalls();
        assert(g.enteringHome);
        assert.equal(g.y, 176);
        assert.equal(g.direction, direction);
    }
    for (const [x, direction] of [
        [215, 3],
        [217, 2]
    ]) {
        const { ghost: g } = fixture();
        Object.assign(g, { x, y: 176, inHome: false, eyeBalls: true, direction });
        g.moveEyeBalls();
        assert.equal(g.x, 216);
        assert(g.enteringHome);
    }
    for (const remainder of [0, 0.25, 0.5, 0.9]) {
        const f = fixture(),
            g = f.ghost;
        f.playing.decrementRegionCount(g);
        Object.assign(g, { inHome: false, eyeBalls: true, y: 176, speedRemainder: remainder });
        f.playing.incrementRegionCount(g);
        g.update(null);
        occupancy(f);
        assert(g.enteringHome);
        assert.equal(g.x, 216);
        assert.equal(g.y, remainder >= 0.5 ? 177 : 176);
        assert(g.speedRemainder >= 0 && g.speedRemainder < 1);
    }
});

test("all 32 authored home trees route both approach nodes and every routed junction", () => {
    const directions = new Set();
    let routes = 0;
    for (let world = 0; world < 4; world++)
        for (let stage = 0; stage < 8; stage++) {
            const maps = maze(world, stage);
            for (const x of [208, 224]) {
                const { ghost: g } = fixture(0, maps);
                Object.assign(g, { x, y: 176, inHome: false, eyeBalls: true });
                for (let i = 0; !g.enteringHome && i < 32; i++) g.moveEyeBalls();
                assert(g.enteringHome, `${world}/${stage} approach ${x}`);
            }
            for (let y = 0; y < 31; y++)
                for (let x = 0; x < 28; x++)
                    if (maps.homeTree[y][x] >= 1 && maps.homeTree[y][x] <= 5) {
                        directions.add(maps.homeTree[y][x]);
                        const { ghost: g } = fixture(0, maps);
                        Object.assign(g, { x: x * 16, y: y * 16, inHome: false, eyeBalls: true });
                        const seen = new Set();
                        for (let i = 0; !g.enteringHome && i < 3000; i++) {
                            const key = `${g.x}/${g.y}/${g.direction}`;
                            assert(!seen.has(key), `route cycle ${world}/${stage} at ${key}`);
                            seen.add(key);
                            g.moveEyeBalls();
                            if (g.x >= 448) g.x -= 448;
                            else if (g.x <= -32) g.x += 448;
                            if (g.y >= 496) g.y -= 496;
                            else if (g.y <= -32) g.y += 496;
                        }
                        assert(g.enteringHome, `route ${world}/${stage}/${x}/${y}`);
                        routes++;
                    }
        }
    assert.deepEqual([...directions].sort(), [1, 2, 3, 4, 5]);
    assert(routes > 1000);
});

test("returning eyes ignore energizer reversal and render actual direction sprites", () => {
    const { ghost: g, playing: w, main } = fixture();
    Object.assign(g, { inHome: false, eyeBalls: true, y: 176, direction: 0 });
    w.ghosts = [g, g, g, g];
    w.ateEnergizer(91);
    assert.equal(g.direction, 0);
    g.moveEyeBalls();
    assert(g.enteringHome);
    const drawn = [];
    g.draw = (image) => drawn.push(image);
    main.eyeBallsSprites = ["up", "down", "left", "right"];
    g.enterHome();
    g.render(null, null);
    assert.deepEqual(drawn, ["down"]);
    const other = Object.assign(new Ghost(), g, { x: 208, y: 176, enteringHome: false, direction: 3 });
    w.ghosts = [g, other];
    w.showGhostPoints = true;
    w.eatenGhost = g;
    const y = g.y;
    g.update(null);
    assert.equal(g.y, y);
    other.update(null);
    assert(other.x > 208, "other returning eyes continue during points");
});
