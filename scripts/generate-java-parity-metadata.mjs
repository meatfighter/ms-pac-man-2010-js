import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const javaDir = join(rootDir, "desktop", "src", "mspacman");
const tsDir = join(rootDir, "pwa", "src", "mspacman");
const outputPath = join(rootDir, "scripts", "generated", "java-parity-metadata.json");
const checkOnly = process.argv.includes("--check");

function classInfo(source, file) {
    const declaration = /\b(?:public\s+)?(?:final\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/.exec(source);
    if (!declaration) {
        return null;
    }
    const className = declaration[1];
    const baseClass = declaration[2] ?? null;
    const fields = [];
    const fieldPattern = /^\s*(?:public|protected|private)\s+(?!static\b)(?:final\s+)?([^\s=;]+)\s+(\w+)\s*(?:[;=])/gm;
    for (const match of source.matchAll(fieldPattern)) {
        fields.push({ type: match[1], name: match[2] });
    }
    const publicMethods = [];
    const methodPattern = /^\s*(?:public|protected)\s+(?!static\b)(?:final\s+)?\S+\s+(\w+)\s*\(/gm;
    for (const match of source.matchAll(methodPattern)) {
        if (match[1] !== className && !publicMethods.includes(match[1])) {
            publicMethods.push(match[1]);
        }
    }
    return {
        file,
        className,
        baseClass,
        fields: fields.sort((a, b) => a.name.localeCompare(b.name)),
        floatFields: fields
            .filter((field) => field.type === "float")
            .map((field) => field.name)
            .sort(),
        publicMethods: publicMethods.sort()
    };
}

const classes = [];
for (const file of readdirSync(javaDir)
    .filter((name) => name.endsWith(".java"))
    .sort()) {
    const info = classInfo(readFileSync(join(javaDir, file), "utf8"), file);
    if (info === null) {
        continue;
    }
    const tsPath = join(tsDir, `${info.className}.ts`);
    if (!existsSync(tsPath)) {
        continue;
    }
    classes.push(info);
}
classes.sort((a, b) => a.className.localeCompare(b.className));

const rawOutput = `${JSON.stringify({ version: 1, classes }, null, 4)}\n`;
const prettierConfig = (await prettier.resolveConfig(outputPath)) ?? {};
const output = await prettier.format(rawOutput, { ...prettierConfig, parser: "json" });
mkdirSync(dirname(outputPath), { recursive: true });
if (checkOnly) {
    if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== output) {
        throw new Error(`${relative(rootDir, outputPath)} is stale. Run npm run generate:java-parity-metadata.`);
    }
    console.log("Java parity metadata is current.");
} else {
    writeFileSync(outputPath, output);
    console.log(`Updated ${relative(rootDir, outputPath)}.`);
}
