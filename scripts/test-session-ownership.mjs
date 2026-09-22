import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Execute the complete production module, not a copied state machine or selected methods.
const source = readFileSync(new URL("../pwa/src/app/GameSessionOwnership.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

async function flush() {
    for (let i = 0; i < 16; i++) {
        await Promise.resolve();
    }
}

class Events {
    listeners = new Map();
    addEventListener(name, callback) {
        let listeners = this.listeners.get(name);
        if (!listeners) {
            listeners = new Set();
            this.listeners.set(name, listeners);
        }
        listeners.add(callback);
    }
    removeEventListener(name, callback) {
        this.listeners.get(name)?.delete(callback);
    }
    emit(name, data = {}) {
        for (const callback of [...(this.listeners.get(name) ?? [])]) {
            callback({ type: name, target: this, currentTarget: this, ...data });
        }
    }
}

class Element extends Events {
    parent = null;
    rootConnected = false;
    get isConnected() {
        return this.rootConnected || (this.parent?.isConnected ?? false);
    }
    focus() {}
    querySelector() {
        return descendants(this).find((node) => node.tag === "button") ?? null;
    }
    children = [];
    textContent = "";
    constructor(tag = "div") {
        super();
        this.tag = tag;
    }
    append(...children) {
        for (const child of children) child.parent = this;
        this.children.push(...children);
    }
    replaceChildren(...children) {
        for (const child of this.children) child.parent = null;
        for (const child of children) child.parent = this;
        this.children = children;
    }
    setAttribute() {}
    click() {
        if (!this.disabled) {
            this.emit("click");
        }
    }
}

function descendants(node) {
    return [node, ...node.children.flatMap(descendants)];
}

function world() {
    const locks = new Map();
    const channels = [];
    const timers = new Map();
    const requests = [];
    const pending = [];
    let timerSerial = 0;
    let now = 0;
    const setTimer = (callback, delay = 0) => {
        const id = ++timerSerial;
        timers.set(id, { callback, at: now + delay });
        return id;
    };
    const api = {
        locks,
        channels,
        timers,
        requests,
        pending,
        async advance(milliseconds = 100) {
            now += milliseconds;
            for (const [id, timer] of [...timers]) {
                if (timer.at <= now) {
                    timers.delete(id);
                    timer.callback();
                }
            }
            await flush();
        },
        tab({ href = "https://example.test/game/", acquired = () => {}, relinquish = () => {} } = {}) {
            const root = new Element();
            root.rootConnected = true;
            const window = new Events();
            let reloadCalls = 0;
            window.location = { reload: () => reloadCalls++ };
            const document = new Events();
            document.visibilityState = "visible";
            document.hasFocus = () => true;
            document.createElement = (name) => new Element(name);
            const env = { manualRequests: false, failOpen: false, failClose: false, failRemove: false, post: null };
            const log = [];
            const context = {
                exports: {},
                URL,
                Promise,
                location: { href },
                performance: { now: () => now },
                setTimeout: setTimer,
                clearTimeout: (id) => timers.delete(id),
                window,
                document,
                console: { warn: (...args) => log.push(args), error: (...args) => log.push(args) },
                navigator: {
                    locks: {
                        request(name, options, callback) {
                            requests.push({ name, options });
                            return new Promise((resolve, reject) => {
                                const grant = () => {
                                    const lease = {};
                                    const available = !locks.has(name);
                                    if (available) {
                                        locks.set(name, lease);
                                    }
                                    Promise.resolve()
                                        .then(() => callback(available ? { name } : null))
                                        .then(
                                            (value) => {
                                                if (locks.get(name) === lease) {
                                                    locks.delete(name);
                                                }
                                                resolve(value);
                                            },
                                            (error) => {
                                                if (locks.get(name) === lease) {
                                                    locks.delete(name);
                                                }
                                                reject(error);
                                            }
                                        );
                                };
                                if (env.manualRequests) {
                                    pending.push(grant);
                                } else {
                                    grant();
                                }
                            });
                        }
                    }
                },
                BroadcastChannel: class extends Events {
                    closed = false;
                    closeCalls = 0;
                    constructor(name) {
                        super();
                        if (env.failOpen) {
                            throw new Error("channel unavailable");
                        }
                        this.name = name;
                        channels.push(this);
                    }
                    removeEventListener(name, callback) {
                        if (env.failRemove) {
                            throw new Error("listener removal failed");
                        }
                        super.removeEventListener(name, callback);
                    }
                    postMessage(data) {
                        env.post?.();
                        for (const channel of channels) {
                            if (channel !== this && !channel.closed && channel.name === this.name) {
                                channel.emit("message", { data });
                            }
                        }
                    }
                    close() {
                        this.closeCalls++;
                        if (env.failClose) {
                            throw new Error("channel close failed");
                        }
                        this.closed = true;
                    }
                }
            };
            vm.runInNewContext(compiled, context);
            const owner = new context.exports.GameSessionOwnership(root, acquired, relinquish);
            return {
                owner,
                root,
                window,
                document,
                env,
                log,
                reloadCalls: () => reloadCalls,
                button: () => descendants(root).find((node) => node.tag === "button"),
                text: () =>
                    descendants(root)
                        .map((node) => node.textContent)
                        .join(" ")
            };
        }
    };
    return api;
}

test("second tab acquires only after the old tab saves and destroys", async () => {
    const w = world();
    const events = [];
    const first = w.tab({ acquired: () => events.push("first acquired"), relinquish: () => events.push("first saved and destroyed") });
    const second = w.tab({ acquired: () => events.push("second acquired") });
    first.owner.start();
    await flush();
    second.owner.start();
    await flush();
    assert.equal(first.owner.owned, true);
    assert.equal(second.owner.owned, false);
    assert.match(second.text(), /another tab/);
    assert.equal(second.root.children[0].className, "session-ownership-screen");
    assert.equal(second.button().textContent, "Continue Here");
    second.button().click();
    await flush();
    await w.advance();
    assert.deepEqual(events, ["first acquired", "first saved and destroyed", "second acquired"]);
    assert.equal(first.owner.owned, false);
    assert.equal(second.owner.owned, true);
    assert.ok(w.requests.every(({ options }) => options.ifAvailable === true && !Object.hasOwn(options, "steal")));
    first.owner.dispose();
    second.owner.dispose();
    await flush();
    assert.equal(w.locks.size, 0);
});

test("deployment paths use independent locks", async () => {
    const w = world();
    const first = w.tab();
    const second = w.tab({ href: "https://example.test/game-stage/" });
    first.owner.start();
    second.owner.start();
    await flush();
    assert.equal(first.owner.owned, true);
    assert.equal(second.owner.owned, true);
    assert.equal(w.locks.size, 2);
    first.owner.dispose();
    second.owner.dispose();
});

test("failed cleanup revokes write capability while retaining the native lock", async () => {
    const w = world();
    let cleanup = 0;
    const first = w.tab({
        relinquish: () => {
            cleanup++;
            throw new Error("cleanup failed");
        }
    });
    first.owner.start();
    await flush();
    const epoch = first.owner.epoch;
    first.window.emit("pagehide");
    first.document.emit("freeze");
    first.window.emit("pageshow");
    await flush();
    assert.equal(cleanup, 1);
    assert.equal(first.owner.owned, false);
    assert.equal(first.owner.isCurrent(epoch), false);
    assert.equal(w.locks.size, 1);
    assert.match(first.text(), /Reload this tab/);
    assert.equal(first.button()?.textContent, "Reload");
    first.button().click();
    assert.equal(first.reloadCalls(), 1);
    const second = w.tab();
    second.owner.start();
    await flush();
    assert.equal(second.owner.owned, false);
    assert.match(second.text(), /another tab/);
});

test("reentrant takeover cannot execute relinquishment twice", async () => {
    const w = world();
    let cleanup = 0;
    const tab = w.tab({
        relinquish: () => {
            cleanup++;
            if (cleanup < 3) {
                w.channels[0].emit("message", { data: "takeover" });
            }
        }
    });
    tab.owner.start();
    await flush();
    w.channels[0].emit("message", { data: "takeover" });
    await flush();
    assert.equal(cleanup, 1);
    assert.equal(tab.owner.owned, false);
    assert.equal(w.locks.size, 0);
});

test("final save is authorized but old startup capabilities are invalid during relinquishment", async () => {
    const w = world();
    let epoch;
    let state;
    const tab = w.tab({
        relinquish: () => {
            state = [tab.owner.owned, tab.owner.isCurrent(epoch)];
        }
    });
    tab.owner.start();
    await flush();
    epoch = tab.owner.epoch;
    tab.window.emit("pagehide");
    await flush();
    assert.deepEqual(state, [true, false]);
    assert.equal(tab.owner.owned, false);
    assert.equal(w.locks.size, 0);
});

test("sleep signals are idempotent and wake only reacquires ownership", async () => {
    const w = world();
    let acquired = 0;
    let released = 0;
    const tab = w.tab({ acquired: () => acquired++, relinquish: () => released++ });
    tab.owner.start();
    await flush();
    const epoch = tab.owner.epoch;
    tab.window.emit("pagehide");
    tab.document.emit("freeze");
    await flush();
    assert.equal(released, 1);
    assert.equal(w.locks.size, 0);
    tab.window.emit("pageshow");
    tab.document.emit("resume");
    await flush();
    assert.equal(acquired, 2);
    assert.equal(tab.owner.owned, true);
    assert.equal(tab.owner.isCurrent(epoch), false);
    tab.owner.dispose();
});

test("late lock callback from before sleep cannot acquire after a newer wake attempt", async () => {
    const w = world();
    let acquired = 0;
    const tab = w.tab({ acquired: () => acquired++ });
    tab.env.manualRequests = true;
    tab.owner.start();
    tab.window.emit("pagehide");
    tab.window.emit("pageshow");
    await flush();
    assert.equal(w.pending.length, 1);
    w.pending.shift()();
    await flush();
    assert.equal(acquired, 0);
    assert.equal(w.locks.size, 0);
    w.pending.shift()();
    await flush();
    assert.equal(acquired, 1);
    assert.equal(tab.owner.owned, true);
    tab.owner.dispose();
});

test("disposal invalidates pending acquisition and removes listeners", async () => {
    const w = world();
    let acquired = 0;
    const tab = w.tab({ acquired: () => acquired++ });
    tab.env.manualRequests = true;
    tab.owner.start();
    tab.owner.start();
    await flush();
    assert.equal(w.pending.length, 1);
    tab.owner.dispose();
    tab.owner.dispose();
    w.pending.shift()();
    await flush();
    assert.equal(acquired, 0);
    assert.equal(w.locks.size, 0);
    assert.equal(w.channels[0].closeCalls, 1);
    assert.ok([...tab.window.listeners.values(), ...tab.document.listeners.values()].every((listeners) => listeners.size === 0));
});

test("channel-construction failure renders a usable retry instead of escaping", async () => {
    const w = world();
    const tab = w.tab();
    tab.env.failOpen = true;
    assert.doesNotThrow(() => tab.owner.start());
    await flush();
    assert.equal(tab.owner.owned, false);
    assert.match(tab.text(), /Unable to open saved progress/);
    tab.env.failOpen = false;
    tab.button().click();
    await flush();
    assert.equal(tab.owner.owned, true);
    tab.owner.dispose();
});

test("retired channel callbacks cannot act on a reacquired session even if cleanup throws", async () => {
    const w = world();
    let released = 0;
    const tab = w.tab({ relinquish: () => released++ });
    tab.owner.start();
    await flush();
    const oldChannel = w.channels[0];
    tab.env.failClose = true;
    tab.env.failRemove = true;
    assert.doesNotThrow(() => tab.window.emit("pagehide"));
    await flush();
    tab.env.failClose = false;
    tab.env.failRemove = false;
    tab.window.emit("pageshow");
    await flush();
    assert.equal(tab.owner.owned, true);
    oldChannel.emit("message", { data: "takeover" });
    assert.equal(released, 1);
    assert.equal(tab.owner.owned, true);
    tab.owner.dispose();
});

test("sleep cancels an outstanding takeover retry timer", async () => {
    const w = world();
    const name = "game-session:/game/";
    w.locks.set(name, "uncooperative owner");
    const tab = w.tab();
    tab.owner.start();
    await flush();
    tab.button().click();
    await flush();
    assert.equal(w.timers.size, 1);
    tab.window.emit("pagehide");
    assert.equal(w.timers.size, 0);
    const requests = w.requests.length;
    await w.advance(6000);
    assert.equal(w.requests.length, requests);
    assert.equal(tab.owner.owned, false);
});

test("takeover timeout never force-steals an uncooperative owner's lock", async () => {
    const w = world();
    const lease = {};
    w.locks.set("game-session:/game/", lease);
    const tab = w.tab();
    tab.owner.start();
    await flush();
    tab.button().click();
    await flush();
    await w.advance(5000);
    assert.equal(tab.owner.owned, false);
    assert.equal(w.locks.get("game-session:/game/"), lease);
    assert.match(tab.text(), /has not released/);
    assert.equal(w.timers.size, 0);
    tab.owner.dispose();
});

test("acquired-callback and teardown failure keep the native lock without leaving a writable tab", async () => {
    const w = world();
    const tab = w.tab({
        acquired: () => {
            throw new Error("startup failed");
        },
        relinquish: () => {
            throw new Error("cleanup failed");
        }
    });
    tab.owner.start();
    await flush();
    assert.equal(w.locks.size, 1);
    assert.equal(tab.owner.owned, false);
    assert.equal(tab.owner.isCurrent(tab.owner.epoch), false);
    assert.match(tab.text(), /Reload this tab/);
    assert.equal(tab.button()?.textContent, "Reload");
    tab.button().click();
    assert.equal(tab.reloadCalls(), 1);
});

test("disposal requested from inside relinquishment is completed once cleanup returns", async () => {
    const w = world();
    let released = 0;
    const tab = w.tab({
        relinquish: () => {
            released++;
            tab.owner.dispose();
        }
    });
    tab.owner.start();
    await flush();
    w.channels[0].emit("message", { data: "takeover" });
    await flush();
    assert.equal(released, 1);
    assert.equal(w.locks.size, 0);
    assert.ok([...tab.window.listeners.values(), ...tab.document.listeners.values()].every((listeners) => listeners.size === 0));
    tab.owner.start();
    await flush();
    assert.equal(tab.owner.owned, false);
});

test("native acquisition timeout latches reload and a late grant never publishes ownership", async () => {
    const w = world();
    let acquired = 0;
    const tab = w.tab({ acquired: () => acquired++ });
    tab.env.manualRequests = true;
    tab.owner.start();
    await flush();
    await w.advance(5000);
    assert.match(tab.text(), /Reload/);
    tab.window.emit("pageshow");
    await flush();
    assert.equal(w.requests.length, 1);
    w.pending.shift()();
    await flush();
    assert.equal(acquired, 0);
    assert.equal(w.locks.size, 0);
    assert.equal(tab.owner.owned, false);
    tab.owner.dispose();
});

test("detached ownership control cannot start a takeover", async () => {
    const w = world();
    w.locks.set("game-session:/game/", {});
    const tab = w.tab();
    tab.owner.start();
    await flush();
    const old = tab.button();
    tab.root.replaceChildren(new Element());
    old.click();
    await flush();
    assert.equal(w.requests.length, 1);
    tab.owner.dispose();
});

test("ownership timeout while sleeping displays Reload on wake", async () => {
    const w = world();
    const tab = w.tab();
    tab.env.manualRequests = true;
    tab.owner.start();
    await flush();
    tab.window.emit("pagehide");
    await w.advance(5000);
    tab.window.emit("pageshow");
    await flush();
    assert.match(tab.text(), /Reload/);
    assert.equal(w.requests.length, 1);
    tab.owner.dispose();
});
