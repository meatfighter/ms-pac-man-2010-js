import { evaluateCampaign } from "./profiles.mjs";
/** The only publisher of terminal outcomes. Called after source and dist checks. */
export function finalizeCampaign(config, reporter, summary, integrityVerified) {
    summary.integrityVerified = integrityVerified;
    summary.evidenceIncomplete ||= reporter.incomplete;
    summary.status = summary.interrupted
        ? "interrupted"
        : summary.planCompleted &&
            integrityVerified &&
            !summary.evidenceIncomplete &&
            !summary.incomplete &&
            !summary.infrastructureFailures &&
            !summary.missingCoverage.length
          ? "completed"
          : "incomplete";
    summary.exitCode = evaluateCampaign(config, summary);
    if (summary.status === "incomplete" && !summary.stopReason) summary.stopReason = "infrastructure";
    if (config.replayTargetSignature)
        summary.replayTarget = {
            protocolVersion: 3,
            signature: config.replayTargetSignature,
            observations: summary.issues.map(({ domain, operation, stage, restoreWitness, signature }) => ({
                domain,
                operation,
                stage,
                restoreWitness,
                signature
            })),
            outcome: summary.issues.some((issue) => issue.eligible === true && issue.signature === config.replayTargetSignature)
                ? "reproduced"
                : summary.status === "completed"
                  ? "not-observed"
                  : "inconclusive",
            otherFindings: summary.issues.filter((issue) => issue.signature !== config.replayTargetSignature).map((issue) => issue.signature)
        };
    try {
        reporter.atomic("summary.json", summary);
    } catch (error) {
        summary.evidenceIncomplete = true;
        summary.status = "incomplete";
        summary.exitCode = summary.interrupted ? 130 : 2;
        summary.finalizationError = String(error);
    }
    try {
        reporter.close();
    } catch (error) {
        summary.evidenceIncomplete = true;
        summary.status = "incomplete";
        summary.exitCode = summary.interrupted ? 130 : 2;
        summary.finalizationError = String(error);
    }
    if (summary.finalizationError) {
        try {
            reporter.atomic("summary.json", summary);
        } catch {
            /* Reserved terminal still records failure. */
        }
    }
    try {
        const receipt = reporter.terminal(summary);
        summary.exitCode = receipt.exitCode;
        summary.status = receipt.status;
        summary.evidenceIncomplete ||= receipt.evidenceIncomplete;
    } catch (error) {
        summary.status = "incomplete";
        summary.exitCode = summary.interrupted ? 130 : 2;
        summary.finalizationError = String(error);
    }
    return summary;
}
