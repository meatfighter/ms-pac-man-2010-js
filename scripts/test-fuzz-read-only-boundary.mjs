import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
test("actual incoming-boundary observation never writes an invalid snapshot or rejected-save record", () => {
    const source = readFileSync("scripts/persistence-fuzz/browser.mjs", "utf8");
    const method = source.slice(source.indexOf("function observe("), source.indexOf("function step("));
    let writes = 0;
    const issues = [];
    const context = vm.createContext({
        mounted: { main: { isStateSaveReady: () => true } },
        capture: () => ({ x: 1 }),
        adapter: { validate: () => "invalid", transitionProjection: () => ({}), diagnose: () => ({}) },
        normalize: (value) => value,
        snapshotCoverage: () => [],
        save: () => {
            writes++;
        },
        issue: (...args) => issues.push(args),
        validations: 0,
        previousGood: null,
        previousGameplay: null,
        progress: 0,
        previousTransition: null,
        coverage: new Set(),
        signatures: new Set(),
        callbackCount: 0,
        spec: { writeEvery: 1 }
    });
    vm.runInContext(method + "; observe(false,false);", context);
    assert.equal(writes, 0);
    assert.equal(issues.length, 1);
    vm.runInContext("observe(false,true);", context);
    assert.equal(writes, 1);
});
