import { readVersion, writeVersion } from "./build-utils.mjs";
import { acquireReleaseLock } from "./release-lock.mjs";

const releaseLock = acquireReleaseLock("stamp");
try {
    const version = readVersion();
    version.buildStamp = new Date().toISOString();
    writeVersion(version);
    console.log(`Stamped ${version.version} at ${version.buildStamp}`);
} finally {
    releaseLock();
}
