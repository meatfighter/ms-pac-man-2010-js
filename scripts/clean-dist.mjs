import { cleanDirectory, distDir } from "./build-utils.mjs";

cleanDirectory(distDir);
console.log(`Cleaned ${distDir}`);
