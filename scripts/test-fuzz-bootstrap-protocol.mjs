import assert from "node:assert/strict";
import { test } from "node:test";
import {
    classifyFailure,
    restoreWitness,
    invokeObservedRestore,
    eligibleFinding,
    ProtocolFailure,
    errorDetails
} from "./persistence-fuzz/failure-protocol.mjs";
import { loadDocument } from "./persistence-fuzz/document-loader.mjs";
import { Diagnostics } from "./persistence-fuzz/diagnostics.mjs";
import vm from "node:vm";

for (const operation of ["initial-entry", "corpus-restore", "cold-restore", "observer-writes", "observer-control", "departure-reload"]) {
    test(`${operation}: only the observed production boundary can reject a restore`, () => {
        const witness = restoreWitness(),
            context = { operation, stage: "restore", restoreWitness: witness };
        assert.equal(eligibleFinding(classifyFailure(new Error("RESTORE_REJECTED"), context)), false);
        let calls = 0;
        const store = {
            restore(main, gc) {
                assert.equal(this, store);
                assert.equal(main, 1);
                assert.equal(gc, 2);
                calls++;
                return false;
            }
        };
        witness.resourcesPrepared = witness.expectedBytesVerified = true;
        assert.equal(invokeObservedRestore(store, 1, 2, witness), false);
        assert.equal(calls, 1);
        const rejection = classifyFailure(new Error("failed"), context);
        assert.equal(rejection.category, "SAVE_SUCCEEDED_RESTORE_REJECTED");
        assert.equal(eligibleFinding(rejection), true);
        store.restore = () => {
            throw new Error("actual restore throw");
        };
        assert.throws(() => invokeObservedRestore(store, 1, 2, witness));
        assert.equal(classifyFailure(new Error("failed"), context).category, "RESTORE_THROW");
        store.restore = () => true;
        invokeObservedRestore(store, 1, 2, witness);
        assert.equal(classifyFailure(new Error("audio"), { ...context, stage: "audio-activation" }).category, "POST_RESTORE_FAILED");
        witness.completed = false;
        assert.equal(classifyFailure(new Error("hung"), context).category, "RESTORE_DID_NOT_COMPLETE");
        assert.equal(errorDetails(new ProtocolFailure(new Error("cause"), context)).record.operation, operation);
    });
}
function fixture({
    status = 200,
    mime = "text/html",
    protocol = 3,
    importFailure = false,
    missing = false,
    configureFailure = false,
    restoreResult = true
} = {}) {
    const window = {},
        polls = [];
    let url;
    const page = {
        url: () => url,
        async goto(value) {
            url = value;
            window.__persistenceFuzzBoot = {
                protocolVersion: protocol,
                documentToken: new URL(value).searchParams.get("document"),
                documentId: "doc",
                stage: importFailure ? "bridge-failed" : "bridge-ready",
                error: importFailure ? { message: "missing dependency" } : null
            };
            const state = {
                writes: 0,
                status: "ready",
                documentId: "doc",
                protocolVersion: protocol,
                probe: { stage: "configure", restoreWitness: restoreWitness() }
            };
            window.__persistenceFuzz = {
                configure() {
                    if (configureFailure) throw new Error("configure");
                },
                state: () => state
            };
            return { ok: () => status >= 200 && status < 300, status: () => status, headers: () => ({ "content-type": mime }) };
        },
        async evaluate(fn, arg) {
            return vm.runInNewContext(`(${fn}) (arg)`, { window, arg });
        },
        async waitForFunction(fn, arg, options) {
            polls.push(options.polling);
            if (missing) throw new Error("bridge missing");
            assert.ok(await this.evaluate(fn, arg));
            return { dispose: async () => {} };
        },
        async click() {
            const state = window.__persistenceFuzz.state();
            state.status = restoreResult ? "running" : "failed";
            state.probe = {
                stage: "restore",
                restoreWitness: {
                    ...restoreWitness(),
                    resourcesPrepared: true,
                    expectedBytesVerified: true,
                    entered: true,
                    completed: true,
                    returned: restoreResult
                }
            };
        }
    };
    return { page, polls };
}
for (const variant of [
    { status: 404 },
    { status: 500 },
    { mime: "application/json" },
    { protocol: 2 },
    { importFailure: true },
    { missing: true },
    { configureFailure: true }
]) {
    test(`loader classifies bootstrap failure ${JSON.stringify(variant)}`, async () => {
        const { page } = fixture(variant);
        await assert.rejects(
            loadDocument(page, {
                origin: "http://127.0.0.1:1234",
                operation: "cold-restore",
                trialId: "trial",
                options: { spec: { index: 0 } },
                diagnostics: new Diagnostics("http://127.0.0.1:1234")
            }),
            (error) => {
                assert.equal(eligibleFinding(error.record), false);
                assert.equal(error.record.restoreWitness.entered, false);
                return true;
            }
        );
    });
}
test("readiness polling has no requestAnimationFrame dependency", async () => {
    const { page, polls } = fixture();
    const result = await loadDocument(page, {
        origin: "http://127.0.0.1:1234",
        operation: "cold-restore",
        trialId: "trial",
        options: { spec: { index: 0 } },
        diagnostics: new Diagnostics("http://127.0.0.1:1234")
    });
    assert.deepEqual(polls, [50, 50]);
    assert.equal(result.restoreWitness.returned, true);
});
test("diagnostic quotas preserve first cause and late tail with omission counts", () => {
    const recorder = new Diagnostics("http://127.0.0.1:1234", 2000);
    for (let i = 0; i < 100; i++) recorder.add("pageerror", { i, message: "x".repeat(200) });
    const result = recorder.snapshot();
    assert.match(result.first.detail, /"i":0/);
    assert.match(result.tail.at(-1).detail, /"i":99/);
    assert.ok(result.omitted > 0);
});
