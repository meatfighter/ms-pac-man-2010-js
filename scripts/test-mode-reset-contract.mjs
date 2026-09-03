import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";

const rootDir = resolve(".");
const sourceDir = join(rootDir, "pwa", "src", "mspacman");
const modeClasses = [
    "Act1Mode",
    "Act2Mode",
    "Act3Mode",
    "Act4Mode",
    "Act5Mode",
    "Act6Mode",
    "Act7Mode",
    "AttractMode",
    "EndingMode",
    "EnterInitialsMode",
    "HallOfFameMode",
    "IntroMode",
    "PlayingMode",
    "SelectWorldMode"
];

function fieldNameFromThis(expression) {
    if (!ts.isPropertyAccessExpression(expression) || !ts.isThis(expression.expression)) {
        return null;
    }
    return expression.name.text;
}

function collectWrites(node, fields) {
    const visit = (child) => {
        if (
            ts.isBinaryExpression(child) &&
            child.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
            child.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        ) {
            const name = fieldNameFromThis(child.left);
            if (name !== null) {
                fields.add(name);
            }
        } else if (ts.isPrefixUnaryExpression(child) || ts.isPostfixUnaryExpression(child)) {
            if (child.operator === ts.SyntaxKind.PlusPlusToken || child.operator === ts.SyntaxKind.MinusMinusToken) {
                const name = fieldNameFromThis(child.operand);
                if (name !== null) {
                    fields.add(name);
                }
            }
        } else if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression)) {
            const owner = child.expression.expression;
            const method = child.expression.name.text;
            const name = fieldNameFromThis(owner);
            if (name !== null && ["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin"].includes(method)) {
                fields.add(name);
            }
        }
        ts.forEachChild(child, visit);
    };
    visit(node);
}

function collectPlainAssignments(node, fields) {
    const visit = (child) => {
        if (ts.isBinaryExpression(child) && child.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
            const name = fieldNameFromThis(child.left);
            if (name !== null) {
                fields.add(name);
            }
        }
        ts.forEachChild(child, visit);
    };
    visit(node);
}

function collectDeterministicFirstUpdateAssignments(updateMethod) {
    const fields = new Set();
    if (!updateMethod?.body) {
        return fields;
    }
    for (const statement of updateMethod.body.statements) {
        if (
            !ts.isExpressionStatement(statement) ||
            !ts.isBinaryExpression(statement.expression) ||
            statement.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken
        ) {
            break;
        }
        const name = fieldNameFromThis(statement.expression.left);
        if (name === null) {
            break;
        }
        fields.add(name);
    }
    return fields;
}

function methodName(member) {
    return ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name) ? member.name.text : null;
}

function directlyCalledThisMethods(node) {
    const names = new Set();
    const visit = (child) => {
        if (
            ts.isCallExpression(child) &&
            ts.isPropertyAccessExpression(child.expression) &&
            ts.isThis(child.expression.expression) &&
            child.arguments.length === 0
        ) {
            names.add(child.expression.name.text);
        }
        ts.forEachChild(child, visit);
    };
    visit(node);
    return names;
}

function collectInitializationHelperAssignments(declaration, initMethod) {
    const fields = new Set();
    for (const member of declaration.members) {
        const name = methodName(member);
        if (name !== null && name !== "init" && name.startsWith("init") && member.body) {
            collectPlainAssignments(member.body, fields);
        }
    }

    // PlayingMode follows the original Java shape: init() delegates its full
    // gameplay-state reset to reset(). Treat zero-argument helpers called
    // directly by init() as initialization helpers as well.
    const calledFromInit = directlyCalledThisMethods(initMethod.body);
    for (const member of declaration.members) {
        const name = methodName(member);
        if (name !== null && calledFromInit.has(name) && member.body) {
            collectPlainAssignments(member.body, fields);
        }
    }
    return fields;
}

for (const className of modeClasses) {
    const path = join(sourceDir, `${className}.ts`);
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const declaration = source.statements.find((statement) => ts.isClassDeclaration(statement) && statement.name?.text === className);
    assert.ok(declaration && ts.isClassDeclaration(declaration), `Unable to find ${className}.`);
    const initMethod = declaration.members.find((member) => methodName(member) === "init");
    const updateMethod = declaration.members.find((member) => methodName(member) === "update");
    assert.ok(initMethod && ts.isMethodDeclaration(initMethod) && initMethod.body, `${className} must define init().`);
    assert.ok(updateMethod && ts.isMethodDeclaration(updateMethod) && updateMethod.body, `${className} must define update().`);

    const resetWrites = new Set();
    collectWrites(initMethod.body, resetWrites);
    for (const field of collectDeterministicFirstUpdateAssignments(updateMethod)) {
        resetWrites.add(field);
    }
    for (const field of collectInitializationHelperAssignments(declaration, initMethod)) {
        resetWrites.add(field);
    }

    const mutableOutsideInit = new Set();
    for (const member of declaration.members) {
        if (member === initMethod) {
            continue;
        }
        collectWrites(member, mutableOutsideInit);
    }
    mutableOutsideInit.delete("main");

    const missing = [...mutableOutsideInit].filter((field) => !resetWrites.has(field)).sort();
    assert.deepEqual(missing, [], `${className} has mutable singleton fields with no deterministic initialization path: ${missing.join(", ")}`);
}

console.log("All static mode singletons reset mutable fields through init(), deterministic first update, or explicit initialization helpers.");
