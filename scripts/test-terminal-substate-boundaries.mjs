import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Execute actual source methods against controlled dependencies.
const root = new URL("../", import.meta.url);
function methods(name, wanted) {
    const path = new URL(`pwa/src/mspacman/${name}.ts`, root);
    const file = ts.createSourceFile(path.pathname, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const cls = file.statements.find((n) => ts.isClassDeclaration(n) && n.name?.text === name);
    assert.ok(cls, `Missing ${name}`);
    return wanted
        .map((w) => {
            const found = cls.members.filter((n) => ts.isMethodDeclaration(n) && n.name.getText(file) === w && n.body);
            assert.equal(found.length, 1, `${name}.${w} must have one implementation`);
            return found[0].getText(file);
        })
        .join("\n");
}
const source = `
const toFloat = Math.fround;
const toInt = Math.trunc;
const intDiv = (x, y) => Math.trunc(x / y);
const INT_MAX = 2147483647;
const TYPE_EMPTY = 0, TYPE_PELLOT = 1, TYPE_ENERGIZER = 2;
const Main = {UP:0, DOWN:1, LEFT:2, RIGHT:3, RED:0, PINK:1, CYAN:2, ORANGE:3};
class PlayingMode {
  static FADE_NONE=0; static FADE_IN=1; static FADE_OUT=2;
  static FADE_REASON_KILLED=0; static FADE_REASON_ADVANCE=1; static FADE_REASON_GAME_OVER=2;
  ${methods("PlayingMode", ["update", "playerKilled", "atePellot", "ateEnergizer", "addPoints", "ghostEaten", "distance", "distanceToMsPacMan"])}
}
class MsPacMan {
  static CHOMP_SPEED=6;
  ${methods("MsPacMan", ["update", "boostSpeed", "corneringEnhancesSpeedNow", "updateSpriteIndexEating", "updateSpriteIndexWalled"])}
}
class Ghost {
  static FLUTTER_SPEED=15; static REVERSE_DIRECTION=[1,0,3,2];
  ${methods("Ghost", ["update", "getDist", "reverseDirection", "chase", "moveOnePixel"])}
}
({Main, PlayingMode, MsPacMan, Ghost});
`;
const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true });
assert.equal((result.diagnostics ?? []).filter((x) => x.category === ts.DiagnosticCategory.Error).length, 0);
const { Main, PlayingMode, MsPacMan, Ghost } = vm.runInNewContext(result.outputText, {}, { timeout: 1000 });

function fixture({ tile = 1, pellets = 1, contact = false, bonus = null, boost = false, score = 0 } = {}) {
    const events = [];
    const sounds = new Set();
    const counters = { inputs: 0, ghosts: [0, 0, 0, 0], substeps: [0, 0, 0, 0], decrements: 0, increments: 0, bonus: 0 };
    const main = {
        score,
        lives: 5,
        stageIndex: 7,
        demoMode: false,
        random: {
            nextFloat() {
                counters.bonus++;
                return 0.99;
            }
        },
        input: { isConfirmPressed: () => false },
        playSound(s) {
            events.push(`sound:${s}`);
            sounds.add(s);
        },
        stopAllSoundEffects() {
            events.push("stopSfx");
            sounds.clear();
        },
        stopAllSounds() {
            events.push("stopAll");
            sounds.clear();
        },
        fadeMusic() {
            events.push("fadeMusic");
        },
        stopSound(s) {
            sounds.delete(s);
        }
    };
    for (const k of [
        "clappingSound",
        "atePellotSound",
        "ateEnergizerSound",
        "blueGhostsSound",
        "extraLifeSound",
        "ateGhostSound",
        "fruitAppearedSound",
        "diedSound"
    ])
        main[k] = k;
    const world = Object.assign(new PlayingMode(), {
        main,
        finished: false,
        finishedTimer: 0,
        finishedWhite: false,
        finishedBlinkTimer: 0,
        gameOver: false,
        gameOverTimer: 0,
        fadeState: 0,
        fadeIndex: 0,
        readyTimer: 0,
        playerKilledFlag: false,
        musicFadeOutTimer: 0,
        playerSpiraling: false,
        spiralTimer: 0,
        energizersVisibleTimer: 0,
        energizersVisible: false,
        exitIndex: 4,
        exitDelay: 0,
        exitDelayTarget: 1,
        showGhostPoints: false,
        showGhostPointsTimer: 0,
        eatenGhost: null,
        ghostsBlue: false,
        ghostsBlueTimer: 0,
        ghostsBlueOffset: 0,
        ghostPointsIndex: -1,
        chaseModeToggleDelay: 0,
        chaseMode: false,
        redEnergizerPresent: bonus === "red",
        greenEnergizerPresent: bonus === "green",
        fruitTargetPresent: bonus === "fruit",
        fruitTargetTimer: bonus === "spawn" ? 909 : 0,
        energizerTimer: 0,
        pelletCount: 100,
        pelletCountFraction: 0.01,
        pelletsRemaining: pellets,
        fruitOdds: 0.25,
        redPelletOdds: 0.125,
        getRegionCount() {
            return 0;
        },
        decrementRegionCount() {
            counters.decrements++;
        },
        incrementRegionCount() {
            counters.increments++;
        },
        createFruit() {
            counters.bonus++;
        },
        createRedEnergizer() {
            counters.bonus++;
        },
        createGreenEnergizer() {
            counters.bonus++;
        },
        fruitTarget: {
            update() {
                counters.bonus++;
            }
        }
    });
    let remainingTile = tile;
    const player = Object.assign(new MsPacMan(), {
        main,
        playingMode: world,
        x: 216,
        y: 368,
        direction: Main.RIGHT,
        speed: Math.fround(1.75),
        speedRemainder: Math.fround(0.9),
        spriteIndex: 0,
        spriteIndexIncrementor: 0,
        pellotDampensSpeed: false,
        pellotDampensSpeedCount: 0,
        corneringEnhancesSpeed: false,
        corneringEnhancesSpeedCount: 0,
        speedBoost: boost,
        speedBoostTimer: 0,
        input: {
            isUp: () => false,
            isDown: () => false,
            isLeft: () => false,
            isRight: () => true,
            update() {
                counters.inputs++;
            }
        },
        getType() {
            return remainingTile;
        },
        setType(x, y, v) {
            remainingTile = v;
        },
        setTile() {},
        canMoveUp: () => true,
        canMoveDown: () => true,
        canMoveLeft: () => true,
        canMoveRight: () => true
    });
    world.mspacman = player;
    world.ghosts = Array.from({ length: 4 }, (_, index) => {
        const ghost = Object.assign(new Ghost(), {
            main,
            playingMode: world,
            ghostIndex: index,
            x: contact && index === 0 ? 217 : 400,
            y: contact && index === 0 ? 368 : 100,
            direction: Main.LEFT,
            speed: Math.fround(1.3),
            speedRemainder: Math.fround(0.9),
            spriteIndex: 0,
            spriteIndexIncrementor: 0,
            targetX: 216,
            targetY: 368,
            blue: false,
            eyeBalls: false,
            inHome: false,
            exitingHome: false,
            enteringHome: false,
            updateGhost() {
                counters.substeps[index]++;
            },
            moveRandomly() {},
            moveEyeBalls() {},
            enterHome() {},
            moveInHome() {},
            canMoveUp: () => true,
            canMoveDown: () => true,
            canMoveLeft: () => true,
            canMoveRight: () => true
        });
        const update = ghost.update;
        ghost.update = function (gc) {
            counters.ghosts[index]++;
            return update.call(this, gc);
        };
        return ghost;
    });
    return {
        world,
        player,
        main,
        events,
        sounds,
        counters,
        tick() {
            world.update({});
        }
    };
}
function fraction(v) {
    return Number.isFinite(v) && v >= 0 && v < 1;
}
function noBonus(f) {
    assert.equal(f.counters.bonus, 0);
    assert.equal(f.world.energizerTimer, 0);
}

for (const tile of [1, 2])
    test(`final tile ${tile}: completion owns remaining update and keeps all tile points`, () => {
        const f = fixture({ tile, contact: true, boost: true });
        f.tick();
        assert.equal(f.world.finished, true);
        assert.equal(f.world.playerKilledFlag, false, "completion followed by death");
        assert.equal(f.main.score, tile === 2 ? 60 : 10);
        assert.deepEqual([...f.sounds], ["clappingSound"], "post-completion sound or canceled applause");
        assert.deepEqual(f.counters.ghosts, [0, 0, 0, 0], "ghosts updated after completion");
        assert.equal(f.counters.inputs, 0, "outgoing player consumed controls");
        assert.equal(f.player.x, 216);
        assert.equal(f.player.y, 368);
        assert.ok(fraction(f.player.speedRemainder), "early return left an invalid movement remainder");
        noBonus(f);
    });
for (const bonus of ["red", "green", "fruit", "spawn"])
    test(`death boundary stops later ghosts and ${bonus} bonus processing`, () => {
        const f = fixture({ tile: 0, pellets: 5, contact: true, bonus });
        f.tick();
        assert.equal(f.world.playerKilledFlag, true);
        assert.equal(f.world.finished, false);
        assert.equal(f.main.score, 0, "award after death");
        assert.deepEqual(f.counters.ghosts, [1, 0, 0, 0], "later ghost updated after death");
        assert.equal(f.counters.substeps[0], 1, "killing ghost performed a second pixel step");
        assert.equal(f.events.filter((e) => e === "fadeMusic").length, 1, "death event repeated");
        assert.equal(f.counters.increments, f.counters.decrements, "region accounting unbalanced");
        assert.ok(fraction(f.world.ghosts[0].speedRemainder), "dead ghost snapshot movement remainder");
        assert.equal(f.events.at(-1), "fadeMusic");
        noBonus(f);
        if (bonus === "red") assert.equal(f.world.redEnergizerPresent, true);
        if (bonus === "green") assert.equal(f.world.greenEnergizerPresent, true);
        if (bonus === "spawn") assert.equal(f.world.fruitTargetTimer, 909);
    });
test("a post-death red bonus cannot manufacture a reserve life", () => {
    const f = fixture({ tile: 0, pellets: 5, contact: true, bonus: "red", score: 9950 });
    f.main.lives = 0;
    f.tick();
    assert.equal(f.world.playerKilledFlag, true);
    assert.equal(f.main.score, 9950);
    assert.equal(f.main.lives, 0);
});
test("normal movement, pellet score, energizer behavior and ghost ordering remain", () => {
    for (const tile of [0, 1, 2]) {
        const f = fixture({ tile, pellets: 5 });
        f.tick();
        assert.equal(f.world.finished, false);
        assert.equal(f.world.playerKilledFlag, false);
        assert.equal(f.main.score, tile === 2 ? 60 : tile === 1 ? 10 : 0);
        assert.equal(f.world.pelletsRemaining, tile === 0 ? 5 : 4);
        assert.deepEqual(f.counters.ghosts, [1, 1, 1, 1]);
        assert.ok(f.player.x > 216);
        assert.ok(fraction(f.player.speedRemainder));
        assert.equal(f.world.ghostsBlue, tile === 2);
    }
});
test("completion keeps the final energizer extra-life award before terminal audio cleanup", () => {
    const f = fixture({ tile: 2, score: 9950 });
    f.tick();
    assert.equal(f.main.score, 10010);
    assert.equal(f.main.lives, 6);
    assert.deepEqual([...f.sounds], ["clappingSound"]);
});
test("death notification is idempotent and cannot supersede completed stage", () => {
    const f = fixture();
    f.world.finished = true;
    f.world.playerKilled();
    assert.equal(f.events.length, 0);
    f.world.finished = false;
    f.world.playerKilled();
    f.world.musicFadeOutTimer = 12;
    f.world.spiralTimer = 3;
    const n = f.events.length;
    f.world.playerKilled();
    assert.equal(f.events.length, n);
    assert.equal(f.world.musicFadeOutTimer, 12);
    assert.equal(f.world.spiralTimer, 3);
});

test("ghost-point pause still updates returning eyes without resuming the player", () => {
    const f = fixture({ tile: 0, pellets: 5 });
    f.world.ghostEaten(f.world.ghosts[0]);
    f.world.ghosts[1].eyeBalls = true;
    f.tick();
    assert.equal(f.world.showGhostPoints, true);
    assert.equal(f.counters.inputs, 0);
    assert.equal(f.counters.substeps[0], 0);
    assert.ok(f.counters.substeps[1] > 0);
    assert.equal(f.world.playerKilledFlag, false);
});

test("the killing tunnel pixel wraps before restoring its region count", () => {
    const f = fixture({ tile: 0, pellets: 5 });
    const ghost = f.world.ghosts[0];
    ghost.x = -31;
    ghost.y = f.player.y;
    ghost.targetX = f.player.x = -32;
    ghost.targetY = f.player.y;
    ghost.update({});
    assert.equal(f.world.playerKilledFlag, true);
    assert.equal(ghost.x, 416);
    assert.equal(f.counters.decrements, 1);
    assert.equal(f.counters.increments, 1);
    assert.ok(fraction(ghost.speedRemainder));
});
