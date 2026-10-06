/* global window */
// __PERSISTENCE_FUZZ_ONLY__: deliberately independent of the game import graph.
const boot = window.__persistenceFuzzBoot;
boot.stage = "bridge-import";
void import("./browser.mjs")
    .then(() => {
        const api = window.__persistenceFuzz;
        if (!api || api.protocolVersion !== 3 || ["configure", "state", "prepareDrain", "ackDrain"].some((key) => typeof api[key] !== "function"))
            throw new Error("Incomplete persistence fuzz bridge");
        boot.stage = "bridge-ready";
    })
    .catch((error) => {
        boot.stage = "bridge-failed";
        boot.error = { name: error?.name ?? "Error", message: String(error?.message ?? error), stack: String(error?.stack ?? "").slice(0, 12000) };
    });
