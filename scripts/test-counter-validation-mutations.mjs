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
            for (const [id, key] of [
                ["enterInitials", "redOffset"],
                ["selectWorld", "angleOffset"]
            ]) {
                assert.equal(valid(sample(id, { [key]: 100001 })), true, "accumulator positive");
                for (const value of [-1, Infinity]) assert.equal(valid(sample(id, { [key]: value })), false, "accumulator negative");
                assert.equal(valid(sample("attract", { [key]: 100001 })), false, "exact mode scope");
                assert.equal(valid(sample(id, { nested: { [key]: 100001 } })), false, "exact path scope");
                assert.equal(valid(sample(id, { x: 100001 })), false, "unrelated guard");
            }
            assert.equal(valid(sample("enterInitials", { redOffset: 0.5 })), false, "integer red");
            assert.equal(valid(sample("enterInitials", { redOffset: 2147483648 })), false, "integer maximum");
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
    for (const [from, to] of [
        ["current >= 0 && current <= JAVA_INT_MAX", "current >= 0 && current <= 100_000"],
        [
            'if (isModeField && modeId === "selectWorld" && key === "angleOffset") return current >= 0;',
            'if (isModeField && modeId === "selectWorld" && key === "angleOffset") return current >= 0 && current <= 100_000;'
        ],
        ["if (!Number.isFinite(current)) return false;", "if (false) return false;"],
        [
            'if (isModeField && modeId === "selectWorld" && key === "angleOffset") return current >= 0;',
            'if (isModeField && modeId === "selectWorld" && key === "angleOffset") return true;'
        ],
        ['modeId === "enterInitials"', "true"],
        ['modeId === "selectWorld"', "true"],
        ['path.length === 3 && path[0] === "mode" && path[1] === "fields"', "true"],
        ["Math.abs(current) <= MAX_GAMEPLAY_NUMBER_MAGNITUDE", "true"],
        ["current.length <= MAX_SNAPSHOT_STRING_LENGTH", "true"],
        ["Number.isInteger(current) && current >= 0 && current <= JAVA_INT_MAX", "current >= 0 && current <= JAVA_INT_MAX"],
        ["const MAX_GAMEPLAY_NUMBER_MAGNITUDE = 100_000", "const MAX_GAMEPLAY_NUMBER_MAGNITUDE = 1_000_000"]
    ])
        await assert.rejects(
            probe(
                (s) => s,
                (s) => replace(s, from, to)
            ),
            (e) => e.code === "ERR_ASSERTION" && /scope|guard|budget|integer red|accumulator positive|accumulator negative/.test(e.message)
        );
    await probe();
});
