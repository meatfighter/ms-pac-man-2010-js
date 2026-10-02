import assert from "node:assert/strict";
import { readdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, delimiter, sep } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("actual Java ghost-house classes preserve entry, bookkeeping and rendering", () => {
    const root = resolve("."),
        directory = mkdtempSync(join(tmpdir(), "pac-house-"));
    assert(directory.startsWith(resolve(tmpdir()) + sep));
    try {
        const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
        const jars = walk(join(root, "desktop/lib")).filter((p) => p.endsWith(".jar"));
        const sources = [
            ...walk(join(root, "desktop/src/mspacman")).filter((p) => p.endsWith(".java")),
            join(root, "desktop/test/mspacman/GhostHouseReturnTest.java")
        ];
        const list = join(directory, "sources.txt");
        writeFileSync(list, sources.map((p) => '"' + p.replaceAll("\\", "/") + '"').join("\n"));
        for (const [command, args] of [
            ["javac", ["-encoding", "UTF-8", "--release", "8", "-Xlint:-options", "-cp", jars.join(delimiter), "-d", directory, "@" + list]],
            ["java", ["-Djava.awt.headless=true", "-cp", [directory, join(root, "pwa/public"), ...jars].join(delimiter), "mspacman.GhostHouseReturnTest"]]
        ]) {
            const r = spawnSync(command, args, { encoding: "utf8", timeout: 60000, windowsHide: true });
            assert.equal(r.status, 0, `${command}: ${r.error ?? ""}\n${r.stdout}\n${r.stderr}`);
        }
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
