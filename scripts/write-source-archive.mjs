import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { deflateRawSync } from "node:zlib";
import { distDir, ensureDirectory, readVersion, rootDir } from "./build-utils.mjs";

const version = readVersion();
const downloadsDir = join(distDir, "downloads");
const archiveRootName = `ms-pac-man-2010-js-source-${version.version}`;
const versionedZipPath = join(downloadsDir, `${archiveRootName}.zip`);
const stableZipPath = join(downloadsDir, "ms-pac-man-2010-js-source.zip");
const CRC32_TABLE = createCrc32Table();

ensureDirectory(downloadsDir);
rmSync(versionedZipPath, { force: true });
rmSync(stableZipPath, { force: true });
writeSourceZip(versionedZipPath);
copyFileSync(versionedZipPath, stableZipPath);
console.log(`Wrote ${relative(rootDir, stableZipPath)}`);
console.log(`Wrote ${relative(rootDir, versionedZipPath)}`);

function writeSourceZip(outputPath) {
    const entries = [];
    for (const file of listSourceFiles().sort((a, b) => a.localeCompare(b))) {
        if (shouldExcludeSourceFile(file)) {
            continue;
        }
        const source = join(rootDir, file);
        if (!existsSync(source)) {
            continue;
        }
        entries.push({
            data: readFileSync(source),
            name: `${archiveRootName}/${file.replaceAll("\\", "/")}`
        });
    }

    writeFileSync(outputPath, createZip(entries));
}

function createZip(entries) {
    const fileRecords = [];
    const centralRecords = [];
    let offset = 0;
    for (const entry of entries) {
        const name = Buffer.from(entry.name, "utf8");
        const crc = crc32(entry.data);
        const compressed = deflateRawSync(entry.data, { level: 9 });
        const localHeader = createLocalFileHeader(name, entry.data.length, compressed.length, crc);
        fileRecords.push(localHeader, name, compressed);
        centralRecords.push(createCentralDirectoryHeader(name, entry.data.length, compressed.length, crc, offset), name);
        offset += localHeader.length + name.length + compressed.length;
    }

    const centralDirectoryOffset = offset;
    const centralDirectory = Buffer.concat(centralRecords);
    const endRecord = createEndOfCentralDirectoryRecord(entries.length, centralDirectory.length, centralDirectoryOffset);
    return Buffer.concat([...fileRecords, centralDirectory, endRecord]);
}

function createLocalFileHeader(name, uncompressedSize, compressedSize, crc) {
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressedSize, 18);
    header.writeUInt32LE(uncompressedSize, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    return header;
}

function createCentralDirectoryHeader(name, uncompressedSize, compressedSize, crc, localHeaderOffset) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(33, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(compressedSize, 20);
    header.writeUInt32LE(uncompressedSize, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(localHeaderOffset, 42);
    return header;
}

function createEndOfCentralDirectoryRecord(entryCount, centralDirectorySize, centralDirectoryOffset) {
    const record = Buffer.alloc(22);
    record.writeUInt32LE(0x06054b50, 0);
    record.writeUInt16LE(0, 4);
    record.writeUInt16LE(0, 6);
    record.writeUInt16LE(entryCount, 8);
    record.writeUInt16LE(entryCount, 10);
    record.writeUInt32LE(centralDirectorySize, 12);
    record.writeUInt32LE(centralDirectoryOffset, 16);
    record.writeUInt16LE(0, 20);
    return record;
}

function crc32(data) {
    let crc = 0xffffffff;
    for (const byte of data) {
        crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function shouldExcludeSourceFile(file) {
    return (
        (file === "package-lock.json" && !existsSync(join(rootDir, file))) ||
        file === ".release-secrets" ||
        file.startsWith(".release-secrets/") ||
        file === "dist" ||
        file.startsWith("dist/") ||
        file === "desktop/target" ||
        file.startsWith("desktop/target/")
    );
}

function listSourceFiles() {
    const result = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
        cwd: rootDir,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true
    });
    if (result.status !== 0 || result.error) {
        throw result.error ?? new Error("git ls-files failed.");
    }
    return result.stdout.split("\0").filter(Boolean);
}

function createCrc32Table() {
    const table = new Array(256);
    for (let i = 0; i < table.length; i++) {
        let value = i;
        for (let bit = 0; bit < 8; bit++) {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[i] = value >>> 0;
    }
    return table;
}
