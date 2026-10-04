import assert from "node:assert/strict";
import { test } from "node:test";
import { withCounterModules, replace } from "./counter-test-utils.mjs";

async function probe(mutation = (s) => s, policyMutation = (s) => s) {
    await withCounterModules(
        {
            "persistence/MsPacManGameStateSerializer": (s) => mutation(s) + "\nexport {isValidStandaloneModeFieldState, isValidPlayingObjectRelationships};",
            "persistence/SnapshotValuePolicy": policyMutation
        },
        async (load) => {
            const validator = await load("persistence/MsPacManGameStateSerializer");
            const { hasReasonableSnapshotValues: valid } = await load("persistence/SnapshotValuePolicy");
            const sample = (id, fields) => ({ mode: { id, fields } });
            for (const number of [-100001, 100001.5, 1000001, 2147483648, Number.MAX_SAFE_INTEGER, 1e20]) {
                assert.equal(valid(sample("enterInitials", { redOffset: number })), true, "no blanket magnitude guard");
                assert.equal(valid(sample("attract", { nested: { x: number } })), true, "no lexical or path guard");
            }
            for (const value of [NaN, Infinity, -Infinity]) assert.equal(valid({ value }), false, "finite JSON budget");
            assert.equal(valid({ text: "x".repeat(4096) }), true, "allowed JSON budget");
            assert.equal(valid({ text: "x".repeat(4097) }), false, "string budget");
            for (const [id, name] of [
                ["act1", "Act1Mode"],
                ["act3", "Act3Mode"],
                ["act4", "Act4Mode"]
            ]) {
                const C = (await load(name))[name],
                    mode = new C();
                mode.init({}, {});
                const fields = Object.fromEntries(Object.entries(mode).filter(([, value]) => typeof value !== "object"));
                const check = (f) => validator.isValidStandaloneModeFieldState(id, f);
                assert.equal(check(fields), true, "real initialized mode");
                if (id === "act1") {
                    assert.equal(check({ ...fields, state: 0, nextState: 1 }), true, "deferred state allowed");
                    for (const nextState of [-1, 3, 0.5]) assert.equal(check({ ...fields, nextState }), false, "nextState bound");
                } else {
                    assert.equal(check({ ...fields, storkSpriteIndex: 1, storkSpriteIndexIncrementor: 11 }), true, "stork positive");
                    for (const [key, bad] of [
                        ["storkSpriteIndex", 2],
                        ["storkSpriteIndexIncrementor", 12]
                    ])
                        assert.equal(check({ ...fields, [key]: bad }), false, "stork bounds");
                }
            }
            const { EnterInitialsMode } = await load("EnterInitialsMode");
            const initials = new EnterInitialsMode();
            initials.init({ tiles: [Array(50).fill({})], input: { clearKeyPressedRecord() {} }, score: 123 }, {});
            const initialFields = Object.fromEntries(Object.entries(initials).filter(([, v]) => typeof v !== "object"));
            assert.equal(validator.isValidStandaloneModeFieldState("enterInitials", { ...initialFields, dotsOffset: -32 }), true, "dots sentinel");
            assert.equal(
                validator.isValidStandaloneModeFieldState("enterInitials", { ...initialFields, redOffset: 2147483648 }),
                true,
                "large red accumulator"
            );
            for (const redOffset of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1])
                assert.equal(validator.isValidStandaloneModeFieldState("enterInitials", { ...initialFields, redOffset }), false, "exact red domain");
            const ghost = {
                fields: { showGhostPoints: true, ghostPointsIndex: 0, showGhostPointsTimer: 91 },
                eatenGhostIndex: 0,
                ghosts: [{ fields: { eyeBalls: true } }]
            };
            assert.equal(validator.isValidPlayingObjectRelationships(ghost), true, "ghost positive");
            assert.equal(
                validator.isValidPlayingObjectRelationships({
                    ...ghost,
                    eatenGhostIndex: null,
                    fields: { showGhostPoints: false, ghostPointsIndex: -1, showGhostPointsTimer: 0 }
                }),
                true,
                "inactive ghost sentinel"
            );
            for (const [key, bad] of [
                ["ghostPointsIndex", -1],
                ["showGhostPointsTimer", 0]
            ])
                assert.equal(validator.isValidPlayingObjectRelationships({ ...ghost, fields: { ...ghost.fields, [key]: bad } }), false, "active ghost guard");
        }
    );
}
test("precise Pac-Man guards reject behavioral mutants with green controls", async () => {
    await probe();
    for (const [from, to] of [
        [
            "const showGhostPoints = snapshot.fields.showGhostPoints === true;",
            "if (snapshot.fields.ghostPointsIndex === -1) return false; const showGhostPoints = snapshot.fields.showGhostPoints === true;"
        ],
        [
            'if (id === "act1" && !isIntegerInRange(fields.nextState, 0, 2))',
            'if (id === "act1" && (fields.state !== fields.nextState || !isIntegerInRange(fields.nextState, 0, 2)))'
        ],
        ["isIntegerInRange(fields.dotsOffset, -32, 0)", "isIntegerInRange(fields.dotsOffset, -31, 0)"],
        ["isIntegerInRange(fields.nextState, 0, 2)", "isIntegerInRange(fields.nextState, -1, 3)"],
        ["isIntegerInRange(fields.storkSpriteIndex, 0, 1)", "isIntegerInRange(fields.storkSpriteIndex, 0, 2)"],
        ["isIntegerInRange(fields.storkSpriteIndexIncrementor, 0, 11)", "isIntegerInRange(fields.storkSpriteIndexIncrementor, 0, 12)"],
        ["isIntegerInRange(snapshot.fields.ghostPointsIndex, 0, 3)", "isIntegerInRange(snapshot.fields.ghostPointsIndex, -1, 3)"],
        ["isIntegerInRange(snapshot.fields.showGhostPointsTimer, 1, 91)", "isIntegerInRange(snapshot.fields.showGhostPointsTimer, 0, 91)"]
    ])
        await assert.rejects(
            probe((s) => replace(s, from, to)),
            (e) =>
                e.code === "ERR_ASSERTION" &&
                /nextState bound|stork bounds|active ghost guard|inactive ghost sentinel|deferred state allowed|dots sentinel/.test(e.message)
        );
    // Mutation checks for the new single JSON-budget wrapper. Precise domains
    // remain tested above and by the real producer tests, not duplicated here.
    const anchor = "return isSnapshotJsonWithinBudget(value);";
    for (const replacement of [
        "return true;",
        "return isSnapshotJsonWithinBudget(value) && JSON.stringify(value).length < 1000;",
        'const stack = [value]; while (stack.length) { const v = stack.pop(); if (typeof v === "number" && Math.abs(v) > 100000) return false; if (v && typeof v === "object") stack.push(...Object.values(v)); } return isSnapshotJsonWithinBudget(value);'
    ]) {
        await assert.rejects(
            probe(
                (s) => s,
                (s) => replace(s, anchor, replacement)
            ),
            (e) => e.code === "ERR_ASSERTION" && /budget|guard/.test(e.message)
        );
    }
    await probe();
});
