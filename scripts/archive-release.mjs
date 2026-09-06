import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";

// Archive an already verified build. This command neither deploys nor creates tags.
const root = realpathSync(process.cwd());
const build = resolve(process.argv[2] ?? "dist");
const requestedOutput = process.argv[3];
if (!requestedOutput || !isAbsolute(requestedOutput))
    throw new Error("Usage: node scripts/archive-release.mjs <build-directory> <absolute-output-directory-outside-repository>");
const output = resolve(requestedOutput);
if (output === root || output.startsWith(root + sep)) throw new Error("Archive output must be outside the repository.");
if (!existsSync(build) || !lstatSync(build).isDirectory() || !realpathSync(build).startsWith(root + sep))
    throw new Error("Build must be an existing directory inside this repository.");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
if (git("status", "--porcelain") !== "") throw new Error("Archive requires a clean source checkout.");
const commit = git("rev-parse", "HEAD");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const archiveName = `${pkg.name}-${commit}.tar.gz`;
mkdirSync(output, { recursive: true });
const realOutput = realpathSync(output);
if (realOutput === root || realOutput.startsWith(root + sep)) {
    throw new Error("Archive output resolves inside the repository.");
}
if (readdirSync(output).length !== 0) {
    throw new Error("Archive output directory must be empty.");
}
if (existsSync(join(output, archiveName))) throw new Error("An archive for this commit already exists; preserve it instead of overwriting it.");
const staging = mkdtempSync(join(tmpdir(), "verified-release-"));
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
function walk(directory) {
    const files = [];
    for (const name of readdirSync(directory).sort()) {
        const path = join(directory, name);
        const stat = lstatSync(path);
        if (stat.isSymbolicLink()) throw new Error(`Release artifacts cannot contain symlinks: ${path}`);
        if (stat.isDirectory()) files.push(...walk(path));
        else if (stat.isFile()) files.push(path);
        else throw new Error(`Unsupported artifact: ${path}`);
    }
    return files;
}
try {
    walk(build); // Validate before recursively copying.
    cpSync(build, join(staging, "dist"), { recursive: true });
    for (const name of ["package.json", "package-lock.json", "LICENSE", "NOTICE.md", "README.md", "OPERATIONS.md", "RELEASING.md", "deploy"]) {
        const source = join(root, name);
        if (existsSync(source)) cpSync(source, join(staging, name), { recursive: true });
    }
    const manifest = {
        repository: pkg.repository?.url ?? pkg.name,
        packageVersion: pkg.version,
        commit,
        sourceTree: git("rev-parse", "HEAD^{tree}"),
        node: process.version,
        buildDirectory: relative(root, build).split(sep).join("/"),
        artifactKind: relative(root, build).includes("synthetic") ? "synthetic-test-not-for-deployment" : "release-candidate",
        files: walk(staging).map((path) => ({ path: relative(staging, path).split(sep).join("/"), sha256: hash(path) }))
    };
    writeFileSync(join(staging, "RELEASE.json"), JSON.stringify(manifest, null, 2) + "\n");
    execFileSync("tar", ["-czf", join(output, archiveName), "-C", staging, "."], { stdio: "inherit" });
    writeFileSync(join(output, "SHA256SUMS"), `${hash(join(output, archiveName))}  ${basename(archiveName)}\n`, { flag: "wx" });
    cpSync(join(staging, "RELEASE.json"), join(output, "RELEASE.json"), { errorOnExist: true, force: false });
    console.log(`Archived ${pkg.name} at ${commit}; no deployment or tag was created.`);
} finally {
    rmSync(staging, { recursive: true, force: true });
}
