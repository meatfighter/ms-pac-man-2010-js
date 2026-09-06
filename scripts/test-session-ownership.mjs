import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function fixture() {
    const events = [];
    const locks = new Set();
    const channels = [];
    const node = () => ({
        children: [],
        listeners: {},
        append(...children) {
            this.children.push(...children);
        },
        replaceChildren(...children) {
            this.children = children;
        },
        setAttribute() {},
        addEventListener(name, callback) {
            this.listeners[name] = callback;
        }
    });
    const context = {
        exports: {},
        URL,
        console,
        Date,
        Promise,
        location: { href: "https://example.test/game/" },
        document: { createElement: node },
        window: { setTimeout, addEventListener() {} },
        navigator: {
            locks: {
                async request(name, _options, callback) {
                    if (locks.has(name)) return callback(null);
                    locks.add(name);
                    try {
                        await callback({ name });
                    } finally {
                        locks.delete(name);
                    }
                }
            }
        },
        BroadcastChannel: class {
            constructor(name) {
                this.name = name;
                channels.push(this);
            }

            addEventListener(_name, callback) {
                this.callback = callback;
            }

            postMessage(data) {
                for (const channel of channels) if (channel !== this && channel.name === this.name) channel.callback({ data });
            }
        }
    };
    const source = readFileSync("pwa/src/app/GameSessionOwnership.ts", "utf8");
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
    return { Ownership: context.exports.GameSessionOwnership, node, events, locks, context };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("second tab cannot write until the old tab saves and destroys its session", async () => {
    const { Ownership, node, events, locks } = fixture();
    const first = new Ownership(
        node(),
        () => events.push("first acquired"),
        () => events.push("first saved and destroyed")
    );
    const secondRoot = node();
    const second = new Ownership(
        secondRoot,
        () => events.push("second acquired"),
        () => events.push("second saved and destroyed")
    );
    first.start();
    await tick();
    second.start();
    await tick();
    assert.equal(first.owned, true);
    assert.equal(second.owned, false);
    assert.match(secondRoot.children[0].children[0].textContent, /another tab/);
    await second.acquire(true);
    assert.deepEqual(events, ["first acquired", "first saved and destroyed", "second acquired"]);
    assert.equal(first.owned, false);
    assert.equal(second.owned, true);
    first.release(); // A stale callback must not save again.
    assert.equal(events.length, 3);
    second.release();
    await tick();
    assert.equal(locks.size, 0);
});

test("an uncooperative owner cannot be bypassed, and deployments are isolated", async () => {
    const { Ownership, node, context } = fixture();
    const first = new Ownership(
        node(),
        () => {},
        () => {}
    );
    assert.equal(await first.tryAcquire(), true);
    const second = new Ownership(
        node(),
        () => {
            throw new Error("must not acquire");
        },
        () => {}
    );
    assert.equal(await second.tryAcquire(), false);
    context.location.href = "https://example.test/other-game/";
    const independent = new Ownership(
        node(),
        () => {},
        () => {}
    );
    assert.equal(await independent.tryAcquire(), true);
    independent.release();
    first.release();
});

test("failed cleanup retains ownership instead of allowing stale writes", async () => {
    const { Ownership, node } = fixture();
    const first = new Ownership(
        node(),
        () => {},
        () => {
            throw new Error("cleanup failed");
        }
    );
    await first.tryAcquire();
    assert.throws(() => first.release(), /cleanup failed/);
    assert.equal(first.owned, true);
    const second = new Ownership(
        node(),
        () => {},
        () => {}
    );
    assert.equal(await second.tryAcquire(), false);
});
