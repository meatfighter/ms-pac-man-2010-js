import { readVersion, writeVersion } from "./build-utils.mjs";

const version = readVersion();
version.buildStamp = new Date().toISOString();
writeVersion(version);
console.log(`Stamped ${version.version} at ${version.buildStamp}`);
