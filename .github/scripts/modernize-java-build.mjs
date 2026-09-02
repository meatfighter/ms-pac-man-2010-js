import { readFileSync, rmSync, writeFileSync } from "node:fs";

function read(path) {
    return readFileSync(path, "utf8");
}

function write(path, content) {
    writeFileSync(path, content, "utf8");
}

function replaceExact(path, oldText, newText, expected = 1) {
    const source = read(path);
    const count = source.split(oldText).length - 1;
    if (count !== expected) {
        throw new Error(`Expected ${expected} occurrence(s) in ${path}, found ${count}: ${oldText.slice(0, 120)}`);
    }
    write(path, source.replaceAll(oldText, newText));
}

for (const path of ["desktop/pom.xml", "desktop/assembly.xml"]) {
    rmSync(path, { force: false });
}

write(
    "desktop/README.md",
    `# Ms. Pac-Man 2010 Java Reference Implementation\n\nThis directory contains the maintained Java/Slick2D reference implementation of Ms. Pac-Man 2010. The Java gameplay code is used to validate the TypeScript browser port and is also the source of the downloadable desktop client.\n\nThe source and resources keep the game's existing \`desktop/src\` layout. Current builds use the JDK tools directly; there is no Maven, Gradle, Ant, or IDE-specific build requirement.\n\n## Build\n\nUse JDK 21 LTS for current development and release validation. The build requires \`javac\` and \`jar\` on \`PATH\` and emits Java 8-compatible bytecode for the legacy Slick2D/LWJGL runtime.\n\nFrom the repository root, build an unsigned desktop client with:\n\n\`\`\`sh\nnpm run build:desktop\n\`\`\`\n\nBuild the release desktop component through the root release tooling:\n\n\`\`\`sh\nnpm run build:desktop:release\n\`\`\`\n\nThe repository build script owns the compile classpath, resource copying, generated high-score release configuration, manifest creation, vendored runtime/native packaging, license/corresponding-source checks, and final ZIP construction. The canonical production desktop client is produced as part of the verified root release pipeline.\n\n## High-score configuration\n\nThe original online high-score service is not restored. The maintained Java client targets the replacement JSON high-score API. Unsigned builds can download scores but do not embed the production HMAC submission key. Release builds inject the selected key into generated output without placing it in checked-in Java source.\n\nRuntime HMAC precedence remains:\n\n1. \`-Dmspacman.hmacKeyHex\`;\n2. \`MSPACMAN_HMAC_KEY_HEX\`;\n3. the embedded release key;\n4. no key.\n\nMalformed explicit overrides disable remote submission rather than silently falling back.\n\n## Run\n\nFrom the repository root:\n\n\`\`\`sh\nnpm run run:desktop\n\`\`\`\n\nSee \`RUNTIME_DEPENDENCIES.md\`, \`licenses/\`, and \`third-party-sources/\` for the vendored runtime, license, provenance, and corresponding-source material.\n`
);

const rootReadme = "README.md";
replaceExact(
    rootReadme,
    "The browser version is a TypeScript Progressive Web App (PWA) port of the original Java game and uses `slick2d-ts` as its Slick2D-style runtime layer. The desktop tree preserves the Java game as a buildable and distributable legacy artifact. A static project/about page is built alongside both clients.",
    "The browser version is a TypeScript Progressive Web App (PWA) port of the original Java game and uses `slick2d-ts` as its Slick2D-style runtime layer. The desktop tree contains the maintained Java/Slick2D reference implementation used for gameplay comparison and downloadable desktop builds. A static project/about page is built alongside both clients."
);
replaceExact(
    rootReadme,
    "2. **`desktop/` is the preserved Java game.** Production releases include a downloadable desktop ZIP built from it.",
    "2. **`desktop/` is the Java/Slick2D reference implementation.** Production releases include a downloadable desktop ZIP built from it."
);
replaceExact(rootReadme, "  desktop/      preserved Java desktop game", "  desktop/      Java/Slick2D reference implementation");
replaceExact(
    rootReadme,
    `### Java desktop toolchain\n\nDesktop builds require a JDK with at least:\n\n\`\`\`text\njavac\njar\n\`\`\`\n\nThe release tooling emits Java 8-compatible bytecode for compatibility with the legacy Slick2D/LWJGL desktop stack.\n\nMaven metadata is retained in \`desktop/pom.xml\`. If Maven is installed, Java-only development can also use the desktop project directly, but the canonical production desktop ZIP is still produced and verified through the **root release pipeline**.\n`,
    `### Java desktop toolchain\n\nUse JDK 21 LTS for current desktop builds and smoke tests. The supported desktop build requires:\n\n\`\`\`text\njavac\njar\n\`\`\`\n\nRepository tooling invokes the JDK directly against the vendored runtime jars and emits Java 8-compatible bytecode for compatibility with the legacy Slick2D/LWJGL desktop stack. Use \`npm run build:desktop\` for the normal unsigned desktop client and the root release commands for production artifacts.\n`
);
replaceExact(
    rootReadme,
    "| `desktop/`                      | Preserved Java project, packaging metadata, launchers, licenses, and corresponding-source material. |",
    "| `desktop/`                      | Maintained Java/Slick2D reference implementation, launchers, licenses, and corresponding-source material. |"
);
let readme = read(rootReadme);
const desktopSection = /### `desktop\/` — Preserved Java desktop project[\s\S]*?### `scripts\/` — Build and release system/;
if (!desktopSection.test(readme)) {
    throw new Error("Unable to find the Ms. Pac-Man desktop README section.");
}
readme = readme.replace(
    desktopSection,
    `### \`desktop/\` — Java/Slick2D reference implementation\n\nThe desktop tree contains the maintained Java implementation used as a behavioral reference for the TypeScript port and as the source of the downloadable desktop client.\n\nIt contains:\n\n- Java source and resources;\n- platform launchers;\n- vendored runtime/native material;\n- desktop dependency licenses;\n- corresponding-source material required by redistributed dependencies;\n- desktop-specific README/runtime documentation.\n\nThe maintained tree does not carry an alternate Maven/Gradle/Ant/IDE build description. Current repository tooling invokes JDK 21 \`javac\` and \`jar\` directly, packages the exact runtime dependencies, and verifies the generated desktop artifact.\n\nProduction release builds generate and verify the desktop JAR/ZIP, embed the selected release HMAC key in generated output, and include required licensing/source material.\n\n### \`scripts/\` — Build and release system`
);
if (/Maven|\bmvn\b/.test(readme)) {
    throw new Error("Obsolete Maven build documentation remains in README.md.");
}
write(rootReadme, readme);

const desktopBuild = read("scripts/build-desktop.mjs");
if (/Maven|\bmvn\b|pom\.xml|assembly\.xml/.test(desktopBuild)) {
    throw new Error("Ms. Pac-Man canonical desktop builder unexpectedly depends on Maven metadata.");
}

console.log("Ms. Pac-Man 2010 Java desktop build modernization applied.");
