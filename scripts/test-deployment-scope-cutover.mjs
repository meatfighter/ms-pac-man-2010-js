import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const packageName = JSON.parse(readFileSync("package.json", "utf8")).name;
const productionHref = "https://example.test/game/";
const stageHref = "https://example.test/game-stage/index.html";

function loadTs(path, globals = {}) {
    const context = {
        exports: {},
        console,
        URL,
        Promise,
        setTimeout,
        clearTimeout,
        performance,
        ...globals
    };
    const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    });
    vm.runInNewContext(compiled.outputText, context);
    return context.exports;
}

function storageContract() {
    switch (packageName) {
        case "ms-pac-man-2010-js": {
            const storage = loadTs("pwa/src/app/BrowserStorageKeys.ts");
            return {
                scopeId: (href) => storage.createDeploymentStorageId(href),
                key: (href) => storage.createBrowserStorageKeys(href).volume
            };
        }
        case "jackal-js": {
            const storage = loadTs("pwa/src/app/DeploymentStorageKeys.ts");
            return {
                scopeId: (href) => storage.getDeploymentPathId(href),
                key: (href) => storage.getDeploymentStorageKey("probe", href)
            };
        }
        case "stickvania-js": {
            const storage = loadTs("pwa/src/stickvania/BrowserStorageKeys.ts");
            return {
                scopeId: (href) => storage.getBrowserStorageScopeId(href),
                key: (href) => storage.getBrowserStorageKey("probe", href)
            };
        }
        default:
            throw new Error(`Unsupported game package ${packageName}`);
    }
}

function ownershipName(href) {
    const { GameSessionOwnership } = loadTs("pwa/src/app/GameSessionOwnership.ts", { location: { href } });
    return new GameSessionOwnership({}, () => {}, () => {}).name;
}

test("storage and writer-lock scope use the same deployment directory", () => {
    const contract = storageContract();
    for (const href of [productionHref, stageHref]) {
        const expectedPath = new URL(".", href).pathname;
        const scopeId = contract.scopeId(href);
        assert.equal(decodeURIComponent(scopeId), expectedPath);
        assert.equal(ownershipName(href), `game-session:${expectedPath}`);
        assert.match(contract.key(href), new RegExp(escapeRegExp(scopeId)));
    }
});

test("production and stage deployments do not share save/settings or writer locks", () => {
    const contract = storageContract();
    assert.notEqual(contract.scopeId(productionHref), contract.scopeId(stageHref));
    assert.notEqual(contract.key(productionHref), contract.key(stageHref));
    assert.notEqual(ownershipName(productionHref), ownershipName(stageHref));
});

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
