import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ownWorker } from "./process-owner.mjs";
import { errorDetails, protocolVersion } from "./failure-protocol.mjs";

function bounded(promise, ms, message) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(message)), ms);
        })
    ]).finally(() => clearTimeout(timer));
}
/** Result receipt is provisional until durable evidence, actual exit and cleanup join. */
export function supervisedTrial(
    request,
    {
        timeoutMs = 180000,
        exitGraceMs = 2000,
        signal,
        progress = () => {},
        onEvidence = () => {
            throw new Error("Durable evidence consumer required");
        },
        workerUrl = new URL("./worker.mjs", import.meta.url)
    } = {}
) {
    return new Promise((resolve) => {
        if (signal?.aborted) return resolve({ protocolVersion, interrupted: true, incomplete: true, issues: [], metrics: {}, coverage: [] });
        const child = fork(fileURLToPath(workerUrl), [], {
            cwd: request.repo,
            detached: process.platform !== "win32",
            serialization: "advanced",
            stdio: ["ignore", "pipe", "pipe", "ipc"],
            windowsHide: true,
            execArgv: []
        });
        const retained = new Map();
        let owner,
            pending,
            failure,
            lastEvidence = {},
            tail = "",
            phase = "spawn",
            exited = false,
            closed = false,
            exitCode,
            exitSignal;
        let stopRequested = false,
            completing = false,
            evidence = Promise.resolve(),
            timer,
            grace;
        const append = (bytes) => {
            tail = (tail + bytes).slice(-24000);
        };
        child.stdout.on("data", append);
        child.stderr.on("data", append);
        child.once("close", () => {
            closed = true;
        });
        const fail = (error) => {
            failure ??= errorDetails(error);
        };
        const complete = async () => {
            if (completing) return;
            completing = true;
            clearTimeout(timer);
            clearTimeout(grace);
            signal?.removeEventListener("abort", abort);
            try {
                await bounded(evidence, 5000, "Evidence persistence did not settle");
            } catch (error) {
                fail(error);
            }
            try {
                await owner?.close();
            } catch (error) {
                fail(error);
            }
            if (!owner) {
                fail(new Error("Worker process ownership was not established"));
                child.kill("SIGKILL");
            }
            if (!exited)
                await new Promise((done) => {
                    const deadline = setTimeout(() => {
                        fail(new Error("Worker did not exit after owned cleanup"));
                        done();
                    }, 5000);
                    child.once("exit", () => {
                        clearTimeout(deadline);
                        done();
                    });
                });
            if (!closed) {
                try {
                    await bounded(new Promise((done) => child.once("close", done)), 5000, "Worker output streams did not close");
                } catch (error) {
                    fail(error);
                }
            }
            if (pending?.cleanup?.complete === false || pending?.evidenceComplete === false) fail(new Error("Worker reported incomplete evidence or cleanup"));
            if (exited) {
                try {
                    owner?.cleanupCache();
                } catch (error) {
                    fail(error);
                }
            }
            if (!pending) fail(new Error("Worker exited without a result"));
            if (exitCode !== 0 && !(signal?.aborted && exitCode === 130)) fail(new Error(`Worker exit ${exitCode}, signal ${exitSignal}`));
            if (failure)
                retained.set("supervisor", {
                    protocolVersion,
                    domain: "harness",
                    category: failure.message.startsWith("Trial exceeded") ? "WORKER_TIMEOUT" : "WORKER_LIFETIME_FAILED",
                    stage: "cleanup",
                    error: failure,
                    evidenceId: "supervisor"
                });
            for (const [index, issue] of (pending?.issues ?? []).entries())
                retained.set(issue.evidenceId ?? `terminal:${index}`, { ...retained.get(issue.evidenceId), ...issue });
            resolve({
                ...lastEvidence,
                ...pending,
                protocolVersion,
                issues: [...retained.values()],
                metrics: pending?.metrics ?? lastEvidence.metrics ?? {},
                coverage: pending?.coverage ?? lastEvidence.coverage ?? [],
                workerTail: tail,
                lastPhase: phase,
                workerExit: { code: exitCode, signal: exitSignal },
                ...(failure ? { incomplete: true, infrastructureFailure: failure, acceptedCheckpoint: undefined } : {}),
                ...(signal?.aborted ? { interrupted: true, incomplete: true, acceptedCheckpoint: undefined } : {})
            });
        };
        const stop = (error) => {
            fail(error);
            if (stopRequested || completing) return;
            stopRequested = true;
            if (child.connected)
                child.send({ type: "stop" }, (sendError) => {
                    if (sendError) fail(sendError);
                });
            clearTimeout(grace);
            grace = setTimeout(complete, exitGraceMs);
        };
        const abort = () => stop(new Error("User interruption"));
        signal?.addEventListener("abort", abort, { once: true });
        child.once("error", (error) => {
            fail(error);
            void complete();
        });
        child.on("message", (message) => {
            if (completing) return;
            if (message.type === "evidence") {
                evidence = evidence.then(async () => {
                    if (message.packet.ownedCachePath) owner.registerCache(message.packet.ownedCachePath);
                    if (message.packet.ownedBrowserPid) owner.register(message.packet.ownedBrowserPid);
                    await onEvidence(message.packet);
                    for (const issue of message.packet.issues ?? []) retained.set(issue.evidenceId, { ...retained.get(issue.evidenceId), ...issue });
                    lastEvidence = { ...lastEvidence, ...message.packet, issues: undefined };
                    if (!child.connected) throw new Error("Worker disconnected before durable ACK");
                    await new Promise((done, reject) =>
                        child.send({ type: "evidence-ack", sequence: message.sequence }, (error) => (error ? reject(error) : done()))
                    );
                });
                evidence.catch((error) => stop(error));
            } else if (message.type === "progress") {
                phase = message.phase;
                progress(message);
            } else if (message.type === "result") {
                if (pending) {
                    stop(new Error("Duplicate terminal result"));
                    return;
                }
                pending = message.result;
                grace ??= setTimeout(() => {
                    fail(new Error("Worker result received but process did not exit"));
                    void complete();
                }, exitGraceMs);
            }
        });
        child.once("exit", (code, sig) => {
            exited = true;
            exitCode = code;
            exitSignal = sig;
            void complete();
        });
        timer = setTimeout(() => stop(new Error(`Trial exceeded ${timeoutMs}ms`)), timeoutMs);
        void ownWorker(child)
            .then((value) => {
                owner = value;
                if (completing || signal?.aborted) return owner.close();
                child.send(request, (error) => {
                    if (error) stop(error);
                });
            })
            .catch((error) => {
                fail(error);
                void complete();
            });
    });
}
