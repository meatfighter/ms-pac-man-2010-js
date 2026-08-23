import { cleanDirectory, repositoryDistDir } from "./build-utils.mjs";
import { acquireReleaseLock } from "./release-lock.mjs";

const releaseLock = acquireReleaseLock("clean");
try {
    cleanDirectory(repositoryDistDir);
    console.log(`Cleaned ${repositoryDistDir}`);
} finally {
    releaseLock();
}
