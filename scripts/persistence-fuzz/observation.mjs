// Test-only production-call instrumentation; never executes a producer itself.
export function createObservation() {
    const hooks = new WeakMap(),
        tracked = new WeakMap();
    let enabled = false;
    const actors = new Set();
    const metrics = { gameplayUpdates: 0, autonomousUpdates: 0, inputActionsObserved: 0 };
    const markers = new Set();
    const hook = (object, name, role) => {
        if (!object || typeof object[name] !== "function" || tracked.get(object)?.has(name)) return;
        let owner = object;
        while (owner && !Object.hasOwn(owner, name)) owner = Object.getPrototypeOf(owner);
        let names = hooks.get(owner);
        if (!names) hooks.set(owner, (names = new Set()));
        let roles = tracked.get(object);
        if (!roles) tracked.set(object, (roles = new Map()));
        roles.set(name, role);
        if (names.has(name)) return;
        names.add(name);
        const original = owner[name];
        owner[name] = function (...args) {
            const activeRole = tracked.get(this)?.get(name);
            const value = original.apply(this, args);
            if (enabled && activeRole) {
                if (activeRole === "input" && value === true) metrics.inputActionsObserved++;
                else if (activeRole === "player" || activeRole === "actor") {
                    metrics[activeRole === "player" ? "gameplayUpdates" : "autonomousUpdates"]++;
                    markers.add(`updated:entity:${this.constructor.name}`);
                }
            }
            return value;
        };
    };
    return {
        metrics,
        markers,
        actors,
        hook,
        begin() {
            enabled = true;
        },
        end() {
            enabled = false;
        },
        actor(object, player = false) {
            if (!object) return;
            actors.add(object);
            markers.add(`active:entity:${object.constructor.name}`);
            hook(object, "update", player ? "player" : "actor");
        },
        input(object) {
            for (const name of ["isUp", "isDown", "isLeft", "isRight", "isFire", "isShoot", "isJump", "isAttack"]) hook(object, name, "input");
        }
    };
}
