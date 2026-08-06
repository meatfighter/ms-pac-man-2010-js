import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { rootDir } from "./build-utils.mjs";

const desktopDir = join(rootDir, "desktop");
const targetDir = join(desktopDir, "target");
const jarPath = join(targetDir, "ms-pac-man-2010-desktop.jar");
const nativeFolder = process.platform === "win32"
    ? "windows"
    : process.platform === "darwin"
        ? "macosx"
        : "linux";
const nativePath = join(targetDir, "natives", nativeFolder);

if (!existsSync(jarPath)) {
    console.error("Missing desktop jar. Run npm run build:desktop first.");
    process.exit(1);
}
if (!existsSync(nativePath)) {
    console.error(`Missing native library directory: ${nativePath}`);
    process.exit(1);
}

const result = spawnSync("java", [
    `-Dorg.lwjgl.librarypath=${nativePath}`,
    "-jar",
    jarPath
], {
    cwd: desktopDir,
    stdio: "inherit"
});

process.exit(result.status ?? 1);
