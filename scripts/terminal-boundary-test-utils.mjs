import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";
import vm from "node:vm";
const root = new URL("../", import.meta.url);
export function methods(name, wanted, java = false) {
    const path = new URL(`${java ? "desktop" : "pwa"}/src/mspacman/${name}.${java ? "java" : "ts"}`, root);
    const source = readFileSync(path, "utf8");
    if (java)
        return wanted
            .map((name) => {
                const matches = [
                    ...source.matchAll(
                        new RegExp(`(?:public|private|protected)\\s+(?:static\\s+)?[\\w<>\\[\\]]+\\s+${name}\\([^)]*\\)\\s*(?:throws\\s+\\w+\\s*)?\\{`, "g")
                    )
                ];
                assert.ok(matches.length, `Missing Java ${name}`);
                return matches
                    .map((m) => {
                        let depth = 1,
                            end = m.index + m[0].length;
                        while (depth && end < source.length) {
                            const c = source[end++];
                            if (c === "{") depth++;
                            if (c === "}") depth--;
                        }
                        assert.equal(depth, 0);
                        return source.slice(m.index, end);
                    })
                    .join("\n");
            })
            .join("\n");
    const file = ts.createSourceFile(path.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const cls = file.statements.find((n) => ts.isClassDeclaration(n) && n.name?.text === name);
    assert.ok(cls);
    return wanted
        .map((name) => {
            const matches = cls.members.filter((n) => ts.isMethodDeclaration(n) && n.name.getText(file) === name && n.body);
            assert.equal(matches.length, 1, `${name} implementation`);
            return matches[0].getText(file);
        })
        .join("\n");
}
export function executeTs(source) {
    const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true });
    assert.equal((result.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
    return vm.runInNewContext(result.outputText, {}, { timeout: 1000 });
}
export function executeJava(source, className) {
    const directory = mkdtempSync(join(tmpdir(), "pac-terminal-"));
    try {
        const file = join(directory, `${className}.java`);
        writeFileSync(file, source);
        for (const [command, args] of [
            ["javac", ["-encoding", "UTF-8", "-d", directory, file]],
            ["java", ["-cp", directory, className]]
        ]) {
            const result = spawnSync(command, args, { encoding: "utf8", timeout: 60000 });
            assert.equal(result.status, 0, `${command}: ${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
        }
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}
