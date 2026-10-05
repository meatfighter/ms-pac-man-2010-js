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
            signature: config.replayTargetSignature,
            outcome: summary.issues.some((issue) => issue.signature === config.replayTargetSignature)
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
    try {
        reporter.terminal(summary);
    } catch (error) {
        summary.status = "incomplete";
        summary.exitCode = summary.interrupted ? 130 : 2;
        summary.finalizationError = String(error);
    }
    return summary;
}
