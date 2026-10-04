// Test-only Node ESM loader. It preserves native module cycles and uses the
// project's actual field-initialization semantics. Browser fuzzing does not use it.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";
import ts from "typescript";
const config = JSON.parse(readFileSync(resolvePath("pwa/tsconfig.json"), "utf8"));
export async function resolve(specifier, context, next) {
    if (context.parentURL?.startsWith("file:") && specifier.startsWith(".")) {
        const path = fileURLToPath(new URL(specifier, context.parentURL));
        if (path.endsWith(".js") && existsSync(path.slice(0, -3) + ".ts")) return { url: pathToFileURL(path.slice(0, -3) + ".ts").href, shortCircuit: true };
        if (!existsSync(path) && existsSync(path + ".ts")) return { url: pathToFileURL(path + ".ts").href, shortCircuit: true };
    }
    return next(specifier, context);
}
export async function load(url, context, next) {
    if (url.endsWith(".ts")) {
        const source = readFileSync(fileURLToPath(url), "utf8");
        let output = ts.transpileModule(source, {
            compilerOptions: {
                target: ts.ScriptTarget.ES2022,
                module: ts.ModuleKind.ESNext,
                useDefineForClassFields: config.compilerOptions?.useDefineForClassFields ?? true
            }
        }).outputText;
        output = output.replaceAll("import.meta.env.BASE_URL", JSON.stringify("/"));
        return { format: "module", source: output, shortCircuit: true };
    }
    return next(url, context);
}
