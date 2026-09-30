import assert from "node:assert/strict";
/** Only installed by the departure test server, never by a release Vite config. */
export function departureShellPlugin(game) {
    const jackal = game === "jackal";
    const shell = jackal ? "/src/app/JackalWebApp.ts" : game === "stickvania" ? "/src/main.ts" : "/src/app/main.ts";
    return {
        name: "departure-test-shell",
        enforce: "pre",
        transform(source, id) {
            id = id.replaceAll("\\", "/").split("?")[0];
            if (id.endsWith(shell)) {
                source = 'import { SoundStore as DepartureSoundStore } from "slick2d-ts";\n' + source;
                const boundaries = [
                    ["freeze", "appContainer?.setLoopSuspended(true)"],
                    ["game", "mainGame?.setBrowserSuspended(true)"],
                    ["input", "appContainer?.getInput().pause()"],
                    ["rumble", "manager?.setSuspended(true)"],
                    ["audio", "releaseGameAudio()"],
                    ["wake", `${jackal ? "this." : ""}syncScreenWakeLock()`]
                ];
                for (const [label, call] of boundaries) {
                    if (label === "rumble" && game !== "stickvania") continue;
                    const before = `() => ${call}`;
                    assert(source.includes(before), "Actual shell cleanup boundary: " + label);
                    source = source.replaceAll(before, `() => window.departureBoundary("${label}", () => ${call})`);
                }
                if (!jackal) {
                    assert(source.includes("ownership.start();"));
                    source = source.replace("ownership.start();", access("") + "\nownership.start();");
                }
            }
            if (jackal && id.endsWith("/src/main.ts")) {
                assert(source.includes("ownership.start();"));
                source = 'import { SoundStore as DepartureSoundStore } from "slick2d-ts";\n' + source;
                source = source.replace("ownership.start();", access("app.") + "\nownership.start();");
            }
            return source;
        }
    };
    function access(prefix) {
        return `window.departureTestAccess = {
            get game() { return ${prefix}game; },
            capture: () => ${prefix}gameStateStore.serializer.createSnapshot(${prefix}game, "departure-observer"), get container() { return ${prefix}container; },
            get cleanup() { return ${prefix}sessionCleanup; }, get soundStore() { return DepartureSoundStore.get(); }, get persistence() { return ${prefix}persistence; },
            get owner() { return ownership; },
            suspend: (reason = "test") => ${prefix}suspendGameForMenu(reason),
            menu: () => ${prefix}requestPwaMenu("test"),
            replaceGame: (value) => ${prefix}game = value,
            restoreGame: (value) => ${prefix}game = value
        };`;
    }
}
