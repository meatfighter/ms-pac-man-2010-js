import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { rootDir } from "./build-utils.mjs";

const desktopDir = join(rootDir, "desktop");
const targetDir = join(desktopDir, "target");
const jarPath = join(targetDir, "ms-pac-man-2010-desktop.jar");
const nativeFolder = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macosx" : "linux";
const jinputPlugin =
    process.platform === "win32"
        ? "net.java.games.input.DirectAndRawInputEnvironmentPlugin"
        : process.platform === "darwin"
          ? "net.java.games.input.OSXEnvironmentPlugin"
          : "net.java.games.input.LinuxEnvironmentPlugin";
const nativePath = join(targetDir, "natives", nativeFolder);

function javaSupportsArg(arg) {
    const result = spawnSync("java", [arg, "-version"], {
        cwd: desktopDir,
        stdio: "ignore"
    });
    return !result.error && result.status === 0;
}

const javaCompatibilityArgs = ["--enable-native-access=ALL-UNNAMED", "--sun-misc-unsafe-memory-access=allow"].filter((arg) => javaSupportsArg(arg));
if (process.platform === "darwin" && javaSupportsArg("-XstartOnFirstThread")) {
    javaCompatibilityArgs.unshift("-XstartOnFirstThread");
}

if (!existsSync(jarPath)) {
    console.error("Missing desktop jar. Run npm run build:desktop first.");
    process.exit(1);
}
if (!existsSync(nativePath)) {
    console.error(`Missing native library directory: ${nativePath}`);
    process.exit(1);
}

const result = spawnSync(
    "java",
    [
        ...javaCompatibilityArgs,
        `-Dorg.lwjgl.librarypath=${nativePath}`,
        `-Dnet.java.games.input.librarypath=${nativePath}`,
        `-Djava.library.path=${nativePath}`,
        "-Djinput.useDefaultPlugin=false",
        `-Dnet.java.games.input.plugins=${jinputPlugin}`,
        "-jar",
        jarPath
    ],
    {
        cwd: desktopDir,
        stdio: "inherit"
    }
);

process.exit(result.status ?? 1);
