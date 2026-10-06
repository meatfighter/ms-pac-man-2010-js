import { eligibleFinding } from "./failure-protocol.mjs";
import { issueSignature } from "./compare.mjs";

/** Bounded input/schedule reduction. Never changes geometry, counters or the seed recipe. */
export async function minimizeTrial(original, targetSignature, execute, { maxAttempts = 32, signal, onProgress = () => {} } = {}) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10000) throw new Error("Invalid minimization budget");
    const clone = (value) => JSON.parse(JSON.stringify(value));
    let best = clone(original),
        attempts = 0,
        verified = false;
    const progress = () => ({
        attempts,
        originalCallbacks: original.frames.length,
        callbacks: best.frames.length,
        verified,
        interrupted: Boolean(signal?.aborted),
        targetSignature,
        spec: clone(best)
    });
    const reproduces = async (candidate) => {
        if (attempts >= maxAttempts || signal?.aborted) return false;
        attempts++;
        let result;
        try {
            result = await execute(candidate);
        } catch {
            return false;
        }
        return (
            !result.infrastructureFailure &&
            !result.interrupted &&
            !result.incomplete &&
            result.setupComplete === true &&
            (result.issues ?? []).some((issue) => eligibleFinding(issue) && issueSignature(issue) === targetSignature)
        );
    };
    // Re-verify the original on this revision before trying to reduce anything.
    verified = await reproduces(best);
    onProgress(progress());
    if (!verified) return { ...progress(), status: signal?.aborted ? "interrupted" : "original-not-reproduced" };
    for (let chunk = Math.max(1, Math.floor(best.frames.length / 2)); chunk >= 1 && attempts < maxAttempts && !signal?.aborted; chunk = Math.floor(chunk / 2)) {
        let offset = 0;
        while (offset < best.frames.length && best.frames.length > 1 && attempts < maxAttempts && !signal?.aborted) {
            const candidate = clone(best);
            candidate.frames.splice(offset, Math.min(chunk, candidate.frames.length - 1));
            if (await reproduces(candidate)) {
                best = candidate;
                onProgress(progress());
            } else offset += chunk;
        }
    }
    // Remove unnecessary control events while preserving update/render timing.
    for (let index = 0; index < best.frames.length && attempts < maxAttempts && !signal?.aborted; index++) {
        if (best.frames[index].mask === 0) continue;
        const candidate = clone(best);
        candidate.frames[index].mask = 0;
        if (await reproduces(candidate)) {
            best = candidate;
            onProgress(progress());
        }
    }
    return { ...progress(), status: signal?.aborted ? "interrupted" : attempts >= maxAttempts ? "budget-reached" : "reduced" };
}
