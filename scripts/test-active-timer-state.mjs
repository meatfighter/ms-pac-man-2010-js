import assert from "node:assert/strict";
import { test } from "node:test";
import { withCounterModules, replace } from "./counter-test-utils.mjs";

async function suite(run, mutation = (s) => s) {
    await withCounterModules(
        {
            "persistence/MsPacManGameStateSerializer": (s) => mutation(s) + "\nexport {isValidPlayingModeFieldState, isValidThingFieldState};"
        },
        async (load) => {
            const validator = await load("persistence/MsPacManGameStateSerializer");
            const { PlayingMode } = await load("PlayingMode");
            const { MsPacMan } = await load("MsPacMan");
            const makeWorld = () => {
                const w = new PlayingMode();
                Object.assign(w, {
                    main: { demoMode: false, stageIndex: 0, score: 0, lives: 5, random: { nextFloat: () => 0 }, playSound() {}, stopSound() {} },
                    input: {},
                    pelletCount: 10,
                    pelletsRemaining: 9,
                    pelletCountFraction: 0.1,
                    regionCounts: [0],
                    exitIndex: 1,
                    exitDelay: 0,
                    exitDelayTarget: 273,
                    fruitOdds: 0.5,
                    redPelletOdds: 0.25,
                    stageMessage: "STAGE 1 OF 8",
                    readyTimer: 0,
                    fadeState: PlayingMode.FADE_NONE,
                    mspacman: { x: 0, y: 0, update() {}, boostSpeed() {} },
                    ghosts: Array.from({ length: 4 }, () => ({ blue: false, eyeBalls: false, exitingHome: false, update() {}, reverseDirection() {} }))
                });
                return w;
            };
            await run({ validator, PlayingMode, MsPacMan, makeWorld });
        }
    );
}

async function boundaryProbe(mutation = (s) => s) {
    await suite(({ validator, MsPacMan, makeWorld }) => {
        const W = validator.isValidPlayingModeFieldState;
        const P = (r) => validator.isValidThingFieldState(r, "mspacman");
        const w = makeWorld();
        assert.equal(W(w), true, "field-level world control; not a whole-snapshot fixture");
        for (const timer of [0, 1, 100000]) {
            assert.equal(W({ ...w, ghostsBlue: true, ghostsBlueTimer: timer }), timer > 0);
            assert.equal(W({ ...w, ghostsBlue: false, ghostsBlueTimer: timer }), true);
        }
        for (const flag of ["redEnergizerPresent", "greenEnergizerPresent"])
            for (const timer of [0, 636, 637]) {
                assert.equal(W({ ...w, [flag]: true, energizerTimer: timer }), timer < 637);
                assert.equal(W({ ...w, [flag]: false, energizerTimer: timer }), true);
            }
        for (const index of [1, 2, 3, 4])
            for (const delay of [0, 272, 273, 10000]) assert.equal(W({ ...w, exitIndex: index, exitDelay: delay }), index === 4 || delay < 273);
        for (const timer of [0, 909, 910]) {
            assert.equal(W({ ...w, fruitTargetTimer: timer }), timer < 910);
            for (const flag of ["fruitTargetPresent", "redEnergizerPresent", "greenEnergizerPresent"])
                assert.equal(W({ ...w, [flag]: true, fruitTargetTimer: timer }), timer < 910, "spawn domain survives bonus expiry");
        }
        const p = new MsPacMan(w);
        p.reset();
        assert.equal(P(p), true);
        for (const [flag, counter] of [
            ["pellotDampensSpeed", "pellotDampensSpeedCount"],
            ["corneringEnhancesSpeed", "corneringEnhancesSpeedCount"]
        ]) {
            for (const n of [0, 1, 10]) {
                assert.equal(P({ ...p, [flag]: true, [counter]: n }), n > 0);
                assert.equal(P({ ...p, [flag]: false, [counter]: n }), true);
            }
        }
        for (const n of [0, 636, 637]) {
            assert.equal(P({ ...p, speedBoost: true, speedBoostTimer: n }), n < 637);
            assert.equal(P({ ...p, speedBoost: false, speedBoostTimer: n }), true);
        }
    }, mutation);
}
test("active timers reject skipped equality boundaries without constraining inactive sentinels", () => boundaryProbe());

test("actual timer-producing methods clear or reset at the accepted last step", async () => {
    await suite(({ validator, MsPacMan, makeWorld }) => {
        const W = validator.isValidPlayingModeFieldState;
        const P = (r) => validator.isValidThingFieldState(r, "mspacman");
        for (const [flag, counter] of [
            ["pellotDampensSpeed", "pellotDampensSpeedCount"],
            ["corneringEnhancesSpeed", "corneringEnhancesSpeedCount"]
        ]) {
            const w = makeWorld(),
                p = new MsPacMan(w);
            p.reset();
            // Valid late boundary; zero movement isolates the actual modifier-update branch.
            p.speed = 0;
            p.speedRemainder = 0;
            p[flag] = true;
            p[counter] = 1;
            assert.equal(P(p), true);
            p.update({});
            assert.equal(p[flag], false);
            assert.equal(p[counter], 0);
            assert.equal(P(p), true);
        }
        {
            const p = new MsPacMan(makeWorld());
            p.reset();
            p.speed = 0;
            p.speedRemainder = 0;
            p.boostSpeed();
            assert.equal(P(p), true);
            for (let n = 0; n < 637; n++) {
                p.update({});
                assert.equal(P(p), true);
            }
            assert.equal(p.speedBoost, false);
            assert.equal(p.speedBoostTimer, 0);
        }
        {
            const w = makeWorld();
            w.ateEnergizer();
            w.ghostsBlueTimer = 1;
            assert.equal(W(w), true);
            w.update({});
            assert.equal(w.ghostsBlue, false);
            assert.equal(w.ghostsBlueTimer, 0);
            assert.equal(W(w), true);
        }
        for (const name of ["Red", "Green"]) {
            const w = makeWorld();
            w["create" + name + "Energizer"]();
            w.energizerTimer = 636;
            assert.equal(W(w), true);
            w.update({});
            assert.equal(w[name.toLowerCase() + "EnergizerPresent"], false);
            assert.equal(w.energizerTimer, 637);
            assert.equal(W(w), true);
        }
        for (const index of [1, 2, 3]) {
            const w = makeWorld();
            w.exitIndex = index;
            w.exitDelay = 272;
            assert.equal(W(w), true);
            w.update({});
            assert.equal(w.exitIndex, index + 1);
            assert.equal(w.exitDelay, 0);
            assert.equal(w.ghosts[index].exitingHome, true);
            assert.equal(W(w), true);
        }
        {
            const w = makeWorld();
            w.fruitTargetTimer = 909;
            assert.equal(W(w), true);
            w.update({});
            assert.equal(w.fruitTargetTimer, 0);
            assert.equal(w.greenEnergizerPresent, true);
            assert.equal(W(w), true);
        }
    });
});

test("each active timer clause defeats isolated behavioral mutants", async () => {
    await boundaryProbe();
    for (const [from, to] of [
        ["!fields.ghostsBlue || fields.ghostsBlueTimer > 0", "true"],
        ["!(fields.redEnergizerPresent || fields.greenEnergizerPresent) || fields.energizerTimer < 7 * 91", "true"],
        ["fields.exitIndex === 4 || fields.exitDelay < fields.exitDelayTarget", "true"],
        ["!record.pellotDampensSpeed || record.pellotDampensSpeedCount > 0", "true"],
        ["!record.corneringEnhancesSpeed || record.corneringEnhancesSpeedCount > 0", "true"],
        ["!record.speedBoost || record.speedBoostTimer < 7 * 91", "true"],
        ["!fields.ghostsBlue || fields.ghostsBlueTimer > 0", "!fields.ghostsBlue || fields.ghostsBlueTimer >= 0"],
        [
            "!(fields.redEnergizerPresent || fields.greenEnergizerPresent) || fields.energizerTimer < 7 * 91",
            "!(fields.redEnergizerPresent || fields.greenEnergizerPresent) || fields.energizerTimer <= 7 * 91"
        ],
        ["fields.exitIndex === 4 || fields.exitDelay < fields.exitDelayTarget", "fields.exitIndex === 4 || fields.exitDelay <= fields.exitDelayTarget"],
        ["!record.pellotDampensSpeed || record.pellotDampensSpeedCount > 0", "!record.pellotDampensSpeed || record.pellotDampensSpeedCount >= 0"],
        [
            "!record.corneringEnhancesSpeed || record.corneringEnhancesSpeedCount > 0",
            "!record.corneringEnhancesSpeed || record.corneringEnhancesSpeedCount >= 0"
        ],
        ["!record.speedBoost || record.speedBoostTimer < 7 * 91", "!record.speedBoost || record.speedBoostTimer <= 7 * 91"],
        ["!fields.ghostsBlue || fields.ghostsBlueTimer > 0", "false || fields.ghostsBlueTimer > 0"],
        ["!record.pellotDampensSpeed || record.pellotDampensSpeedCount > 0", "false || record.pellotDampensSpeedCount > 0"],
        ["!record.corneringEnhancesSpeed || record.corneringEnhancesSpeedCount > 0", "false || record.corneringEnhancesSpeedCount > 0"],
        [
            "!record.speedBoost || record.speedBoostTimer < 7 * 91",
            "record.speedBoost ? record.speedBoostTimer > 0 && record.speedBoostTimer < 7 * 91 : record.speedBoostTimer === 0"
        ],
        ["fields.exitIndex === 4 || fields.exitDelay < fields.exitDelayTarget", "fields.exitDelay < fields.exitDelayTarget"],
        ["isIntegerInRange(fields.fruitTargetTimer, 0, 10 * 91 - 1)", "isIntegerInRange(fields.fruitTargetTimer, 0, 10 * 91)"],
        [
            "isIntegerInRange(fields.fruitTargetTimer, 0, 10 * 91 - 1)",
            "((fields.redEnergizerPresent || fields.greenEnergizerPresent) ? isIntegerInRange(fields.fruitTargetTimer, 0, 10 * 91) : isIntegerInRange(fields.fruitTargetTimer, 0, 10 * 91 - 1))"
        ]
    ])
        await assert.rejects(
            boundaryProbe((s) => replace(s, from, to)),
            (e) => e.code === "ERR_ASSERTION" && e.operator === "strictEqual"
        );
    for (const [from, to] of [
        [
            "!record.pellotDampensSpeed || record.pellotDampensSpeedCount > 0",
            "record.pellotDampensSpeed ? record.pellotDampensSpeedCount > 0 : record.pellotDampensSpeedCount === 0"
        ],
        [
            "!record.corneringEnhancesSpeed || record.corneringEnhancesSpeedCount > 0",
            "record.corneringEnhancesSpeed ? record.corneringEnhancesSpeedCount > 0 : record.corneringEnhancesSpeedCount === 0"
        ],
        ["!record.speedBoost || record.speedBoostTimer < 7 * 91", "record.speedBoost ? record.speedBoostTimer < 7 * 91 : record.speedBoostTimer === 0"],
        ["!fields.ghostsBlue || fields.ghostsBlueTimer > 0", "fields.ghostsBlue ? fields.ghostsBlueTimer > 0 : fields.ghostsBlueTimer === 0"],
        [
            "!(fields.redEnergizerPresent || fields.greenEnergizerPresent) || fields.energizerTimer < 7 * 91",
            "(fields.redEnergizerPresent || fields.greenEnergizerPresent) ? fields.energizerTimer < 7 * 91 : fields.energizerTimer === 0"
        ]
    ])
        await assert.rejects(
            boundaryProbe((s) => replace(s, from, to)),
            (e) => e.code === "ERR_ASSERTION" && e.operator === "strictEqual"
        );
    await boundaryProbe();
});
