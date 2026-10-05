import { fork, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function killOwnedProcessTree(child, signal = "SIGTERM") {
    if (!child?.pid) return;
    if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
        try {
            process.kill(-child.pid, signal);
        } catch {
            try {
                child.kill(signal);
            } catch {
                /* Already exited. */
            }
        }
    }
}
/** Each trial has a new process/browser/server; poisoned trials cannot taint later trials. */
export function supervisedTrial(
    request,
    { timeoutMs = 180000, signal, progress = () => {}, onEvidence = () => {}, workerUrl = new URL("./worker.mjs", import.meta.url) } = {}
) {
    return new Promise((resolve) => {
        if (signal?.aborted) return resolve({ interrupted: true, issues: [], metrics: {}, coverage: [] });
        const child = fork(fileURLToPath(workerUrl), [], {
            cwd: request.repo,
            detached: process.platform !== "win32",
            serialization: "advanced",
            stdio: ["ignore", "pipe", "pipe", "ipc"],
            windowsHide: true,
            // Do not pass arbitrary test-runner flags or inspectors to the child.
            execArgv: []
        });
        const retained = new Map();
        let lastEvidence = {};
        let settled = false,
            tail = "",
            phase = "spawn",
            timer;
        const append = (bytes) => {
            tail = (tail + String(bytes)).slice(-24000);
        };
        child.stdout.on("data", append);
        child.stderr.on("data", append);
        const finish = (result, terminate = false) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
            if (terminate) {
                killOwnedProcessTree(child);
                const hard = setTimeout(() => killOwnedProcessTree(child, "SIGKILL"), 1500);
                child.once("exit", () => clearTimeout(hard));
                hard.unref();
            }
            const merged = new Map(retained);
            for (const [index, issue] of (result.issues ?? []).entries()) merged.set(issue.evidenceId ?? `terminal:${index}`, issue);
            resolve({
                ...lastEvidence,
                ...result,
                metrics: Object.keys(result.metrics ?? {}).length ? result.metrics : (lastEvidence.metrics ?? {}),
                issues: [...merged.values()],
                ...(signal?.aborted ? { interrupted: true } : {}),
                workerTail: tail,
                lastPhase: phase
            });
        };
        const abort = () => {
            clearTimeout(timer);
            // Let browser/server cleanup settle before the bounded hard fallback.
            if (child.connected) child.send({ type: "stop" }, () => {});
            timer = setTimeout(() => finish({ interrupted: true, issues: [], metrics: {}, coverage: [] }, true), 2000);
        };
        signal?.addEventListener("abort", abort, { once: true });
        child.on("error", (error) => finish({ infrastructureFailure: { message: error.message }, issues: [], metrics: {}, coverage: [] }, true));
        child.on("message", (message) => {
            if (settled) return;
            if (message.type === "evidence") {
                try {
                    onEvidence(message.packet);
                    for (const issue of message.packet.issues ?? []) retained.set(issue.evidenceId, issue);
                    lastEvidence = { ...lastEvidence, ...message.packet, issues: undefined };
                    if (child.connected) child.send({ type: "evidence-ack", sequence: message.sequence }, () => {});
                } catch (error) {
                    finish(
                        { incomplete: true, infrastructureFailure: { name: error.name, message: error.message }, issues: [], metrics: {}, coverage: [] },
                        true
                    );
                }
                return;
            }
            if (message.type === "progress") {
                phase = message.phase;
                progress(message);
            }
            if (message.type === "result") finish(message.result);
        });
        child.on("exit", (code, exitSignal) => {
            if (!settled)
                finish({
                    issues: [{ category: "WORKER_CRASH", phase, error: { name: "WorkerExit", message: `code=${code}; signal=${exitSignal}` } }],
                    metrics: {},
                    coverage: [],
                    incomplete: true
                });
        });
        timer = setTimeout(
            () =>
                finish(
                    {
                        issues: [{ category: "WORKER_TIMEOUT", phase, error: { name: "TrialTimeout", message: `Trial exceeded ${timeoutMs}ms` } }],
                        metrics: {},
                        coverage: [],
                        incomplete: true
                    },
                    true
                ),
            timeoutMs
        );
        child.send(request);
    });
}
