import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { inflateRawSync } from "node:zlib";
import {
    assertSecretAbsentFromTrackedFiles,
    createCacheIdentity,
    getHmacFingerprint,
    readSelectedHmacKey,
    SYNTHETIC_RELEASE_HMAC_KEY_HEX
} from "./hmac-config.mjs";
import { distDir, readBuildVersion, rootDir } from "./build-utils.mjs";
import { assertReleaseProvenance } from "./release-provenance.mjs";
import { listFilesStrict } from "./release-io.mjs";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const target = process.env.MSPACMAN_RELEASE_VERIFY_TARGET ?? readOption("target", "full");
const keySource = readOption("key-source", "env");
const expectedReleaseKind = readOption("expected-release-kind", "");
const expectedHmacKeySource = readOption("expected-hmac-key-source", "");
const validTargets = new Set(["pwa", "web", "desktop", "full"]);
assert.ok(validTargets.has(target), `Unknown release verification target: ${target}`);
const hmacKeyHex = readSelectedHmacKey(keySource);
const sourceVersion = readBuildVersion();
const releaseMetadata = target === "web" || target === "full" ? readReleaseMetadataIfAvailable() : null;
const version = readVerificationVersion(sourceVersion, releaseMetadata);
const cacheIdentity = createCacheIdentity(version, hmacKeyHex);
const fingerprint = getHmacFingerprint(hmacKeyHex);
const verifierEnv = {
    ...process.env,
    MSPACMAN_CACHE_VERSION: cacheIdentity,
    MSPACMAN_HMAC_KEY_HEX: hmacKeyHex
};
const forbiddenDeploymentRootPatterns = [
    {
        label: "/pwa/",
        pattern: /(^|[^.])\/pwa\//
    },
    {
        label: "/mspacman2010/",
        pattern: /\/mspacman2010\//
    },
    {
        label: "/ms-pac-man-2010/",
        pattern: /\/ms-pac-man-2010\//
    },
    {
        label: "/ms-pac-man-2010-staging/",
        pattern: /\/ms-pac-man-2010-staging\//
    }
];
const runtimeTextExtensions = new Set([".css", ".html", ".js", ".json", ".svg", ".txt", ".webmanifest", ".xml"]);

verifyDistDoesNotContainLocalReleaseState();

if (target === "pwa" || target === "web" || target === "full") {
    verifyPwaRelease();
}

if (target === "web" || target === "full") {
    verifyAboutRelease();
    verifyReleaseMetadata();
}

if (target === "web" || target === "desktop" || target === "full") {
    verifyDesktopRelease();
}

if (target === "web" || target === "full") {
    verifyReleaseChecksumManifest();
    verifyGeneratedRuntimeDoesNotContainHardcodedDeploymentRoots(distDir);
}

await verifyTrackedSourceDoesNotContainSelectedKey();
console.log(`Release artifacts verified for target ${target} with key fingerprint ${fingerprint}.`);

function verifyPwaRelease() {
    runNpmScript("verify:pwa-build");

    const pwaDistDir = join(distDir, "pwa");
    const thirdPartyNoticesPath = join(pwaDistDir, "THIRD_PARTY_NOTICES.txt");
    const serviceWorker = readFileSync(join(pwaDistDir, "sw.js"), "utf8");
    assert.ok(
        serviceWorker.includes(`const VERSION = ${JSON.stringify(cacheIdentity)};`),
        "Service worker VERSION must include the version, build stamp, and HMAC fingerprint."
    );
    assert.equal(serviceWorker.includes(hmacKeyHex), false, "Service worker must not contain the full HMAC key.");
    assert.ok(existsSync(thirdPartyNoticesPath), "PWA release output must include THIRD_PARTY_NOTICES.txt.");
    assert.equal(
        readFileSync(thirdPartyNoticesPath, "utf8"),
        readFileSync(join(rootDir, "THIRD_PARTY_NOTICES.md"), "utf8"),
        "PWA third-party notices must be copied from the canonical root notice file."
    );

    const sourceMaps = listFiles(pwaDistDir).filter((path) => path.endsWith(".map"));
    assert.deepEqual(sourceMaps, [], "Release PWA output must not contain source maps.");

    const builtJsFiles = listFiles(join(pwaDistDir, "assets")).filter((path) => path.endsWith(".js"));
    assert.ok(builtJsFiles.length > 0, "Release PWA output must contain built JavaScript assets.");
    assert.ok(
        builtJsFiles.some((path) => readFileSync(path, "utf8").includes(hmacKeyHex)),
        "Release PWA JavaScript must embed the selected HMAC key."
    );
    verifyGeneratedRuntimeDoesNotContainHardcodedDeploymentRoots(pwaDistDir);
}

function verifyAboutRelease() {
    const aboutIndex = readFileSync(join(distDir, "index.html"), "utf8");
    const encodedBuildStamp = encodeURIComponent(version.buildStamp);
    assert.ok(aboutIndex.includes(`pwa/?v=${encodeURIComponent(cacheIdentity)}`), "About page Play link must use the selected release cache identity.");
    assert.ok(
        aboutIndex.includes('href="https://github.com/meatfighter/ms-pac-man-2010-js" target="_blank" rel="noopener noreferrer">Source</a>'),
        "About page footer Source link must open the GitHub repository."
    );
    assert.ok(aboutIndex.includes(`downloads/ms-pac-man-2010-desktop.zip?v=${encodedBuildStamp}`), "About page must link to the desktop ZIP.");
    assert.ok(aboutIndex.includes('download="ms-pac-man-2010-desktop.zip"'), "About page desktop ZIP link must use a download attribute.");
    assert.ok(existsSync(join(distDir, "downloads", "ms-pac-man-2010-desktop.zip")), "About page desktop ZIP link target must exist.");
    assert.ok(
        existsSync(join(distDir, "downloads", `ms-pac-man-2010-desktop-${version.version}.zip`)),
        "About page versioned desktop ZIP link target must exist."
    );
    assert.ok(aboutIndex.includes('<link rel="canonical" href="https://meatfighter.com/mspacman2010/">'), "About page must include canonical metadata.");
    assert.ok(
        aboutIndex.includes('<meta property="og:image" content="https://meatfighter.com/mspacman2010/assets/ms-pac-man-2010-screenshot.png">'),
        "About page must include social preview image metadata."
    );
    assert.ok(aboutIndex.includes('<nav class="toc" aria-labelledby="toc-heading">'), "About page must include the generated top contents index.");
    assert.ok(
        aboutIndex.includes('<li class="toc-level-2"><a href="#browser-menu">Browser Menu</a></li>'),
        "About page contents index must link to Markdown headings."
    );
    assert.ok(aboutIndex.includes('<article class="article" aria-label="About Ms. Pac-Man 2010">'), "About page must include generated article content.");
    assert.ok(
        aboutIndex.indexOf('<nav class="toc" aria-labelledby="toc-heading">') <
            aboutIndex.indexOf('<article class="article" aria-label="About Ms. Pac-Man 2010">'),
        "About page contents index must appear before the generated article body."
    );
    assert.ok(aboutIndex.includes('<a class="heading-link" href="#controls">Controls</a>'), "About page must render Markdown headings with anchors.");
    assert.ok(aboutIndex.includes('<a class="play-button" href="pwa/?v='), "About page must render the Markdown Play link as the themed button.");
    assert.ok(aboutIndex.includes("assets/title-750.webp"), "About page must use generated responsive title WebP assets.");
    assert.ok(aboutIndex.includes("assets/title-750.png"), "About page must use generated responsive title PNG assets.");
    assert.equal(/__[A-Z][A-Z0-9_]*__/.test(aboutIndex), false, "About page must not contain unresolved template tokens.");
    assert.equal(/\*\*\[here\]\*\*|\bTODO\b|executable JAR/i.test(aboutIndex), false, "About page must not contain old placeholder content.");
    for (const requiredAsset of [
        "theme.js",
        "styles.css",
        "assets/title-750.png",
        "assets/title-1500.png",
        "assets/title-750.webp",
        "assets/title-1500.webp",
        "assets/title.png",
        "assets/ms-pac-man-2010-screenshot.png",
        "assets/fonts/source-sans-3/SourceSans3VF-Upright.ttf.woff2",
        "assets/fonts/source-sans-3/SourceSans3VF-Italic.ttf.woff2",
        "assets/fonts/source-sans-3/LICENSE.md"
    ]) {
        assert.ok(existsSync(join(distDir, requiredAsset)), `About release must include ${requiredAsset}.`);
    }
}

function verifyDesktopRelease() {
    const distributionName = "ms-pac-man-2010-desktop";
    const desktopReleaseDir = target === "web" || target === "full" ? join(distDir, "downloads") : join(rootDir, "desktop", "target");
    const stableZipPath = join(desktopReleaseDir, `${distributionName}.zip`);
    const versionedZipPath = join(desktopReleaseDir, `${distributionName}-${version.version}.zip`);
    assert.ok(existsSync(stableZipPath), `Desktop release ZIP must exist: ${stableZipPath}`);
    assert.ok(existsSync(versionedZipPath), `Desktop versioned release ZIP must exist: ${versionedZipPath}`);
    assert.equal(sha256File(stableZipPath), sha256File(versionedZipPath), "Stable and versioned desktop release ZIPs must be byte-for-byte identical.");

    const desktopZip = readFileSync(versionedZipPath);
    const zipEntries = readZipEntriesFromBuffer(desktopZip);
    const zipEntryNames = zipEntries.map((entry) => entry.name);
    assert.equal(zipEntryNames.includes("META-INF/MANIFEST.MF"), false, "Desktop release ZIP must not contain an outer ZIP manifest.");
    assert.equal(zipEntryNames.includes(`${distributionName}/META-INF/MANIFEST.MF`), false, "Desktop release ZIP must not contain an outer ZIP manifest.");
    assert.ok(zipEntryNames.includes(`${distributionName}/${distributionName}.jar`), "Desktop release ZIP must contain the runnable desktop JAR.");
    verifyZipEntryMode(zipEntries, `${distributionName}/run-linux.sh`, 0o755);
    verifyZipEntryMode(zipEntries, `${distributionName}/run-macos.sh`, 0o755);
    verifyZipEntryMode(zipEntries, `${distributionName}/run-windows.cmd`, 0o644);
    verifyZipEntryMode(zipEntries, `${distributionName}/run-windows.ps1`, 0o644);
    verifyDesktopLauncherContents(desktopZip, zipEntries, distributionName);
    verifyZipEntryMode(zipEntries, `${distributionName}/README.md`, 0o644);
    for (const requiredEntry of [
        `${distributionName}/LICENSE`,
        `${distributionName}/COPYRIGHT.md`,
        `${distributionName}/THIRD_PARTY_NOTICES.md`,
        `${distributionName}/RUNTIME_DEPENDENCIES.md`
    ]) {
        assert.ok(zipEntryNames.includes(requiredEntry), `Desktop release ZIP must contain ${requiredEntry}.`);
    }
    for (const [runtimeEntry, expectedHash] of Object.entries({
        "lib/slick.jar": "02f7a1f0c48847a32fcc1a3330b12b869e73ad7658c7708174d9f1f2ec75847b",
        "lib/lwjgl.jar": "a31267bf348e564217d833cb0b334cfe4062aab12b015c126f323882949d1c1d",
        "lib/lwjgl_util.jar": "2432cbacfcec9cd78165f44f45d045bafff9da122276ed288157699eeee688de",
        "lib/jinput.jar": "36b6fbede7a2d2f00949a87b9de83007a1c6b4ce5a96978279c0cc612a9adef5",
        "lib/jogg-0.0.7.jar": "2e2744b9bfada5e62ba274d6b3089656676599afacc095647234ae383b991ecc",
        "lib/jorbis-0.0.17.jar": "7096b7eef82228c7aea0260fac4884aec416b332dfaac8182dea8c28ba35b45f",
        "lib/gson-2.11.0.jar": "57928d6e5a6edeb2abd3770a8f95ba44dce45f3b23b7a9dc2b309c581552a78b",
        "natives/windows/lwjgl.dll": "60377a953f707aab277410c5fec00224ffa1b861838b657e5916247cfb151453",
        "natives/windows/lwjgl64.dll": "5520eab49c484495a46f04974ee8815477a1c46f0c7b01739eb3a93d863d541a",
        "natives/windows/jinput-dx8.dll": "f6ee33701bfbba481870f4a370d707b87001fb3213efcc60bff325013b4e219c",
        "natives/windows/jinput-dx8_64.dll": "511dc50c2001d3e25845dd479ca82fdfc9d42403f9aa69c6493257c66ddf0266",
        "natives/windows/jinput-raw.dll": "0fcd33e00ba5c51f3fdf3613d89c6e9e00381fef03b550412ea73bc837237dcf",
        "natives/windows/jinput-raw_64.dll": "74cd74d55ea20e8fcea7aed8b97c2cf096da1fcde3faf183f815a4dce9364ec3",
        "natives/windows/OpenAL32.dll": "af7fbb5f60b3e63577d4567ba58df6ede48a7705658c9de6a322d02dde0759b8",
        "natives/windows/OpenAL64.dll": "3ebc1009680b0e04f4b99b54a0e7b768c14603bf5e8080255aa82a01a269b92b",
        "natives/linux/liblwjgl.so": "e0de8f9c34e777578dea80d43ca0b61b16f4edb9d3b2ba8ce52c4d4dd2325f33",
        "natives/linux/liblwjgl64.so": "a448d44fc012e20bef022ece083070ead143fa37daedbc570872d42da11e4189",
        "natives/linux/libjinput-linux.so": "ff7af7a1306451428c98e3f50c5bf2f19bb6cbc5835730917cdd755b8cc626d0",
        "natives/linux/libjinput-linux64.so": "86e650f47790e789696a7a5809461eb4b503f5f841e17488aa7ee5a1bedc05a6",
        "natives/linux/libopenal.so": "0d6511ac012104c470c1fee7311f1459379d1201c796918eb50ae2acecb5801b",
        "natives/linux/libopenal64.so": "2a0ee434b0113a61ea98e583787df0de7e082385613d1d94d7c0515a9e301687",
        "natives/macosx/liblwjgl.jnilib": "ed4800ba1920a4b4bcf74cf78206e662ccfb0d0bc271f85b7e2c8f80336d43d8",
        "natives/macosx/libjinput-osx.jnilib": "d155c29cfa7d7b49cab0821d5ba00a8fdc8b386c8bf5669f0313a62e44ba70d6",
        "natives/macosx/openal.dylib": "ff5e52380b5ef5255654c4e61397822cf57598fce5ed5e6d3cde0762b5c837c8"
    })) {
        const entryName = `${distributionName}/${runtimeEntry}`;
        assert.ok(zipEntryNames.includes(entryName), `Desktop release ZIP must contain ${runtimeEntry}.`);
        assert.equal(
            sha256Buffer(readRequiredZipEntryData(desktopZip, zipEntries, entryName)),
            expectedHash,
            `Desktop runtime artifact hash mismatch: ${runtimeEntry}.`
        );
    }
    for (const licenseEntry of [
        "licenses/README.md",
        "licenses/APACHE-2.0.txt",
        "licenses/GNU-LIBRARY-GPL-2.0.txt",
        "licenses/JINPUT-BSD.txt",
        "licenses/JORBIS-JOGG-LGPL-NOTICE.txt",
        "licenses/LWJGL-2-BSD.txt",
        "licenses/OPENAL-SOFT-LGPL-NOTICE.txt",
        "licenses/SLICK2D-BSD-3-CLAUSE.txt"
    ]) {
        assert.ok(zipEntryNames.includes(`${distributionName}/${licenseEntry}`), `Desktop release ZIP must contain ${licenseEntry}.`);
    }
    for (const [sourceEntry, expectedHash] of Object.entries({
        "third-party-sources/jogg-0.0.7-jcraft-jorbis-28592f3-source.zip": "0c814790741d14debc4a88214bdf8d0369a521a652e4d9a375b0cdfdbc21597a",
        "third-party-sources/jorbis-0.0.17-sources.jar": "1643dd368b9c160276caf8d1f6a8c0aae43ca5bf49b53348a2a01623641708e5",
        "third-party-sources/openal-soft-1.14.tar.bz2": "87bd8d61d5943387898c92b6a2bbbb26118e745dec57550c817526a70fad0914"
    })) {
        const entryName = `${distributionName}/${sourceEntry}`;
        assert.ok(zipEntryNames.includes(entryName), `Desktop release ZIP must contain ${sourceEntry}.`);
        assert.equal(
            sha256Buffer(readRequiredZipEntryData(desktopZip, zipEntries, entryName)),
            expectedHash,
            `Desktop source artifact hash mismatch: ${sourceEntry}.`
        );
    }
    assert.equal(
        zipEntryNames.some((entry) => entry.split("/").includes(".release-secrets")),
        false,
        "Desktop release ZIP must not contain .release-secrets."
    );
    const runnableJar = readRequiredZipEntryData(desktopZip, zipEntries, `${distributionName}/${distributionName}.jar`);
    verifyJarReleasePropertiesFromBuffer(runnableJar, `${distributionName}/${distributionName}.jar`);
}

function verifyDesktopLauncherContents(desktopZip, zipEntries, distributionName) {
    const commonCompatibilityArgs = ["--enable-native-access=ALL-UNNAMED", "--sun-misc-unsafe-memory-access=allow"];
    for (const [launcherName, requiredArgs] of Object.entries({
        "run-windows.cmd": commonCompatibilityArgs,
        "run-windows.ps1": commonCompatibilityArgs,
        "run-linux.sh": commonCompatibilityArgs,
        "run-macos.sh": ["-XstartOnFirstThread", ...commonCompatibilityArgs]
    })) {
        const entryName = `${distributionName}/${launcherName}`;
        const launcherText = readRequiredZipEntryData(desktopZip, zipEntries, entryName).toString("utf8");
        for (const arg of requiredArgs) {
            assert.ok(launcherText.includes(arg), `Desktop release launcher ${launcherName} must include ${arg}.`);
        }
    }
}

function verifyReleaseMetadata() {
    const releaseMetadataPath = join(distDir, "release.json");
    assert.ok(existsSync(releaseMetadataPath), "Release output must include dist/release.json.");
    const metadataText = readFileSync(releaseMetadataPath, "utf8");
    const metadata = JSON.parse(metadataText);
    assert.equal(metadata.version, sourceVersion.version, "release.json version must match version.json.");
    assert.equal(metadata.buildStamp, version.buildStamp, "release.json buildStamp must match the verified release build stamp.");
    assert.equal(metadata.gitCommit, readExpectedGitCommit(), "release.json must record the exact pre-build Git commit.");
    assert.ok(["clean", "unchecked"].includes(metadata.gitTreeState), "release.json must record the pre-build Git tree state.");
    verifyReleaseProvenance(metadata);
    assert.equal(metadata.hmacKeyFingerprint, fingerprint, "release.json must include the selected HMAC fingerprint.");
    assert.equal(metadataText.includes(hmacKeyHex), false, "release.json must not contain the full HMAC key.");
    assert.equal(metadata.deployment?.pwaBase, "./", "release.json must record the relocatable PWA base.");
    assert.equal(metadata.deployment?.scoreApiUrl, "/api/ms-pac-man-2010/scores", "release.json must record the fixed score API path.");
    if (metadata.pwa !== null) {
        assert.equal(metadata.pwa.serviceWorkerVersion, cacheIdentity, "release.json must record the embedded PWA service-worker version.");
    }
}

function verifyJarReleasePropertiesFromBuffer(jar, description) {
    const jarEntries = readZipEntriesFromBuffer(jar);
    const propertiesText = readRequiredZipEntryData(jar, jarEntries, "mspacman/high-score-release.properties").toString("utf8");
    const properties = readJavaProperties(propertiesText);
    assert.equal(properties.hmacKeyHex, hmacKeyHex, `${description} must embed the selected HMAC key.`);
    assert.equal(properties.hmacKeyFingerprint, fingerprint, `${description} must embed the selected HMAC fingerprint.`);
    assert.equal(properties.buildStamp, version.buildStamp, `${description} must embed the current build stamp.`);
}

function verifyDistDoesNotContainLocalReleaseState() {
    if (!existsSync(distDir)) {
        return;
    }
    for (const path of listFiles(distDir)) {
        const relativePath = relative(distDir, path).replaceAll("\\", "/");
        assert.equal(isLocalReleaseStateRelativePath(relativePath), false, "Local release-state paths must not be copied into dist.");
    }
}

function verifyReleaseChecksumManifest() {
    const checksumManifestPath = join(distDir, "checksums.sha256");
    assert.ok(existsSync(checksumManifestPath), "Release output must include dist/checksums.sha256.");

    const expected = new Map();
    for (const path of listFiles(distDir)) {
        const relativePath = relative(distDir, path).replaceAll("\\", "/");
        if (relativePath !== "checksums.sha256") {
            expected.set(relativePath, sha256File(path));
        }
    }

    const actual = new Map();
    for (const line of readFileSync(checksumManifestPath, "utf8").split(/\r?\n/)) {
        if (line === "") {
            continue;
        }
        const match = /^([0-9a-f]{64})[ ]{2}(.+)$/.exec(line);
        assert.ok(match !== null && match[1] !== undefined && match[2] !== undefined, `Malformed checksum manifest line: ${line}`);
        assert.equal(actual.has(match[2]), false, `Duplicate checksum manifest entry: ${match[2]}`);
        actual.set(match[2], match[1]);
    }

    assert.deepEqual(
        [...actual.keys()].sort((a, b) => a.localeCompare(b)),
        [...expected.keys()].sort((a, b) => a.localeCompare(b))
    );
    for (const [path, hash] of expected) {
        assert.equal(actual.get(path), hash, `Checksum mismatch for ${path}.`);
    }
}

function sha256File(path) {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sha256Buffer(buffer) {
    return createHash("sha256").update(buffer).digest("hex");
}

function verifyGeneratedRuntimeDoesNotContainHardcodedDeploymentRoots(root) {
    if (!existsSync(root)) {
        return;
    }
    for (const path of listFiles(root)) {
        const relativePath = relative(root, path).replaceAll("\\", "/");
        if (!shouldScanRuntimeTextFile(path)) {
            continue;
        }
        const content = readFileSync(path, "utf8").replaceAll("/api/ms-pac-man-2010/", "");
        const scannedContent = root === distDir && relativePath === "index.html" ? content.replaceAll("https://meatfighter.com/mspacman2010/", "") : content;
        for (const { label, pattern } of forbiddenDeploymentRootPatterns) {
            const match = pattern.exec(scannedContent);
            assert.equal(match, null, `Generated runtime file contains hard-coded deployment root ${label}: ${relative(rootDir, path)}`);
        }
    }
}

function shouldScanRuntimeTextFile(path) {
    const dot = path.lastIndexOf(".");
    return dot >= 0 && runtimeTextExtensions.has(path.slice(dot).toLowerCase());
}

async function verifyTrackedSourceDoesNotContainSelectedKey() {
    if (hmacKeyHex === SYNTHETIC_RELEASE_HMAC_KEY_HEX) {
        return;
    }
    await assertSecretAbsentFromTrackedFiles(hmacKeyHex);
}

function readVerificationVersion(sourceVersion, metadata) {
    if (metadata === null) {
        return sourceVersion;
    }
    assert.equal(metadata.version, sourceVersion.version, "release.json version must match source version.");
    assert.equal(typeof metadata.buildStamp, "string", "release.json buildStamp must be a string.");
    return {
        ...sourceVersion,
        buildStamp: metadata.buildStamp
    };
}

function readReleaseMetadataIfAvailable() {
    const releaseMetadataPath = join(distDir, "release.json");
    if (!existsSync(releaseMetadataPath)) {
        return null;
    }
    return JSON.parse(readFileSync(releaseMetadataPath, "utf8"));
}

function readExpectedGitCommit() {
    const expected = process.env.MSPACMAN_RELEASE_GIT_COMMIT;
    if (expected !== undefined && expected !== "") {
        return expected;
    }
    assert.ok(releaseMetadata !== null, "Release metadata is required to infer the expected Git commit.");
    return releaseMetadata.gitCommit;
}

function verifyReleaseProvenance(metadata) {
    assertReleaseProvenance(metadata, {
        expectedHmacKeySource,
        expectedReleaseKind
    });
}

function readZipEntriesFromBuffer(archive) {
    const endOffset = findEndOfCentralDirectory(archive);
    const entryCount = archive.readUInt16LE(endOffset + 10);
    let offset = archive.readUInt32LE(endOffset + 16);
    const entries = [];
    for (let i = 0; i < entryCount; i++) {
        assert.equal(archive.readUInt32LE(offset), 0x02014b50, "Malformed ZIP central directory.");
        const compressionMethod = archive.readUInt16LE(offset + 10);
        const compressedSize = archive.readUInt32LE(offset + 20);
        const uncompressedSize = archive.readUInt32LE(offset + 24);
        const nameLength = archive.readUInt16LE(offset + 28);
        const extraLength = archive.readUInt16LE(offset + 30);
        const commentLength = archive.readUInt16LE(offset + 32);
        const localHeaderOffset = archive.readUInt32LE(offset + 42);
        const name = archive.toString("utf8", offset + 46, offset + 46 + nameLength);
        entries.push({
            compressedSize,
            compressionMethod,
            externalFileAttributes: archive.readUInt32LE(offset + 38),
            localHeaderOffset,
            name,
            uncompressedSize
        });
        offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}

function readZipEntryData(archive, entry) {
    const offset = entry.localHeaderOffset;
    assert.equal(archive.readUInt32LE(offset), 0x04034b50, "Malformed ZIP local file header.");
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + nameLength + extraLength;
    const data = archive.subarray(dataStart, dataStart + entry.compressedSize);
    switch (entry.compressionMethod) {
        case 0:
            assert.equal(data.length, entry.uncompressedSize, `Stored ZIP entry has an unexpected size: ${entry.name}`);
            return data;
        case 8:
            return inflateRawSync(data);
        default:
            throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod} for ${entry.name}.`);
    }
}

function readRequiredZipEntryData(archive, entries, name) {
    const entry = entries.find((candidate) => candidate.name === name);
    assert.ok(entry !== undefined, `ZIP archive is missing ${name}.`);
    return readZipEntryData(archive, entry);
}

function verifyZipEntryMode(entries, name, expectedMode) {
    const entry = entries.find((candidate) => candidate.name === name);
    assert.ok(entry !== undefined, `ZIP archive is missing ${name}.`);
    const actualMode = (entry.externalFileAttributes >>> 16) & 0o777;
    assert.equal(actualMode, expectedMode, `${name} must have ZIP Unix mode ${expectedMode.toString(8)}.`);
}

function isLocalReleaseStateRelativePath(path) {
    return (
        path === ".release-secrets" ||
        path.startsWith(".release-secrets/") ||
        path === ".release-candidates" ||
        path.startsWith(".release-candidates/") ||
        path === ".release-components" ||
        path.startsWith(".release-components/") ||
        path.startsWith(".dist-pending-") ||
        path.startsWith(".dist-previous-") ||
        path.startsWith(".dist-active-before-hmac-finalize-")
    );
}

function findEndOfCentralDirectory(archive) {
    const minimumOffset = Math.max(0, archive.length - 65557);
    for (let offset = archive.length - 22; offset >= minimumOffset; offset--) {
        if (archive.readUInt32LE(offset) === 0x06054b50) {
            return offset;
        }
    }
    throw new Error("Could not find ZIP end-of-central-directory record.");
}

function readJavaProperties(text) {
    const properties = {};
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith("#")) {
            continue;
        }
        const equals = trimmed.indexOf("=");
        assert.ok(equals > 0, `Malformed Java properties line: ${trimmed}`);
        properties[trimmed.slice(0, equals)] = trimmed.slice(equals + 1);
    }
    return properties;
}

function listFiles(dir) {
    return listFilesStrict(dir, "Release verification input");
}

function runNpmScript(scriptName) {
    const result =
        process.platform === "win32"
            ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `${npmCommand} run ${scriptName}`], {
                  cwd: rootDir,
                  env: verifierEnv,
                  stdio: "inherit",
                  windowsHide: true
              })
            : spawnSync(npmCommand, ["run", scriptName], {
                  cwd: rootDir,
                  env: verifierEnv,
                  stdio: "inherit",
                  windowsHide: true
              });
    if (result.status !== 0 || result.error) {
        throw result.error ?? new Error(`npm run ${scriptName} failed.`);
    }
}

function readOption(name, fallback) {
    const prefix = `--${name}=`;
    const match = process.argv.find((arg) => arg.startsWith(prefix));
    return match === undefined ? fallback : match.slice(prefix.length);
}
