import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { distDir, readVersion, rootDir } from "./build-utils.mjs";

const version = readVersion();
const desktopDir = join(rootDir, "desktop");
const sourceDir = join(desktopDir, "src");
const libDir = join(desktopDir, "lib");
const nativeDir = join(desktopDir, "natives");
const targetDir = join(desktopDir, "target");
const classesDir = join(targetDir, "classes");
const targetLibDir = join(targetDir, "lib");
const targetNativeDir = join(targetDir, "natives");
const distributionRoot = join(targetDir, "distribution");
const distributionName = "ms-pac-man-2010-desktop";
const distributionDir = join(distributionRoot, distributionName);
const versionedJarPath = join(targetDir, `${distributionName}-${version.version}.jar`);
const stableJarPath = join(targetDir, `${distributionName}.jar`);
const versionedZipPath = join(targetDir, `${distributionName}-${version.version}.zip`);
const stableZipPath = join(targetDir, `${distributionName}.zip`);
const sourcesFile = join(targetDir, "sources.txt");
const manifestPath = join(targetDir, "MANIFEST.MF");
const runtimeJars = ["slick.jar", "lwjgl.jar", "lwjgl_util.jar", "jinput.jar", "jogg-0.0.7.jar", "jorbis-0.0.17.jar", "gson-2.11.0.jar"];

function commandExists(command) {
    const finder = process.platform === "win32" ? "where.exe" : "which";
    const result = spawnSync(finder, [command], { stdio: "ignore" });
    return result.status === 0;
}

function run(command, args, cwd = rootDir) {
    const result = spawnSync(command, args, {
        cwd,
        stdio: "inherit"
    });
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

function runCapture(command, args) {
    return spawnSync(command, args, {
        cwd: rootDir,
        encoding: "utf8"
    });
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

function getJavacFeatureVersion() {
    const result = runCapture("javac", ["-version"]);
    if (result.error || result.status !== 0) {
        return null;
    }
    return parseJavaFeatureVersion(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
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

function copyResources(source, target) {
    for (const entry of readdirSync(source)) {
        const sourcePath = join(source, entry);
        const targetPath = join(target, entry);
        const stat = statSync(sourcePath);
        if (stat.isDirectory()) {
            mkdirSync(targetPath, { recursive: true });
            copyResources(sourcePath, targetPath);
        } else if (!entry.endsWith(".java")) {
            mkdirSync(dirname(targetPath), { recursive: true });
            copyFileSync(sourcePath, targetPath);
        }
    }
}

function formatManifestAttribute(name, value) {
    const maxLineLength = 68;
    const parts = value.split(" ");
    let current = `${name}:`;
    let output = "";

    for (const part of parts) {
        const candidate = `${current} ${part}`;
        if (Buffer.byteLength(candidate, "utf8") > maxLineLength && current !== `${name}:`) {
            output += `${current} \n`;
            current = ` ${part}`;
        } else {
            current = candidate;
        }
    }

    return `${output}${current}\n`;
}

function writeManifest() {
    const classPath = runtimeJars.map((name) => `lib/${name}`).join(" ");
    const manifest = ["Manifest-Version: 1.0\n", "Main-Class: mspacman.Main\n", formatManifestAttribute("Class-Path", classPath), "\n"].join("");
    writeFileSync(manifestPath, manifest);
}

function verifyRuntimeDependencies() {
    for (const jar of runtimeJars) {
        const path = join(libDir, jar);
        if (!existsSync(path)) {
            throw new Error(`Missing desktop runtime jar: ${path}`);
        }
    }
    if (!existsSync(nativeDir)) {
        throw new Error(`Missing desktop native directory: ${nativeDir}`);
    }
}

function copyRuntimeToTarget() {
    rmSync(targetLibDir, { recursive: true, force: true });
    rmSync(targetNativeDir, { recursive: true, force: true });
    mkdirSync(targetLibDir, { recursive: true });
    for (const jar of runtimeJars) {
        copyFileSync(join(libDir, jar), join(targetLibDir, jar));
    }
    cpSync(nativeDir, targetNativeDir, { recursive: true });
}

function createDistribution() {
    rmSync(distributionRoot, { recursive: true, force: true });
    mkdirSync(distributionDir, { recursive: true });
    copyFileSync(stableJarPath, join(distributionDir, `${distributionName}.jar`));
    cpSync(targetLibDir, join(distributionDir, "lib"), { recursive: true });
    cpSync(targetNativeDir, join(distributionDir, "natives"), { recursive: true });

    for (const name of ["run-windows.cmd", "run-windows.ps1", "run-linux.sh", "run-macos.sh", "README.md", "RUNTIME_DEPENDENCIES.md"]) {
        copyFileSync(join(desktopDir, name), join(distributionDir, name));
    }
    copyFileSync(join(rootDir, "LICENSE"), join(distributionDir, "LICENSE"));

    rmSync(versionedZipPath, { force: true });
    rmSync(stableZipPath, { force: true });
    run("jar", ["cf", versionedZipPath, distributionName], distributionRoot);
    copyFileSync(versionedZipPath, stableZipPath);
}

if (!commandExists("javac")) {
    throw new Error("The desktop build requires javac on PATH.");
}
if (!commandExists("jar")) {
    throw new Error("The desktop build requires jar on PATH.");
}

verifyRuntimeDependencies();
rmSync(classesDir, { recursive: true, force: true });
mkdirSync(classesDir, { recursive: true });
mkdirSync(targetDir, { recursive: true });
copyRuntimeToTarget();

const sources = collectJavaFiles(join(sourceDir, "mspacman"));
writeFileSync(sourcesFile, sources.map((source) => source.replaceAll("\\", "/")).join("\n"));

const classpath = runtimeJars.map((name) => join(libDir, name)).join(process.platform === "win32" ? ";" : ":");
const javacVersion = getJavacFeatureVersion();
const releaseArgs = javacVersion !== null && javacVersion >= 9 ? ["--release", "8"] : ["-source", "1.8", "-target", "1.8"];

run("javac", ["-encoding", "UTF-8", "-Xlint:-options", ...releaseArgs, "-cp", classpath, "-d", classesDir, `@${sourcesFile}`]);

copyResources(sourceDir, classesDir);
writeManifest();
run("jar", ["cfm", versionedJarPath, manifestPath, "-C", classesDir, "."]);
copyFileSync(versionedJarPath, stableJarPath);
createDistribution();

console.log(`Built ${relative(rootDir, stableJarPath)}`);
console.log(`Built ${relative(rootDir, stableZipPath)}`);
if (existsSync(distDir)) {
    console.log("Run npm run assemble to copy the desktop zip into dist/downloads.");
}
