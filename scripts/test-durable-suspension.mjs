import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const mutations = {
    "cleanup-first": ["SessionCleanup", "this.trySave(save);", "this.run(...steps); this.trySave(save);", "one early write precedes every resource cleanup"],
    "final-target": ["FrozenGameSave", "&& options.sameTarget() &&", "&& true &&", "late same loss is checked immediately before setItem"],
    "final-owner": ["FrozenGameSave", "&& options.owned();", "&& true;", "late owned loss is checked immediately before setItem"],
    "nested-save": [
        "SessionCleanup",
        "if (outermost && frozenSafely",
        "if (frozenSafely",
        "reentrant cleanup cannot capture partially retired state or overwrite early save"
    ],
    "unsafe-save": [
        "SessionCleanup",
        "const frozenSafely = this.run(freeze);",
        "this.run(freeze); const frozenSafely = true;",
        "a pre-existing unsafe latch does not acquire new save authority"
    ],
    "unaccepted-save": ["FrozenGameSave", "!options.accepted()", "false", "false accepted denies capture"],
    "freeze-reentry": ["SessionCleanup", "&& revision === this.suspensionRevision", "", "reentry from freeze must not save after nested cleanup"],
    "storage-reentry": ["SessionCleanup", "this.saveRevision === this.suspensionRevision", "true", "reentry while resolving storage revokes the pending write"]
};
const mutant = process.env.DURABLE_SUSPENSION_MUTANT;
if (mutant) assert.ok(mutations[mutant], "Known independent mutation");
async function load(name) {
    let source = readFileSync(new URL(`../pwa/src/app/${name}.ts`, import.meta.url), "utf8");
    if (mutant) {
        const [module, before, after] = mutations[mutant];
        if (name === module) {
            assert.ok(source.includes(before), "Mutation anchor exists");
            source = source.replace(before, after);
        }
        if (mutant === "freeze-reentry" && name === "SessionCleanup") source = source.replace("this.saveRevision === this.suspensionRevision", "true");
        // Bypass both independent eligibility layers only for their named negative controls.
        if (mutant === "unsafe-save" && name === "FrozenGameSave") source = source.replaceAll("options.cleanupSafe()", "true");
        if (mutant === "unaccepted-save" && name === "FrozenGameSave") source = source.replaceAll("options.accepted()", "true");
    }
    const { outputText, diagnostics } = ts.transpileModule(source, {
        reportDiagnostics: true,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
    });
    assert.equal(diagnostics?.filter((d) => d.category === ts.DiagnosticCategory.Error).length ?? 0, 0, "Mutant transpiles successfully");
    return import("data:text/javascript;base64," + Buffer.from(outputText).toString("base64"));
}
const { SessionCleanup } = await load("SessionCleanup");
const { saveFrozenGame } = await load("FrozenGameSave");

function fixture() {
    const cleanup = new SessionCleanup(),
        events = [];
    const state = {
        owned: true,
        same: true,
        accepted: true,
        destroyed: false,
        frozen: false,
        ready: true,
        bytes: "previous-save",
        writes: 0,
        didSave: 0,
        failure: null,
        beforeWrite: null,
        afterWrite: null
    };
    const game = { isStateSaveReady: () => state.ready };
    const container = { isDestroyed: () => state.destroyed, isLoopSuspended: () => state.frozen };
    const options = {
        label: "test game state",
        reason: "pagehide",
        game,
        container,
        sameTarget: () => state.same,
        accepted: () => state.accepted && cleanup.saveAllowed,
        owned: () => state.owned,
        cleanupSafe: () => cleanup.safe,
        write: (authorized) => {
            events.push("capture");
            if (state.failure !== null) return { saved: false, reason: state.failure };
            state.beforeWrite?.();
            if (!authorized()) return { saved: false, reason: "not-authorized" };
            events.push("setItem");
            state.bytes = "new-save";
            state.writes++;
            state.afterWrite?.();
            return { saved: true };
        },
        didSave: () => {
            state.didSave++;
        }
    };
    const freeze = () => {
        events.push("freeze");
        state.frozen = true;
    };
    const save = () => saveFrozenGame(options);
    const resources = ["game-suspend", "input", "rumble", "audio", "wake", "ui"].map((name) => () => events.push(name));
    return { cleanup, events, state, options, freeze, save, resources };
}

test("one early write precedes every resource cleanup", () => {
    const f = fixture();
    assert(f.cleanup.freezeSaveAndRun(f.freeze, f.save, ...f.resources));
    assert.deepEqual(f.events, ["freeze", "capture", "setItem", "game-suspend", "input", "rumble", "audio", "wake", "ui"]);
    assert.equal(f.state.writes, 1);
    assert.equal(f.state.didSave, 1);
});
for (const failing of ["game-suspend", "input", "rumble", "audio", "wake", "ui"]) {
    test(`a ${failing} failure cannot revoke the already completed save`, () => {
        const f = fixture();
        const steps = ["game-suspend", "input", "rumble", "audio", "wake", "ui"].map((name) => () => {
            f.events.push(name);
            if (name === failing) throw Error(name);
        });
        assert.equal(f.cleanup.freezeSaveAndRun(f.freeze, f.save, ...steps), false);
        assert.equal(f.state.bytes, "new-save");
        assert.equal(f.state.writes, 1);
        assert.equal(f.events.at(-1), "ui");
        assert.throws(() => f.cleanup.assertSafe());
    });
}
test("freeze failure prevents capture but does not skip other cleanup", () => {
    const f = fixture();
    assert.equal(
        f.cleanup.freezeSaveAndRun(
            () => {
                throw Error("freeze");
            },
            f.save,
            ...f.resources
        ),
        false
    );
    assert.equal(f.state.bytes, "previous-save");
    assert.equal(f.state.writes, 0);
    assert.equal(f.events.at(-1), "ui");
});
test("a pre-existing unsafe latch does not acquire new save authority", () => {
    const f = fixture();
    f.cleanup.run(() => {
        throw Error("earlier failure");
    });
    assert.equal(f.cleanup.freezeSaveAndRun(f.freeze, f.save, ...f.resources), false);
    assert.equal(f.state.writes, 0);
    assert.equal(f.events.at(-1), "ui");
});
for (const reason of ["capture-failed", "invalid-snapshot", "encode-failed", "too-large", "write-failed", "not-authorized"]) {
    test(`${reason} retains old bytes, completes cleanup, and is not retried`, () => {
        const f = fixture();
        f.state.failure = reason;
        assert(f.cleanup.freezeSaveAndRun(f.freeze, f.save, ...f.resources));
        assert.equal(f.state.bytes, "previous-save");
        assert.equal(f.events.filter((x) => x === "capture").length, 1);
        assert.equal(f.events.at(-1), "ui");
        assert.equal(f.state.didSave, 0);
    });
}
test("unexpected save throw and failing console still cannot prevent cleanup", () => {
    const f = fixture(),
        warn = console.warn;
    try {
        console.warn = () => {
            throw Error("console");
        };
        assert(
            f.cleanup.freezeSaveAndRun(
                f.freeze,
                () => {
                    throw Error("save");
                },
                ...f.resources
            )
        );
    } finally {
        console.warn = warn;
    }
    assert.equal(f.events.at(-1), "ui");
    assert.equal(f.state.writes, 0);
});
for (const property of ["owned", "same", "accepted", "ready"]) {
    test(`false ${property} denies capture`, () => {
        const f = fixture();
        f.state[property] = false;
        f.cleanup.freezeSaveAndRun(f.freeze, f.save, ...f.resources);
        assert.equal(f.state.writes, 0);
        assert(!f.events.includes("capture"));
    });
}
test("destroyed and not-actually-frozen containers cannot save", () => {
    for (const destroyed of [false, true]) {
        const f = fixture();
        f.state.destroyed = destroyed;
        f.cleanup.freezeSaveAndRun(() => {}, f.save, ...f.resources);
        assert.equal(f.state.writes, 0);
    }
});
test("null/unaccepted starting target is a no-op and cleanup still executes", () => {
    const f = fixture();
    f.options.game = null;
    f.options.container = null;
    assert(f.cleanup.freezeSaveAndRun(f.freeze, f.save, ...f.resources));
    assert.equal(f.state.writes, 0);
});
test("interrupted retained Continue can explicitly suppress another save", () => {
    const f = fixture();
    assert(f.cleanup.freezeSaveAndRun(f.freeze, null, ...f.resources));
    assert.equal(f.state.writes, 0);
    assert.equal(f.events.at(-1), "ui");
});
for (const property of ["owned", "same", "accepted"]) {
    test(`late ${property} loss is checked immediately before setItem`, () => {
        const f = fixture();
        f.state.beforeWrite = () => {
            f.state[property] = false;
        };
        assert(f.cleanup.freezeSaveAndRun(f.freeze, f.save, ...f.resources));
        assert.equal(f.state.writes, 0);
    });
}
test("late unsafe latch blocks the pending write", () => {
    const f = fixture();
    f.state.beforeWrite = () =>
        f.cleanup.run(() => {
            throw Error("reentry");
        });
    assert.equal(f.cleanup.freezeSaveAndRun(f.freeze, f.save, ...f.resources), false);
    assert.equal(f.state.writes, 0);
});
test("successful native write does not bless a replaced runtime", () => {
    const f = fixture();
    f.state.afterWrite = () => {
        f.state.same = false;
    };
    assert(f.cleanup.freezeSaveAndRun(f.freeze, f.save, ...f.resources));
    assert.equal(f.state.writes, 1);
    assert.equal(f.state.didSave, 0);
});
test("reentrant cleanup cannot capture partially retired state or overwrite early save", () => {
    const f = fixture();
    let nested = 0;
    assert(
        f.cleanup.freezeSaveAndRun(
            f.freeze,
            f.save,
            () => {
                f.cleanup.freezeSaveAndRun(
                    f.freeze,
                    () => {
                        nested++;
                        return false;
                    },
                    ...f.resources
                );
            },
            ...f.resources
        )
    );
    assert.equal(nested, 0);
    assert.equal(f.state.writes, 1);
});
test("later separate ownership-release boundary remains eligible", () => {
    const f = fixture();
    f.cleanup.freezeSaveAndRun(f.freeze, f.save, ...f.resources);
    f.cleanup.freezeSaveAndRun(f.freeze, f.save, ...f.resources);
    assert.equal(f.state.writes, 2);
});
test("hung cleanup promise is not awaited; early save already completed", () => {
    const f = fixture();
    let called = false;
    assert(
        f.cleanup.freezeSaveAndRun(
            f.freeze,
            f.save,
            () => {
                called = true;
                return new Promise(() => {});
            },
            ...f.resources
        )
    );
    assert(called);
    assert.equal(f.state.bytes, "new-save");
    assert.equal(f.events.at(-1), "ui");
});
test("bounded synchronous hardware delay occurs after setItem", () => {
    const f = fixture();
    f.cleanup.freezeSaveAndRun(f.freeze, f.save, () => {
        assert.equal(f.state.bytes, "new-save");
        const until = performance.now() + 5;
        while (performance.now() < until) {
            /* Bounded synchronous hardware delay. */
        }
    });
    assert.equal(f.state.writes, 1);
});
test("unavailable store produces failure without invalidating the live runtime", () => {
    const f = fixture();
    f.options.write = () => null;
    assert(f.cleanup.freezeSaveAndRun(f.freeze, f.save, ...f.resources));
    assert.equal(f.state.bytes, "previous-save");
});

test("reentry from freeze must not save after nested cleanup", () => {
    const f = fixture();
    f.cleanup.freezeSaveAndRun(
        () => {
            f.freeze();
            f.cleanup.freezeSaveAndRun(f.freeze, f.save, ...f.resources);
        },
        f.save,
        ...f.resources
    );
    assert.equal(f.state.writes, 0, "No late save after nested freeze cleanup");
    assert.equal(f.cleanup.safe, true, "Reentry does not invent a resource failure");
    f.cleanup.freezeSaveAndRun(f.freeze, f.save, ...f.resources);
    assert.equal(f.state.writes, 1, "Later independent boundary remains eligible");
});
test("reentry while resolving storage revokes the pending write", () => {
    const f = fixture();
    f.state.beforeWrite = () => f.cleanup.freezeSaveAndRun(f.freeze, f.save, ...f.resources);
    f.cleanup.freezeSaveAndRun(f.freeze, f.save, ...f.resources);
    assert.equal(f.state.writes, 0, "Final guard rejects capture overtaken by nested cleanup");
    assert.equal(f.cleanup.safe, true);
});

if (!mutant)
    for (const [name, [, , , assertion]] of Object.entries(mutations)) {
        test(`independent mutant ${name} fails its behavioral assertion`, () => {
            const env = { ...process.env, DURABLE_SUSPENSION_MUTANT: name };
            delete env.NODE_TEST_CONTEXT;
            const result = spawnSync(
                process.execPath,
                ["--test", "--test-reporter=tap", "--test-name-pattern", `^${assertion}$`, fileURLToPath(import.meta.url)],
                {
                    env,
                    encoding: "utf8",
                    timeout: 30000
                }
            );
            assert.equal(result.error, undefined);
            assert.equal(result.status, 1, result.stdout + result.stderr);
            assert.ok(result.stdout.includes("not ok 1 - " + assertion), result.stdout + result.stderr);
            assert.match(result.stdout, /ERR_ASSERTION/);
            assert.doesNotMatch(result.stdout + result.stderr, /SyntaxError|Mutation anchor exists|Mutant transpiles successfully/);
        });
    }
