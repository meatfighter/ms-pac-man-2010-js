import { createHash } from "node:crypto";
export function sealCheckpoint(checkpoint, identity) {
    return {
        ...checkpoint,
        formatVersion: 2,
        snapshotHash: createHash("sha256").update(checkpoint.text).digest("hex"),
        sourceIdentity: identity?.digest ?? null,
        resourceIdentity: identity?.engineDigest ?? null
    };
}
export function assertCheckpoint(checkpoint, identity, allowSourceDrift = false) {
    if (
        checkpoint?.formatVersion !== 2 ||
        typeof checkpoint.text !== "string" ||
        checkpoint.text.length > 4 * 1024 * 1024 ||
        !checkpoint.captureContext ||
        !checkpoint.origin ||
        !Number.isFinite(checkpoint.clock)
    )
        throw new Error("Unsupported checkpoint format/context");
    if (createHash("sha256").update(checkpoint.text).digest("hex") !== checkpoint.snapshotHash) throw new Error("Checkpoint bytes do not match hash");
    if (identity && !allowSourceDrift && (checkpoint.sourceIdentity !== identity.digest || checkpoint.resourceIdentity !== identity.engineDigest))
        throw new Error("Checkpoint source/resource identity differs");
}
