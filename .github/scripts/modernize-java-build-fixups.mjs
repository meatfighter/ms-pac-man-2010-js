import { readFileSync, writeFileSync } from "node:fs";

function read(path) {
    return readFileSync(path, "utf8");
}

function write(path, content) {
    writeFileSync(path, content, "utf8");
}

const buildUtilsPath = "scripts/build-utils.mjs";
let buildUtils = read(buildUtilsPath);
const pomPathLine = 'export const desktopPomPath = join(rootDir, "desktop", "pom.xml");\n';
if (!buildUtils.includes(pomPathLine)) {
    throw new Error("Expected desktop POM path in release version preflight.");
}
buildUtils = buildUtils.replace(pomPathLine, "");

const pomReaderPattern = /\nexport function readDesktopPomVersion\(\) \{[\s\S]*?\n\}\n/;
if (!pomReaderPattern.test(buildUtils)) {
    throw new Error("Expected desktop POM version reader.");
}
buildUtils = buildUtils.replace(pomReaderPattern, "\n");

const versionCheckPattern = /export function assertProjectVersionsMatch\(\) \{[\s\S]*?\n\}\n\nexport function writeVersion/;
if (!versionCheckPattern.test(buildUtils)) {
    throw new Error("Expected project version preflight.");
}
buildUtils = buildUtils.replace(
    versionCheckPattern,
    `export function assertProjectVersionsMatch() {\n    const packageVersion = readPackageJson().version;\n    const versionJsonVersion = readVersion().version;\n    if (packageVersion !== versionJsonVersion) {\n        throw new Error(\n            [\"Release versions must match before building.\", \`package.json: \${packageVersion}\`, \`version.json: \${versionJsonVersion}\`].join(\"\\n\")\n        );\n    }\n}\n\nexport function writeVersion`
);
if (/desktopPomPath|readDesktopPomVersion|desktop\/pom\.xml/.test(buildUtils)) {
    throw new Error("Obsolete desktop POM coupling remains in build-utils.mjs.");
}
write(buildUtilsPath, buildUtils);

const releaseTestPath = "scripts/test-pwa-release-scripts.mjs";
let releaseTest = read(releaseTestPath);
const oldMessage = "Release builds must fail when package.json, version.json, and desktop/pom.xml versions do not match.";
if (!releaseTest.includes(oldMessage)) {
    throw new Error("Expected Maven-coupled version mismatch assertion.");
}
releaseTest = releaseTest.replace(oldMessage, "Release builds must fail when package.json and version.json versions do not match.");
write(releaseTestPath, releaseTest);
