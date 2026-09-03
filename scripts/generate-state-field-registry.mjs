import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";
import ts from "typescript";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceDir = join(rootDir, "pwa", "src", "mspacman");
const policyPath = join(sourceDir, "persistence", "StateFieldPolicy.ts");
const registryPath = join(sourceDir, "persistence", "StateFieldRegistry.generated.ts");
const checkOnly = process.argv.includes("--check");

function collectTypeScriptFiles(directory) {
    const files = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectTypeScriptFiles(file));
        } else if (entry.isFile() && entry.name.endsWith(".ts") && file !== registryPath) {
            files.push(file);
        }
    }
    return files;
}

function hasModifier(node, kind) {
    return node.modifiers?.some((modifier) => modifier.kind === kind) === true;
}

function propertyNameText(name) {
    return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : null;
}

function baseClassName(node) {
    const clause = node.heritageClauses?.find((item) => item.token === ts.SyntaxKind.ExtendsKeyword);
    const expression = clause?.types[0]?.expression;
    if (!expression) {
        return null;
    }
    if (ts.isIdentifier(expression)) {
        return expression.text;
    }
    if (ts.isPropertyAccessExpression(expression)) {
        return expression.name.text;
    }
    return null;
}

function collectDeclaredInstanceFields(node) {
    const fields = [];
    const seen = new Set();
    const add = (name) => {
        if (name !== null && !seen.has(name)) {
            seen.add(name);
            fields.push(name);
        }
    };
    for (const member of node.members) {
        if (ts.isPropertyDeclaration(member) && !hasModifier(member, ts.SyntaxKind.StaticKeyword)) {
            add(propertyNameText(member.name));
            continue;
        }
        if (!ts.isConstructorDeclaration(member)) {
            continue;
        }
        for (const parameter of member.parameters) {
            const parameterProperty =
                hasModifier(parameter, ts.SyntaxKind.PublicKeyword) ||
                hasModifier(parameter, ts.SyntaxKind.PrivateKeyword) ||
                hasModifier(parameter, ts.SyntaxKind.ProtectedKeyword) ||
                hasModifier(parameter, ts.SyntaxKind.ReadonlyKeyword);
            if (parameterProperty) {
                add(propertyNameText(parameter.name));
            }
        }
    }
    return fields;
}

function collectClasses() {
    const classes = new Map();
    for (const file of collectTypeScriptFiles(sourceDir)) {
        const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        for (const statement of source.statements) {
            if (!ts.isClassDeclaration(statement) || statement.name === undefined) {
                continue;
            }
            const name = statement.name.text;
            if (classes.has(name)) {
                throw new Error(`Duplicate TypeScript class name: ${name}`);
            }
            classes.set(name, {
                name,
                base: baseClassName(statement),
                fields: collectDeclaredInstanceFields(statement),
                path: file
            });
        }
    }
    return classes;
}

function inheritedFields(classes, name) {
    const result = [];
    const seen = new Set();
    const visiting = new Set();
    const visit = (className) => {
        if (visiting.has(className)) {
            throw new Error(`Inheritance cycle while collecting state fields: ${className}`);
        }
        const info = classes.get(className);
        if (!info) {
            return;
        }
        visiting.add(className);
        if (info.base && classes.has(info.base)) {
            visit(info.base);
        }
        for (const field of info.fields) {
            if (seen.has(field)) {
                throw new Error(`TypeScript field hiding is not allowed in state-bearing classes: ${className}.${field}`);
            }
            seen.add(field);
            result.push(field);
        }
        visiting.delete(className);
    };
    visit(name);
    return result;
}

function unwrap(expression) {
    let current = expression;
    while (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isParenthesizedExpression(current) || ts.isTypeAssertionExpression(current)) {
        current = current.expression;
    }
    return current;
}

function stringArray(expression, label) {
    const value = unwrap(expression);
    if (!ts.isArrayLiteralExpression(value)) {
        throw new Error(`${label} must be an array literal.`);
    }
    return value.elements.map((element) => {
        if (!ts.isStringLiteral(element)) {
            throw new Error(`${label} must contain only string literals.`);
        }
        return element.text;
    });
}

function readPolicy() {
    const source = ts.createSourceFile(policyPath, readFileSync(policyPath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const statement of source.statements) {
        if (!ts.isVariableStatement(statement)) {
            continue;
        }
        for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "STATE_FIELD_POLICY" || declaration.initializer === undefined) {
                continue;
            }
            const initializer = unwrap(declaration.initializer);
            if (!ts.isObjectLiteralExpression(initializer)) {
                throw new Error("STATE_FIELD_POLICY must remain an object literal.");
            }
            const policy = new Map();
            for (const property of initializer.properties) {
                if (!ts.isPropertyAssignment(property)) {
                    throw new Error("STATE_FIELD_POLICY entries must be explicit property assignments.");
                }
                const className = propertyNameText(property.name);
                const entry = unwrap(property.initializer);
                if (className === null || !ts.isObjectLiteralExpression(entry)) {
                    throw new Error("STATE_FIELD_POLICY contains an invalid class entry.");
                }
                let persisted = null;
                let runtime = null;
                for (const field of entry.properties) {
                    if (!ts.isPropertyAssignment(field)) {
                        continue;
                    }
                    const name = propertyNameText(field.name);
                    if (name === "persisted") {
                        persisted = stringArray(field.initializer, `${className}.persisted`);
                    } else if (name === "runtime") {
                        runtime = stringArray(field.initializer, `${className}.runtime`);
                    }
                }
                if (persisted === null || runtime === null) {
                    throw new Error(`STATE_FIELD_POLICY.${className} must declare persisted and runtime arrays.`);
                }
                policy.set(className, { persisted, runtime });
            }
            return policy;
        }
    }
    throw new Error("Unable to find STATE_FIELD_POLICY.");
}

const classes = collectClasses();
const policy = readPolicy();
const registry = {};
for (const [className, classification] of policy.entries()) {
    if (!classes.has(className)) {
        throw new Error(`STATE_FIELD_POLICY refers to missing TypeScript class ${className}.`);
    }
    const all = inheritedFields(classes, className);
    const persisted = classification.persisted;
    const runtime = classification.runtime;
    const overlap = persisted.filter((field) => runtime.includes(field));
    if (overlap.length > 0) {
        throw new Error(`${className} state policy classifies fields twice: ${overlap.join(", ")}`);
    }
    const classified = new Set([...persisted, ...runtime]);
    const missing = all.filter((field) => !classified.has(field));
    const stale = [...classified].filter((field) => !all.includes(field));
    if (missing.length > 0) {
        throw new Error(`${className} has unclassified state fields: ${missing.join(", ")}. Review persistence semantics before changing the save schema.`);
    }
    if (stale.length > 0) {
        throw new Error(`${className} state policy contains stale fields: ${stale.join(", ")}.`);
    }
    registry[className] = { all, persisted, runtime };
}

const raw = `// Generated by scripts/generate-state-field-registry.mjs. Do not edit by hand.\n\nexport const STATE_FIELD_REGISTRY = ${JSON.stringify(registry, null, 4)} as const;\n`;
const prettierConfig = (await prettier.resolveConfig(registryPath)) ?? {};
const generated = await prettier.format(raw, { ...prettierConfig, parser: "typescript" });
if (checkOnly) {
    if (!existsSync(registryPath) || readFileSync(registryPath, "utf8") !== generated) {
        throw new Error(`${relative(rootDir, registryPath)} is stale. Run npm run generate:state-fields and review the save-schema change.`);
    }
    console.log("State-field registry and explicit classifications are current.");
} else {
    writeFileSync(registryPath, generated);
    console.log(`Updated ${relative(rootDir, registryPath)}.`);
}
