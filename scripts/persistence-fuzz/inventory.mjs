// Test-only inventory generator. This indexes actual contracts; it does not infer
// reachability or manufacture passing state from the validator's accepted values.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
const root = resolve("."),
    game = JSON.parse(readFileSync("package.json", "utf8")).name;
const prefix = game === "jackal-js" ? "jackal" : game === "stickvania-js" ? "stickvania" : "mspacman";
const directory = join(root, "pwa/src", prefix);
const load = (name) => import(pathToFileURL(join(directory, name + ".ts")).href);
const classes = new Map(),
    policies = [],
    allSources = [];
const externalAccesses = new Map();
function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
        const path = join(dir, name);
        if (name.endsWith(".ts")) allSources.push(path);
        else if (!name.includes(".")) {
            try {
                walk(path);
            } catch {
                /* Not a source directory. */
            }
        }
    }
}
walk(directory);
const program = ts.createProgram(allSources, {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true
});
const checker = program.getTypeChecker();
for (const file of allSources) {
    const source = program.getSourceFile(file);
    const visit = (node) => {
        if (ts.isPropertyAccessExpression(node) && node.expression.kind !== ts.SyntaxKind.ThisKeyword) {
            const type = checker.getTypeAtLocation(node.expression);
            const candidates = type.isUnion() ? type.types : [type];
            for (const candidate of candidates) {
                const symbol = candidate.getSymbol();
                const owner = symbol?.getName();
                if (!owner || !symbol?.declarations?.some(ts.isClassDeclaration)) continue;
                const parent = node.parent;
                const write =
                    ts.isBinaryExpression(parent) &&
                    parent.left === node &&
                    parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
                    parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
                const increment =
                    (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
                    [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(parent.operator);
                const key = `${owner}.${node.name.text}`;
                if (!externalAccesses.has(key)) externalAccesses.set(key, []);
                externalAccesses.get(key).push({
                    field: node.name.text,
                    role: write || increment ? "producer-write" : "consumer-or-read",
                    expression: parent.getText(source).slice(0, 240),
                    file: relative(root, file).replaceAll("\\", "/"),
                    line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
                });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
}
for (const file of allSources) {
    const text = readFileSync(file, "utf8"),
        source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const location = (node) => ({
        file: relative(root, file).replaceAll("\\", "/"),
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
    });
    for (const node of source.statements) {
        if (!ts.isClassDeclaration(node) || !node.name) continue;
        const declarations = [],
            accesses = [];
        for (const member of node.members) {
            if (ts.isPropertyDeclaration(member) && member.name && !member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)) {
                declarations.push({
                    field: member.name.getText(source),
                    declaredType: member.type?.getText(source) ?? null,
                    initializer: member.initializer?.getText(source) ?? null,
                    ...location(member)
                });
            }
        }
        const visit = (child) => {
            if (ts.isPropertyAccessExpression(child) && child.expression.kind === ts.SyntaxKind.ThisKeyword) {
                const parent = child.parent;
                const assignment =
                    ts.isBinaryExpression(parent) &&
                    parent.left === child &&
                    parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
                    parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
                const increment =
                    (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
                    [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(parent.operator);
                accesses.push({
                    field: child.name.text,
                    role: assignment || increment ? "producer-write" : "consumer-or-read",
                    expression: parent.getText(source).slice(0, 240),
                    ...location(child)
                });
            }
            ts.forEachChild(child, visit);
        };
        visit(node);
        const parent = node.heritageClauses?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0]?.expression.getText(source);
        classes.set(node.name.text, { parent, declarations, accesses });
    }
    if (file.replaceAll("\\", "/").includes("/persistence/")) {
        // These are literal source references, not a second executable validator.
        text.split("\n").forEach((line, index) => {
            if (
                /isIntegerInRange|isFiniteNumberInRange|Number\.isSafeInteger|isCountdownSnapshot|isReasonableNumber|is.*Snapshot|is.*Fields|is.*Valid/.test(
                    line
                )
            )
                policies.push({ file: relative(root, file).replaceAll("\\", "/"), line: index + 1, source: line.trim().slice(0, 500) });
        });
    }
}
function hierarchy(owner) {
    const result = [],
        seen = new Set();
    for (let name = owner; name && !seen.has(name); name = classes.get(name)?.parent) {
        seen.add(name);
        if (classes.has(name)) result.push(classes.get(name));
    }
    return result;
}
const rows = [];
function add(owner, field, descriptor = null, registry = "") {
    const types = hierarchy(owner);
    const declarations = types.flatMap((type) => type.declarations.filter((row) => row.field === field));
    const accesses = [...types.flatMap((type) => type.accesses.filter((row) => row.field === field)), ...(externalAccesses.get(`${owner}.${field}`) ?? [])];
    const declared = declarations[0]?.declaredType ?? "inferred-from-declaration";
    const kind = descriptor?.kind;
    const classification =
        descriptor?.allowedValues || descriptor?.explicitValues
            ? "explicit-enum"
            : kind === "number"
              ? descriptor.integer
                  ? "safe-integer"
                  : "finite-number"
              : kind === "boolean" || declared === "boolean"
                ? "fixed-shape"
                : kind && /reference|thing|segment|song/i.test(kind)
                  ? "typed-reference"
                  : kind && /Array|List|Matrix/.test(kind)
                    ? "fixed-shape"
                    : declared === "number"
                      ? "finite-number"
                      : "fixed-shape";
    const validationReferences = policies.filter((row) => row.source.includes(`.${field}`) || row.source.includes(`"${field}"`));
    rows.push({
        owner,
        field,
        registry,
        classification,
        validationReferences,
        producerEvidence: "Declaration and assignment references below; browser campaign coverage is observed separately, never inferred from policy defaults.",
        representation: descriptor,
        declarations,
        producers: accesses.filter((row) => row.role === "producer-write"),
        consumers: accesses.filter((row) => row.role !== "producer-write")
    });
}
if (game === "jackal-js") {
    const fields = await load("persistence/GameStateFields"),
        policy = await load("persistence/GameStateFieldPolicies"),
        ids = await load("persistence/GameElementTypeIds");
    const owners = {
        MAIN: "Main",
        GAME_MODE: "GameMode",
        MENU: "Menu",
        KONAMI_CODE: "KonamiCode",
        BUTTON_MAPPING: "ButtonMapping",
        INTRO_MODE: "IntroMode",
        SIMPLE_MENU_MODE: "ContinueMode",
        INPUT_MODE: "InputMode",
        INTRO_MAP_MODE: "IntroMapMode",
        MAP_MODE: "MapMode",
        JEEP_HERE_MODE: "JeepHereMode",
        JEEP_YEAH_MODE: "JeepYeahMode",
        JEEP_YEAH_PLANE: "JeepYeahPlane",
        JEEP_YEAH_EXPLOSION: "JeepYeahExplosion",
        JEEP_YEAH_FIRE: "JeepYeahFireLeft",
        JEEP_YEAH_BULLET: "JeepYeahBullet",
        SUNSET_MODE: "SunsetMode",
        HARD_ENDING_MODE: "HardEndingMode"
    };
    for (const [name, values] of Object.entries(fields)) {
        if (!name.endsWith("_FIELD_NAMES") || !Array.isArray(values)) continue;
        const owner = owners[name.replace(/_FIELD_NAMES$/, "")];
        if (!owner) throw new Error(`Unclassified Jackal field registry: ${name}`);
        for (const field of values) add(owner, field, null, name);
    }
    for (const [field, descriptor] of Object.entries(policy.PLAYER_DURABLE_FIELD_DESCRIPTOR))
        add("Player", field, descriptor, "PLAYER_DURABLE_FIELD_DESCRIPTOR");
    for (const owner of ids.GAME_ELEMENT_TYPE_IDS)
        for (const [field, descriptor] of Object.entries(policy.getEntityDurableFieldDescriptor(owner))) add(owner, field, descriptor, "GAME_ELEMENT_TYPE_IDS");
} else if (game === "stickvania-js") {
    const registry = await load("persistence/StateFieldRegistry.generated"),
        ints = await load("persistence/ThingIntegerFields.generated"),
        domains = await load("persistence/ExplicitFieldDomains"),
        policy = await load("persistence/StateFieldValuePolicy");
    for (const field of registry.MAIN_PERSISTED_STATE_FIELD_NAMES)
        add(
            "Main",
            field,
            {
                kind: policy.MAIN_BOOLEAN_PERSISTED_STATE_FIELDS.has(field) ? "boolean" : "number",
                explicitRange: policy.PROVEN_MAIN_INTEGER_RANGES[field] ?? null
            },
            "MAIN_PERSISTED_STATE_FIELD_NAMES"
        );
    for (const [owner, fields] of Object.entries(registry.THING_PERSISTED_STATE_FIELD_NAMES))
        for (const field of fields) {
            const reference = policy.THING_REFERENCE_FIELD_POLICY[owner]?.[field];
            add(
                owner,
                field,
                reference ?? {
                    kind: policy.isThingBooleanPersistedStateField(owner, field) ? "boolean" : "number",
                    integer: ints.THING_INTEGER_FIELDS[owner]?.includes(field) ?? false,
                    explicitRange: policy.PROVEN_THING_INTEGER_RANGES[owner]?.[field] ?? null,
                    explicitValues: domains.THING_ENUM_DOMAINS[owner]?.[field] ?? null
                },
                "THING_PERSISTED_STATE_FIELD_NAMES"
            );
        }
} else {
    const { STATE_FIELD_POLICY } = await load("persistence/StateFieldPolicy");
    for (const [owner, policy] of Object.entries(STATE_FIELD_POLICY)) for (const field of policy.persisted) add(owner, field, null, "STATE_FIELD_POLICY");
}
const specialShapes = [];
for (const file of allSources.filter((path) => path.replaceAll("\\", "/").endsWith("/persistence/GameStateSnapshot.ts"))) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    for (const node of source.statements) {
        if (!ts.isInterfaceDeclaration(node) && !ts.isTypeAliasDeclaration(node)) continue;
        specialShapes.push({
            name: node.name.text,
            file: relative(root, file).replaceAll("\\", "/"),
            line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
            shape: node.getText(source)
        });
    }
}
rows.sort((a, b) => `${a.owner}.${a.field}`.localeCompare(`${b.owner}.${b.field}`));
const duplicates = rows.map((row) => `${row.owner}.${row.field}`);
if (new Set(duplicates).size !== duplicates.length) throw new Error("Duplicate inventory owner/field");
const output = {
    formatVersion: 1,
    game,
    caveat: "Source index, not proof of reachability. It records current registries, declarations, this-field writes/reads, special encoded channels and policy source locations. Type-resolved external property accesses are included; dynamic aliases and phase contracts still require review. Classification states the primitive minimum; owner predicates and loaded-resource/graph checks refine it. See policy-contracts.md.",
    fieldCount: rows.length,
    ownerCount: new Set(rows.map((row) => row.owner)).size,
    fields: rows,
    specialShapes,
    policySourceIndex: policies
};
const path = join(root, "scripts/persistence-fuzz/policy-inventory.json");
const text = JSON.stringify(output, null, 2) + "\n";
if (process.argv.includes("--check")) {
    const existing = JSON.parse(readFileSync(path, "utf8"));
    const semantic = (value) => ({
        game: value.game,
        fields: value.fields.map((row) => ({
            owner: row.owner,
            field: row.field,
            registry: row.registry,
            classification: row.classification,
            representation: row.representation,
            declaredTypes: row.declarations.map((decl) => decl.declaredType?.replace(/\s+/g, "") ?? null)
        })),
        shapes: value.specialShapes.map((shape) => ({ name: shape.name, shape: shape.shape.replace(/\s+/g, "") }))
    });
    if (JSON.stringify(semantic(existing)) !== JSON.stringify(semantic(output)))
        throw new Error("Saved field/policy inventory changed: regenerate, review and update positive tests.");
} else writeFileSync(path, text);
console.log(`${game}: ${output.fieldCount} fields, ${output.ownerCount} owners, ${specialShapes.length} encoded shapes indexed.`);
