import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, extname, relative } from "node:path";
import ts from "typescript";

export async function loadTypeScript(entry, mocks = {}) {
    const root = resolve(".");
    const cache = new Map();
    const pending = new Set();
    function compile(path) {
        path = resolve(path);
        if (cache.has(path)) return cache.get(path);
        if (pending.has(path)) throw new Error(`Unexpected test-loader cycle: ${path}`);
        pending.add(path);
        const key = relative(root, path).replaceAll("\\", "/");
        const input = Object.hasOwn(mocks, key) ? mocks[key] : readFileSync(path, "utf8");
        let output = ts.transpileModule(input, {
            compilerOptions: {
                target: ts.ScriptTarget.ES2022,
                module: ts.ModuleKind.ESNext
            }
        }).outputText;
        const parsed = ts.createSourceFile(path + ".js", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
        const edits = [];
        for (const statement of parsed.statements) {
            if ((!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) || !statement.moduleSpecifier) continue;
            const node = statement.moduleSpecifier;
            if (!ts.isStringLiteral(node)) continue;
            let url;
            if (node.text.startsWith(".")) {
                let dependency = resolve(dirname(path), node.text);
                if (dependency.endsWith(".js") && existsSync(dependency.slice(0, -3) + ".ts")) dependency = dependency.slice(0, -3) + ".ts";
                else if (!extname(dependency)) dependency += ".ts";
                url = compile(dependency);
            } else url = import.meta.resolve(node.text);
            edits.push([node.getStart(parsed), node.end, JSON.stringify(url)]);
        }
        for (const [start, end, value] of edits.sort((a, b) => b[0] - a[0])) output = output.slice(0, start) + value + output.slice(end);
        const url = "data:text/javascript;base64," + Buffer.from(output).toString("base64");
        cache.set(path, url);
        pending.delete(path);
        return url;
    }
    return import(compile(resolve(entry)));
}

export function sourceMember(path, name, owner = null) {
    const text = readFileSync(path, "utf8");
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const found = [];
    function visit(node) {
        if (owner && ts.isClassDeclaration(node) && node.name?.text === owner) {
            for (const member of node.members) if (member.name?.getText(source) === name && member.body) found.push(member);
            return;
        }
        if (!owner && ts.isFunctionDeclaration(node) && node.name?.text === name && node.body) found.push(node);
        ts.forEachChild(node, visit);
    }
    visit(source);
    if (found.length !== 1) throw new Error(`Expected one ${owner ? owner + "." : ""}${name} in ${path}, got ${found.length}`);
    return found[0].getText(source);
}

/** Execute actual shell methods against a controlled environment. This is a
 * focused control-flow test, not a substitute for browser qualification. */
export function shellSubject(path, names, env, owner = null) {
    const fragments = names.map((name) => sourceMember(path, name, owner)).join("\n");
    const code = owner ? `class Subject { ${fragments} }` : fragments;
    const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    const result = owner
        ? `Object.assign(new Subject(), Object.fromEntries(Object.entries(env).filter(([key]) => !${JSON.stringify(names)}.includes(key))))`
        : `{${names.join(",")}}`;
    return new Function("env", `with (env) { ${js}\nreturn ${result}; }`)(env);
}

export function memoryStorage() {
    const values = new Map();
    const calls = { get: [], set: [], remove: [] };
    const faults = { get: false, set: false, remove: false, removeKeys: new Set() };
    return {
        values,
        calls,
        faults,
        clearCalls() {
            for (const list of Object.values(calls)) list.length = 0;
        },
        getItem(key) {
            calls.get.push(key);
            if (faults.get) throw new Error("injected read failure");
            return values.get(key) ?? null;
        },
        setItem(key, value) {
            calls.set.push(key);
            if (faults.set) throw new Error("injected write failure");
            values.set(key, String(value));
        },
        removeItem(key) {
            calls.remove.push(key);
            if (faults.remove || faults.removeKeys.has(key)) throw new Error("injected remove failure");
            values.delete(key);
        }
    };
}
