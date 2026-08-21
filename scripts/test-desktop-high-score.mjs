import { readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ensureDirectory, rootDir } from "./build-utils.mjs";

const desktopDir = join(rootDir, "desktop");
const sourceDir = join(desktopDir, "src");
const testDir = join(desktopDir, "test");
const targetDir = join(desktopDir, "target");
const testClassesDir = join(targetDir, "test-classes");
const sourcesFile = join(targetDir, "test-sources.txt");
const runtimeJars = ["slick.jar", "lwjgl.jar", "lwjgl_util.jar", "jinput.jar", "jogg-0.0.7.jar", "jorbis-0.0.17.jar", "gson-2.11.0.jar"];

if (!commandExists("javac")) {
    throw new Error("Desktop high-score tests require javac on PATH.");
}
if (!commandExists("java")) {
    throw new Error("Desktop high-score tests require java on PATH.");
}

rmSync(testClassesDir, { recursive: true, force: true });
ensureDirectory(testClassesDir);
ensureDirectory(targetDir);

const sources = [...collectJavaFiles(join(sourceDir, "mspacman")), ...collectJavaFiles(join(testDir, "mspacman"))];
writeFileSync(sourcesFile, `${sources.map((source) => source.replaceAll("\\", "/")).join("\n")}\n`);

const classpath = runtimeJars.map((name) => join(desktopDir, "lib", name)).join(process.platform === "win32" ? ";" : ":");
const javacVersion = getJavacFeatureVersion();
const releaseArgs = javacVersion !== null && javacVersion >= 9 ? ["--release", "8"] : ["-source", "1.8", "-target", "1.8"];

run("javac", ["-encoding", "UTF-8", "-Xlint:-options", ...releaseArgs, "-cp", classpath, "-d", testClassesDir, `@${sourcesFile}`]);
run("java", ["-Djava.awt.headless=true", "-cp", `${testClassesDir}${process.platform === "win32" ? ";" : ":"}${classpath}`, "mspacman.HighScoreServiceTest"], {
    ...process.env,
    MSPACMAN_HMAC_KEY_HEX: "",
    MSPACMAN_SCORE_API_URL: ""
});

function commandExists(command) {
    const finder = process.platform === "win32" ? "where.exe" : "which";
    const result = spawnSync(finder, [command], { stdio: "ignore", windowsHide: true });
    return result.status === 0;
}

function run(command, args, env = process.env) {
    const result = spawnSync(command, args, {
        cwd: rootDir,
        env,
        stdio: "inherit",
        windowsHide: true
    });
    if (result.status !== 0 || result.error) {
        throw result.error ?? new Error(`${command} failed.`);
    }
}

function getJavacFeatureVersion() {
    const result = spawnSync("javac", ["-version"], {
        cwd: rootDir,
        encoding: "utf8",
        windowsHide: true
    });
    if (result.error || result.status !== 0) {
        return null;
    }
    return parseJavaFeatureVersion(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
}

function parseJavaFeatureVersion(output) {
    const match = output.match(/(?:javac|(?:openjdk|java) version)\s+"?(\d+)(?:\.(\d+))?/i);
    if (!match) {
        return null;
    }

    const major = Number(match[1]);
    if (major === 1 && match[2] !== undefined) {
        return Number(match[2]);
    }
    return major;
}

function collectJavaFiles(dir, files = []) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            collectJavaFiles(full, files);
        } else if (entry.endsWith(".java")) {
            files.push(full);
        }
    }
    return files;
}
