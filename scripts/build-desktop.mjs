import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { assertSafeGeneratedDirectoryMutationPath, readBuildVersion, rootDir } from "./build-utils.mjs";
import { getHmacFingerprint, readEnvHmacKey } from "./hmac-config.mjs";
import { acquireReleaseLock } from "./release-lock.mjs";

const releaseLock = acquireReleaseLock("build:desktop");
const version = readBuildVersion();
const releaseBuild = process.argv.includes("--release");
const hmacKeyHex = releaseBuild ? readEnvHmacKey() : "";
const desktopDir = join(rootDir, "desktop");
const sourceDir = join(desktopDir, "src");
const libDir = join(desktopDir, "lib");
const licensesDir = join(desktopDir, "licenses");
const nativeDir = join(desktopDir, "natives");
const thirdPartySourcesDir = join(desktopDir, "third-party-sources");
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
const releaseHighScorePropertiesPath = join(classesDir, "mspacman", "high-score-release.properties");
const runtimeJars = ["slick.jar", "lwjgl.jar", "lwjgl_util.jar", "jinput.jar", "jogg-0.0.7.jar", "jorbis-0.0.17.jar", "gson-2.11.0.jar"];
const EXECUTABLE_ZIP_ENTRIES = new Set([`${distributionName}/run-linux.sh`, `${distributionName}/run-macos.sh`]);
const CRC32_TABLE = createCrc32Table();

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
        const stat = lstatSync(full);
        if (stat.isSymbolicLink()) {
            throw new Error(`Desktop source tree must not contain symbolic links or junctions: ${relative(desktopDir, full)}`);
        }
        if (stat.isDirectory()) {
            collectJavaFiles(full, files);
        } else if (stat.isFile() && entry.endsWith(".java")) {
            files.push(full);
        } else if (!stat.isFile()) {
            throw new Error(`Desktop source tree contains unsupported filesystem entry: ${relative(desktopDir, full)}`);
        }
    }
    return files;
}

function copyResources(source, target) {
    for (const entry of readdirSync(source)) {
        const sourcePath = join(source, entry);
        const targetPath = join(target, entry);
        const stat = lstatSync(sourcePath);
        if (stat.isSymbolicLink()) {
            throw new Error(`Desktop resources must not contain symbolic links or junctions: ${relative(desktopDir, sourcePath)}`);
        }
        if (stat.isDirectory()) {
            mkdirSync(targetPath, { recursive: true });
            copyResources(sourcePath, targetPath);
        } else if (stat.isFile() && !entry.endsWith(".java")) {
            mkdirSync(dirname(targetPath), { recursive: true });
            copyFileSync(sourcePath, targetPath);
        } else if (!stat.isFile()) {
            throw new Error(`Desktop resources contain unsupported filesystem entry: ${relative(desktopDir, sourcePath)}`);
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

function writeHighScoreReleaseProperties() {
    if (!releaseBuild) {
        return;
    }

    const properties = [`hmacKeyHex=${hmacKeyHex}`, `hmacKeyFingerprint=${getHmacFingerprint(hmacKeyHex)}`, `buildStamp=${version.buildStamp}`, ""].join("\n");
    writeFileSync(releaseHighScorePropertiesPath, properties);
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
    if (!existsSync(licensesDir)) {
        throw new Error(`Missing desktop license directory: ${licensesDir}`);
    }
    for (const [sourceArtifact, expectedHash] of Object.entries({
        "jogg-0.0.7-jcraft-jorbis-28592f3-source.zip": "0c814790741d14debc4a88214bdf8d0369a521a652e4d9a375b0cdfdbc21597a",
        "jorbis-0.0.17-sources.jar": "1643dd368b9c160276caf8d1f6a8c0aae43ca5bf49b53348a2a01623641708e5",
        "openal-soft-1.14.tar.bz2": "87bd8d61d5943387898c92b6a2bbbb26118e745dec57550c817526a70fad0914"
    })) {
        const path = join(thirdPartySourcesDir, sourceArtifact);
        if (!existsSync(path)) {
            throw new Error(`Missing desktop corresponding-source artifact: ${path}`);
        }
        const actualHash = createHash("sha256").update(readFileSync(path)).digest("hex");
        if (actualHash !== expectedHash) {
            throw new Error(`Unexpected SHA-256 for ${path}: ${actualHash}`);
        }
    }
}

function copyRuntimeToTarget() {
    assertNoLinksInTree(libDir, "desktop runtime lib");
    assertNoLinksInTree(nativeDir, "desktop native runtime");
    assertSafeGeneratedDirectoryMutationPath(targetLibDir, "desktop target lib directory");
    assertSafeGeneratedDirectoryMutationPath(targetNativeDir, "desktop target native directory");
    rmSync(targetLibDir, { recursive: true, force: true });
    rmSync(targetNativeDir, { recursive: true, force: true });
    mkdirSync(targetLibDir, { recursive: true });
    for (const jar of runtimeJars) {
        copyFileSync(join(libDir, jar), join(targetLibDir, jar));
    }
    cpSync(nativeDir, targetNativeDir, { recursive: true });
}

function createDistribution() {
    assertNoLinksInTree(licensesDir, "desktop licenses");
    assertNoLinksInTree(thirdPartySourcesDir, "desktop third-party sources");
    assertSafeGeneratedDirectoryMutationPath(distributionRoot, "desktop distribution directory");
    rmSync(distributionRoot, { recursive: true, force: true });
    mkdirSync(distributionDir, { recursive: true });
    copyFileSync(stableJarPath, join(distributionDir, `${distributionName}.jar`));
    cpSync(targetLibDir, join(distributionDir, "lib"), { recursive: true });
    cpSync(targetNativeDir, join(distributionDir, "natives"), { recursive: true });
    cpSync(licensesDir, join(distributionDir, "licenses"), { recursive: true });
    cpSync(thirdPartySourcesDir, join(distributionDir, "third-party-sources"), { recursive: true });

    for (const name of ["run-windows.cmd", "run-windows.ps1", "run-linux.sh", "run-macos.sh", "README.md", "RUNTIME_DEPENDENCIES.md"]) {
        copyFileSync(join(desktopDir, name), join(distributionDir, name));
    }
    copyFileSync(join(rootDir, "LICENSE"), join(distributionDir, "LICENSE"));
    copyFileSync(join(rootDir, "THIRD_PARTY_NOTICES.md"), join(distributionDir, "THIRD_PARTY_NOTICES.md"));

    rmSync(versionedZipPath, { force: true });
    rmSync(stableZipPath, { force: true });
    writeDistributionZip(distributionRoot, versionedZipPath);
    copyFileSync(versionedZipPath, stableZipPath);
}

function writeDistributionZip(sourceRoot, targetZipPath) {
    const entries = collectZipEntries(sourceRoot);
    const chunks = [];
    const centralDirectory = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBuffer = Buffer.from(entry.name, "utf8");
        const data = entry.directory ? Buffer.alloc(0) : readFileSync(entry.path);
        const crc = crc32(data);
        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(10, 4);
        localHeader.writeUInt16LE(0x0800, 6);
        localHeader.writeUInt16LE(0, 8);
        localHeader.writeUInt16LE(0, 10);
        localHeader.writeUInt16LE(0x0021, 12);
        localHeader.writeUInt32LE(crc, 14);
        localHeader.writeUInt32LE(data.length, 18);
        localHeader.writeUInt32LE(data.length, 22);
        localHeader.writeUInt16LE(nameBuffer.length, 26);
        localHeader.writeUInt16LE(0, 28);
        chunks.push(localHeader, nameBuffer, data);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(0x031e, 4);
        centralHeader.writeUInt16LE(10, 6);
        centralHeader.writeUInt16LE(0x0800, 8);
        centralHeader.writeUInt16LE(0, 10);
        centralHeader.writeUInt16LE(0, 12);
        centralHeader.writeUInt16LE(0x0021, 14);
        centralHeader.writeUInt32LE(crc, 16);
        centralHeader.writeUInt32LE(data.length, 20);
        centralHeader.writeUInt32LE(data.length, 24);
        centralHeader.writeUInt16LE(nameBuffer.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE((entry.mode << 16) | (entry.directory ? 0x10 : 0), 38);
        centralHeader.writeUInt32LE(offset, 42);
        centralDirectory.push(centralHeader, nameBuffer);

        offset += localHeader.length + nameBuffer.length + data.length;
    }

    const centralDirectorySize = centralDirectory.reduce((size, chunk) => size + chunk.length, 0);
    const endOfCentralDirectory = Buffer.alloc(22);
    endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
    endOfCentralDirectory.writeUInt16LE(0, 4);
    endOfCentralDirectory.writeUInt16LE(0, 6);
    endOfCentralDirectory.writeUInt16LE(entries.length, 8);
    endOfCentralDirectory.writeUInt16LE(entries.length, 10);
    endOfCentralDirectory.writeUInt32LE(centralDirectorySize, 12);
    endOfCentralDirectory.writeUInt32LE(offset, 16);
    endOfCentralDirectory.writeUInt16LE(0, 20);
    writeFileSync(targetZipPath, Buffer.concat([...chunks, ...centralDirectory, endOfCentralDirectory]));
}

function collectZipEntries(sourceRoot) {
    const entries = [];
    collectZipEntriesFromDirectory(sourceRoot, sourceRoot, entries);
    return entries.sort((a, b) => a.name.localeCompare(b.name));
}

function collectZipEntriesFromDirectory(dir, sourceRoot, entries) {
    const directoryName = relative(sourceRoot, dir).replaceAll("\\", "/");
    if (directoryName !== "") {
        entries.push({
            directory: true,
            mode: 0o755,
            name: `${directoryName}/`,
            path: dir
        });
    }

    for (const entry of readdirSync(dir).sort((a, b) => a.localeCompare(b))) {
        const path = join(dir, entry);
        const stat = lstatSync(path);
        if (stat.isSymbolicLink()) {
            throw new Error(`Desktop release ZIP input must not contain symbolic links or junctions: ${relative(sourceRoot, path)}`);
        }
        if (stat.isDirectory()) {
            collectZipEntriesFromDirectory(path, sourceRoot, entries);
        } else if (stat.isFile()) {
            const name = relative(sourceRoot, path).replaceAll("\\", "/");
            entries.push({
                directory: false,
                mode: EXECUTABLE_ZIP_ENTRIES.has(name) ? 0o755 : 0o644,
                name,
                path
            });
        } else {
            throw new Error(`Desktop release ZIP input contains unsupported filesystem entry: ${relative(sourceRoot, path)}`);
        }
    }
}

function assertNoLinksInTree(dir, description) {
    for (const entry of readdirSync(dir).sort((a, b) => a.localeCompare(b))) {
        const path = join(dir, entry);
        const stat = lstatSync(path);
        if (stat.isSymbolicLink()) {
            throw new Error(`${description} must not contain symbolic links or junctions: ${relative(desktopDir, path)}`);
        }
        if (stat.isDirectory()) {
            assertNoLinksInTree(path, description);
        } else if (!stat.isFile()) {
            throw new Error(`${description} contains unsupported filesystem entry: ${relative(desktopDir, path)}`);
        }
    }
}

function createCrc32Table() {
    const table = new Uint32Array(256);
    for (let i = 0; i < table.length; i++) {
        let value = i;
        for (let bit = 0; bit < 8; bit++) {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[i] = value >>> 0;
    }
    return table;
}

function crc32(buffer) {
    let value = 0xffffffff;
    for (const byte of buffer) {
        value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
    }
    return (value ^ 0xffffffff) >>> 0;
}

try {
    if (!commandExists("javac")) {
        throw new Error("The desktop build requires javac on PATH.");
    }
    if (!commandExists("jar")) {
        throw new Error("The desktop build requires jar on PATH.");
    }
    assertSafeGeneratedDirectoryMutationPath(targetDir, "desktop target directory");
    verifyRuntimeDependencies();
    assertSafeGeneratedDirectoryMutationPath(classesDir, "desktop classes directory");
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
    writeHighScoreReleaseProperties();
    writeManifest();
    run("jar", ["cfm", versionedJarPath, manifestPath, "-C", classesDir, "."]);
    copyFileSync(versionedJarPath, stableJarPath);
    createDistribution();

    console.log(`Built ${relative(rootDir, stableJarPath)}`);
    console.log(`Built ${relative(rootDir, stableZipPath)}`);
} finally {
    releaseLock();
}
