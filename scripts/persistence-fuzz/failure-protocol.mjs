export const protocolVersion = 3;
export function restoreWitness() {
    return { resourcesPrepared: false, expectedBytesVerified: false, entered: false, completed: false, returned: null, threw: null };
}
export function errorDetails(error, depth = 0) {
    return {
        name: error?.name ?? "Error",
        message: String(error?.message ?? error),
        stack: String(error?.stack ?? "").slice(0, 12000),
        ...(error?.cause && error.cause !== error && depth < 2 ? { cause: errorDetails(error.cause, depth + 1) } : {}),
        ...(error?.record ? { record: error.record } : {})
    };
}
export function invokeObservedRestore(store, main, gc, witness) {
    Object.assign(witness, { entered: true, completed: false, returned: null, threw: null });
    try {
        const accepted = store.restore(main, gc);
        witness.returned = accepted;
        witness.completed = true;
        return accepted;
    } catch (error) {
        witness.threw = errorDetails(error);
        witness.completed = true;
        throw error;
    }
}
export function classifyFailure(error, context = {}) {
    const witness = context.restoreWitness ?? restoreWitness();
    let domain = "bootstrap",
        category = "FIXTURE_BOOTSTRAP_FAILED";
    const stage = context.stage ?? "navigation";
    if (stage === "evidence-drain") {
        domain = "evidence";
        category = "EVIDENCE_DRAIN_FAILED";
    } else if (stage === "cleanup") {
        domain = "harness";
        category = "CLEANUP_FAILED";
    } else if (witness.entered && !witness.completed) {
        domain = "unresolved";
        category = "RESTORE_DID_NOT_COMPLETE";
    } else if (witness.entered && witness.resourcesPrepared && witness.expectedBytesVerified && witness.threw) {
        domain = "persistence";
        category = "RESTORE_THROW";
    } else if (witness.entered && witness.resourcesPrepared && witness.expectedBytesVerified && witness.returned === false) {
        domain = "persistence";
        category = "SAVE_SUCCEEDED_RESTORE_REJECTED";
    } else if (["continuation", "restore-recapture"].includes(stage)) {
        // Browser callbacks report their own typed runtime findings. A rejected
        // Node evaluation may instead be a crash, disconnect or trace budget.
        domain = "unresolved";
        category = "WORKER_OPERATION_FAILED";
    } else if (witness.returned === true) {
        domain = "harness";
        category = "POST_RESTORE_FAILED";
    }
    return {
        protocolVersion,
        domain,
        category,
        operation: context.operation ?? "initial-entry",
        stage,
        trialId: context.trialId ?? null,
        documentId: context.documentId ?? null,
        restoreWitness: { ...witness },
        restoreAttempted: witness.entered,
        error: errorDetails(error),
        diagnosticsRef: context.diagnosticsRef ?? null
    };
}
export class ProtocolFailure extends Error {
    constructor(error, context) {
        super(String(error?.message ?? error), { cause: error });
        this.record = classifyFailure(error, context);
    }
}
export function eligibleFinding(issue) {
    if (!["persistence", "runtime"].includes(issue?.domain)) return false;
    if (["SAVE_SUCCEEDED_RESTORE_REJECTED", "RESTORE_THROW"].includes(issue.category)) {
        const w = issue.restoreWitness;
        return Boolean(
            w?.resourcesPrepared && w.expectedBytesVerified && w.entered && w.completed && (issue.category === "RESTORE_THROW" ? w.threw : w.returned === false)
        );
    }
    return true;
}
export function completeEvidence(result) {
    return result.evidenceComplete === true && result.cleanup?.complete === true && !result.incomplete && !result.interrupted && !result.infrastructureFailure;
}
