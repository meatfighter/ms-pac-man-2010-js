# ms-pac-man-2010-js

This repository contains the browser and desktop release project for **Ms. Pac-Man 2010**.

The browser version is a TypeScript Progressive Web App (PWA) port of the original Java game and uses `slick2d-ts` as its Slick2D-style runtime layer. The desktop tree contains the maintained Java/Slick2D reference implementation used for gameplay comparison and downloadable desktop builds. A static project/about page is built alongside both clients.

This repository also owns the **client release pipeline**. A production release is more than a Vite build: it contains the public project page, PWA, Java desktop download, source archives, release metadata, checksums, high-score client configuration, and the verification/recovery machinery used to produce one canonical `dist/` tree.

The high-score **server is a separate project**. This repository builds and verifies the clients that talk to it; it deliberately does not automate SSH, service management, or root-owned server configuration.

---

## Start Here

If you are new to the repository, keep these points in mind:

1. **`pwa/` is the browser game.** It contains the TypeScript port and browser integration code.
2. **`desktop/` is the Java/Slick2D reference implementation.** Production releases include a downloadable desktop ZIP built from it.
3. **`about/` is the public project page.** It is assembled into the same release but is separate from the PWA.
4. **`scripts/` is the release system.** It builds, verifies, packages, signs score submissions, locks release operations, promotes artifacts, and recovers interrupted release state.
5. **`dist/` is the canonical production artifact.** Do not manually assemble production output from source or component-build directories.
6. **The browser and desktop clients share a high-score protocol.** Release clients must use the HMAC key expected by the external score server.
7. **A release is built once and deployed unchanged.** Staging acceptance should test the same bytes that will be promoted to production.

For ordinary browser development:

```sh
npm ci --ignore-scripts
npm run dev
```

On Windows, `npm.cmd` is the equivalent command name used by the release workstation.

For production work, use the documented release commands rather than the internal `_build:*` scripts.

---

## Mental Model

The repository has three layers:

```text
SOURCE
  about/        static project page
  pwa/          TypeScript browser game
  desktop/      Java/Slick2D reference implementation
  assets/       shared source assets
       |
       v
RELEASE TOOLING
  scripts/      build + verify + package + HMAC + recovery
  .release-*    generated/local release state
       |
       v
CANONICAL ARTIFACT
  dist/         exact tree to stage and deploy
```

The normal production path is:

```text
clean Git checkout
       |
       v
select active HMAC key
       |
       v
build into managed temporary output
       |
       v
verify PWA + desktop + archives + metadata + checksums
       |
       v
atomically promote verified output to dist/
       |
       v
smoke-test the production score API
       |
       v
upload exact dist/ bytes to staging
       |
       v
test staging
       |
       v
promote those same bytes to production
```

The important distinction is that **building and deploying are separate operations**. `npm run build` creates the canonical release. Deployment copies that verified release; it should not rebuild it.

### Source-of-truth quick reference

| Concern                         | Source of truth                                                                         | Generated/derived output                     |
| ------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------- |
| Gameplay behavior               | `pwa/src/mspacman/`, compared with Java under `desktop/src/`                            | bundled PWA JavaScript                       |
| Browser shell/storage/bootstrap | `pwa/src/app/`                                                                          | bundled PWA JavaScript                       |
| Save/continue format            | `pwa/src/mspacman/persistence/`                                                         | browser storage                              |
| Static PWA/offline behavior     | `pwa/public/`, `pwa/vite.config.ts`                                                     | generated `pwa/` release                     |
| Public project page             | `about/` plus `assets/`                                                                 | root of assembled release                    |
| Java desktop source             | `desktop/src/`                                                                          | `desktop/target/` and desktop ZIP            |
| Desktop runtime contract        | `desktop/RUNTIME_DEPENDENCIES.md` plus packaged runtime material in the full repository | desktop ZIP                                  |
| Release version                 | `version.json`                                                                          | release filenames and metadata               |
| High-score protocol             | TypeScript/Java high-score code plus release HMAC configuration                         | signed score submissions                     |
| Production release logic        | `scripts/`                                                                              | `dist/`                                      |
| Release integrity/provenance    | release scripts + Git state                                                             | `dist/release.json`, `dist/checksums.sha256` |

If source and generated output disagree, fix the source and rebuild. Do not patch generated files to make a release appear correct.

---

## Release Deliverables

A full production build assembles the public site, browser game, desktop download, source archives, and release metadata into `dist/`.

Conceptually:

```text
dist/
├── index.html
├── ...about-page assets...
├── pwa/
│   ├── index.html
│   ├── manifest.webmanifest
│   ├── sw.js
│   ├── THIRD_PARTY_NOTICES.txt
│   └── ...built game resources...
├── downloads/
│   ├── ...stable and versioned desktop ZIPs...
│   └── ...stable and versioned source ZIPs...
├── release.json
└── checksums.sha256
```

`dist/` is the **canonical verified production release**. Component output under `.release-components/` is useful for development and qualification but is not a substitute for the full release.

Source ZIPs are produced from the exact Git commit recorded by the release. They are not workstation snapshots containing arbitrary untracked files.

---

## Requirements

### Node and npm

Use a Node version accepted by `package.json`:

```text
^20.19.0 || ^22.13.0 || >=24
```

Install JavaScript dependencies from the lockfile with:

```sh
npm ci --ignore-scripts
```

The project uses TypeScript, Vite, ESLint, Prettier, `sharp`, and `slick2d-ts`.

### Java desktop toolchain

Use JDK 21 LTS for current desktop builds and smoke tests. The supported desktop build requires:

```text
javac
jar
```

Repository tooling invokes the JDK directly against the vendored runtime jars and emits Java 8-compatible bytecode for compatibility with the legacy Slick2D/LWJGL desktop stack. Use `npm run build:desktop` for the normal unsigned desktop client and the root release commands for production artifacts.

See:

- `desktop/README.md`
- `desktop/RUNTIME_DEPENDENCIES.md`

for desktop-specific build and runtime details.

### Git

Production release provenance depends on Git. Active-key and next-key release builds require a clean source tree and record the release commit.

---

## Repository Layout

### Source and configuration

| Path                            | Purpose                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `about/`                        | Source for the static public project/about page.                                                          |
| `assets/`                       | Shared source assets used by generated public pages/icons.                                                |
| `pwa/`                          | TypeScript browser PWA.                                                                                   |
| `pwa/src/app/`                  | Browser shell, bootstrap, storage scoping, resource inventory, styles, and version integration.           |
| `pwa/src/mspacman/`             | Main TypeScript game port and high-score client code.                                                     |
| `pwa/src/mspacman/persistence/` | Save-state snapshot, serialization, validation, and storage.                                              |
| `pwa/public/`                   | Manifest, service worker source, icons, stages/demos, and static PWA resources.                           |
| `desktop/`                      | Maintained Java/Slick2D reference implementation, launchers, licenses, and corresponding-source material. |
| `scripts/`                      | Build, verification, HMAC, release, preview, smoke-test, recovery, and packaging tooling.                 |
| `version.json`                  | Checked-in application version/build-stamp source.                                                        |
| `package.json`                  | Root command surface and JavaScript dependencies.                                                         |
| `package-lock.json`             | Reproducible JavaScript dependency resolution.                                                            |
| `THIRD_PARTY_NOTICES.md`        | Root third-party notices.                                                                                 |
| `LICENSE`                       | Project license.                                                                                          |

### Generated and local state

| Path                                  | Purpose                                                      | Commit?   |
| ------------------------------------- | ------------------------------------------------------------ | --------- |
| `node_modules/`                       | Installed JavaScript dependencies.                           | No        |
| `desktop/target/`                     | Generated Java classes/JAR/ZIP/distribution staging.         | No        |
| `dist/`                               | **Canonical verified production release.**                   | No        |
| `releases/`                           | Local staging for separately refreshed desktop release ZIPs. | No        |
| `.release-components/`                | Noncanonical component and synthetic-test builds.            | No        |
| `.release-candidates/`                | Verified next-key release candidate during HMAC rotation.    | No        |
| `.release-secrets/`                   | Local HMAC material, release lock state, and recovery state. | **Never** |
| `.dist-pending-*`                     | Temporary full-release promotion state.                      | No        |
| `.dist-previous-*`                    | Temporary full-release rollback state.                       | No        |
| `.dist-active-before-hmac-finalize-*` | Temporary HMAC-finalization rollback state.                  | No        |

Do not include generated/local release state in source-review archives. In particular, keep `dist/`, `.release-components/`, `.release-candidates/`, `.release-secrets/`, and `desktop/target/` out of review/source-export ZIPs.

---

## Source Trees

### `about/` — Public project page

`about/` contains the source for the page deployed at the public release root. It is separate from the PWA.

The release build renders the page into the same final `dist/` tree and uses deployment-relative links so one release can be staged under one directory and promoted under another without rewriting static files.

Do not hard-code a staging or production root into about-page asset links. Deployment location is deliberately a deployment concern, not source content.

### `pwa/` — Browser/PWA port

`pwa/` is the TypeScript browser application. Root `package.json` provides the JavaScript toolchain; it is not an independent package installation.

The important split is:

```text
pwa/src/
├── app/                    # browser shell/bootstrap/storage/resource concerns
└── mspacman/               # game port
    └── persistence/        # save/continue implementation
```

`pwa/public/` supplies the manifest, service-worker source, icons, and static resources copied or transformed into the release.

#### `pwa/src/mspacman/`

This is the main TypeScript game port. It contains game modes, stage/game objects, input abstractions, high-score protocol/service code, and the persistence layer.

The port intentionally retains Java-shaped structure where that makes behavior easier to compare with the original Java implementation. Do not automatically “modernize” Java-shaped gameplay code if doing so would make parity harder to reason about.

#### `pwa/src/app/`

This layer owns browser-only concerns. Important files include:

- `main.ts` — browser application startup and surrounding UI/lifecycle coordination;
- `BrowserStorageKeys.ts` — deployment-scoped persistent-storage keys;
- `resourceManifest.ts` — browser resource inventory used by startup;
- `version.ts` — build/version integration;
- `styles.css` — browser shell styling.

A useful rule is: **if a concern exists because the game is running in a browser page rather than inside the original Java application, start in `pwa/src/app/`.**

#### `pwa/src/mspacman/persistence/`

The browser save/continue implementation is explicit rather than based on stringifying arbitrary runtime objects:

- `GameStateSnapshot.ts` defines snapshot structures;
- `MsPacManGameStateSerializer.ts` translates between runtime state and snapshots;
- `MsPacManGameStateStore.ts` owns browser persistence and restore validation.

Treat the snapshot format as a compatibility contract. Changes to saved state should be deliberate and tested.

### `desktop/` — Java/Slick2D reference implementation

The desktop tree contains the maintained Java implementation used as a behavioral reference for the TypeScript port and as the source of the downloadable desktop client.

It contains:

- Java source and resources;
- platform launchers;
- vendored runtime/native material;
- desktop dependency licenses;
- corresponding-source material required by redistributed dependencies;
- desktop-specific README/runtime documentation.

The maintained tree uses one supported JDK-based build path rather than carrying a second project/build description. Current repository tooling invokes JDK 21 `javac` and `jar` directly, packages the exact runtime dependencies, and verifies the generated desktop artifact.

Production release builds generate and verify the desktop JAR/ZIP, embed the selected release HMAC key in generated output, and include required licensing/source material.

### `scripts/` — Build and release system

The root scripts form a release system, not a miscellaneous utility folder.

They are divided by responsibility:

| Area                      | Representative scripts                                                                                                                                                | Responsibility                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Build orchestration       | `build-release.mjs`, `release-output-plan.mjs`, `build-*-unsigned.mjs`, `build-utils.mjs`                                                                             | Select artifact type, key source, legal output location, and child build environment.                                                  |
| Artifact creation         | `assemble.mjs`, `build-about.mjs`, `build-desktop.mjs`, `generate-icons.mjs`, `write-release-metadata.mjs`, `write-release-checksums.mjs`, `write-source-archive.mjs` | Create release files.                                                                                                                  |
| Verification              | `verify-pwa-build.mjs`, `verify-release.mjs`                                                                                                                          | Verify PWA output, release structure, metadata, hashes, source archives, desktop package, deployment assumptions, and HMAC provenance. |
| Filesystem/release safety | `release-io.mjs`, `release-lock.mjs`, `release-dist-promotion.mjs`                                                                                                    | Link-safe walking, atomic writes/copies, release locking, and crash-safe promotion.                                                    |
| HMAC lifecycle            | `hmac-config.mjs`, `hmac-cli.mjs`, `release-provision.mjs`, `release-rotate-hmac.mjs`, `release-finalize-hmac.mjs`                                                    | Manage active/next key state and exact-candidate promotion.                                                                            |
| Preview/smoke testing     | `preview-release.mjs`, `smoke-production-api.mjs`, `test-*.mjs`                                                                                                       | Test relocation, application behavior, protocol parity, adversarial release cases, and production API coordination.                    |

When changing release tooling, add a regression test for the failure mode being fixed. Much of this code exists specifically to cover failure modes that ordinary happy-path builds do not exercise.

---

## Daily Development Workflow

### Start the PWA development server

```sh
npm ci --ignore-scripts
npm run dev
```

The Vite development server listens on loopback.

### Run the main checks

```sh
npm test
npm run lint
npm run format:check
npm audit --audit-level=high
```

`npm audit` is intentionally separate from the deterministic build/test pipeline because it depends on the external npm advisory service.

### Format source

```sh
npm run format
```

Do not hand-edit generated output merely to make formatting look correct. Format the source that produces it.

### Build and run the Java desktop version

```sh
npm run build:desktop
npm run run:desktop
```

The normal desktop build is **unsigned**: it can download scores but does not embed the production submission key.

---

## Browser/PWA Architecture

### Slick2D compatibility layer

The browser game uses `slick2d-ts`, a TypeScript/browser adaptation of the Slick2D API surface used by the Java game.

Because rendering, timing, audio, and input behavior are gameplay-sensitive, treat `slick2d-ts` changes as behavioral changes rather than routine build-tool updates. Run browser/gameplay smoke tests after upgrading it.

### Browser shell and game code are separate concerns

The browser shell owns page lifecycle, menu/bootstrap behavior, storage, resource preparation, and integration with browser APIs. The game tree owns game behavior.

Keep browser-only concerns out of Java-shaped game classes unless the game genuinely needs to know about them.

### Resource loading and offline resources

Application resource preparation and service-worker precaching are related but different concerns:

- application code identifies resources the running game must prepare;
- the generated service worker identifies release files that belong in the immutable offline cache.

When adding, moving, or renaming a resource, verify both startup/resource loading and the generated PWA release.

---

## Deployment-Relative PWA Design

The same generated release is intended to work beneath different directories on the same origin, including staging and production locations.

### Static URLs

Static links are deployment-relative. Do not hard-code paths such as `/pwa/`, `/mspacman2010/`, `/ms-pac-man-2010/`, or a staging directory into ordinary static asset references.

The deliberate exception is the same-origin high-score API:

```text
/api/ms-pac-man-2010/scores
```

All same-origin deployments use that production API path.

### Service-worker isolation

The service worker is registered relative to the current PWA page. Cache identity includes deployment scope/path so staging and production copies on the same origin can coexist.

The score API is bypassed **before Cache API handling**. High-score responses must never be served from the PWA offline cache.

The production worker deliberately follows the normal service-worker lifecycle rather than forcing a new worker to take over a running game with `skipWaiting`.

### Browser storage isolation

Save-state and persistent browser settings include the encoded deployment path in their storage namespace.

This keeps staging and production logically separate even when both are served from the same origin.

---

## Persistent State

The browser port supports save/continue across page sessions.

Persistent state is handled by the explicit snapshot/serializer/store layer under:

```text
pwa/src/mspacman/persistence/
```

When changing persistent state:

1. determine whether the change is backward-compatible;
2. update snapshot and serializer code deliberately;
3. preserve validation behavior for malformed or incompatible data;
4. test both New Game and Continue;
5. test restore after a real page reload, not only in-memory serialization.

Storage is deployment-scoped. Moving a deployment to a different directory intentionally gives it a different browser-storage namespace.

---

## High-Score and HMAC Model

### Server boundary

The browser production API path is:

```text
/api/ms-pac-man-2010/scores
```

The PWA deliberately uses a same-origin root-relative path because the score server is not intended to provide CORS.

The desktop client defaults to:

```text
https://meatfighter.com/api/ms-pac-man-2010/scores
```

Server administration remains outside this repository.

### What the HMAC does — and does not do

Release clients sign score submissions with an HMAC key. This is a release-coordination/spam-resistance mechanism, **not a true client secret**. Browser JavaScript and desktop JARs are inspectable, so the server must validate submitted scores independently.

The canonical signed value is:

```text
mspacman-score|1|WORLD|SCORE|INITIALS
```

Browser and Java implementations are tested for protocol parity.

### Unsigned development behavior

Unsigned/dev PWA builds use `MSPACMAN_SCORE_API_URL` when supplied and otherwise use the normal root-relative API path.

Unsigned desktop builds can still download the leaderboard, but remote submission is disabled without a valid signing key.

### Desktop HMAC precedence

Desktop runtime HMAC lookup is:

1. `-Dmspacman.hmacKeyHex`
2. `MSPACMAN_HMAC_KEY_HEX`
3. embedded release resource
4. no key

A malformed explicit JVM property/environment value disables remote submission rather than silently falling back to the embedded key.

### Local key state

Local key material lives under:

```text
.release-secrets/
```

The lifecycle uses three logical states:

- **active** — current client/server production key;
- **next** — staged key during rotation;
- **previous** — retained after rotation as local reference/rollback history.

`.release-secrets/` must never enter `dist/`, source archives, release ZIPs, review archives, tracked source, or logs.

`hmac:check` validates local key state, confirms ignored storage, scans for leaks, and prints fingerprints rather than key material.

Commands that intentionally print key material (`hmac:show`, `hmac:rotate:show-next`) should be used only for deliberate server provisioning.

### One-time setup for an existing production key

On a release workstation that must adopt an already deployed server key:

```sh
npm run hmac:import
npm run hmac:check
```

`hmac:import` uses a hidden prompt and refuses to overwrite an existing active key. The imported value must match the key configured on the production score server.

### HMAC command reference

| Command                         | Purpose                                                     |
| ------------------------------- | ----------------------------------------------------------- |
| `npm run hmac:init`             | Create a new local active key.                              |
| `npm run hmac:import`           | Import an existing production key through a hidden prompt.  |
| `npm run hmac:check`            | Validate key state, scan for leaks, and print fingerprints. |
| `npm run hmac:show`             | Print the active key for deliberate server provisioning.    |
| `npm run hmac:rotate:prepare`   | Stage a next key.                                           |
| `npm run hmac:rotate:check`     | Validate active + next rotation state.                      |
| `npm run hmac:rotate:show-next` | Print the next key for deliberate server cutover.           |
| `npm run hmac:rotate:abort`     | Remove staged next-key state when it is safe to abort.      |

A normal active-key production build refuses to run while a next key is staged. Finish/finalize or safely abort the rotation instead of bypassing the guard.

---

## Versioning and Build Identity

`version.json` is the checked-in application version source.

Release builds verify the project version agrees with the corresponding package/desktop metadata.

A release also receives a fresh **transient build stamp**. The release system supplies that stamp through the build environment instead of rewriting tracked `version.json` merely to produce a build.

This matters because a killed build should not leave source dirty just because cache-busting metadata was being generated.

PWA cache identity includes:

- application version;
- transient build stamp;
- unsigned marker or selected HMAC-key fingerprint.

That identity ensures a release cache is tied to both the release build and signing provenance.

`npm run stamp` is different: it intentionally updates the checked-in build stamp. Do not confuse manual source stamping with the transient stamp used by normal release builds.

---

## Build and Release Workflows

There are intentionally separate commands for development, unsigned inspection, signed component qualification, desktop output, and the canonical production release.

### Build an unsigned PWA

```sh
npm run build:pwa:unsigned
```

Output:

```text
.release-components/pwa-unsigned/
```

Use this for local inspection without embedding the production submission key.

### Build release PWA component output

```sh
npm run build:pwa:release
```

This uses the active release key and writes a noncanonical component build.

### Build unsigned web output

```sh
npm run build:web:unsigned
```

Output:

```text
.release-components/web-unsigned/
```

### Build release web component output

```sh
npm run build:web:release
```

This builds the about page, PWA, source archive, and desktop ZIP download with active-key release provenance, but still does not replace the full canonical release.

### Build the unsigned desktop version

```sh
npm run build:desktop
```

Generated files live under `desktop/target/`.

### Build a release desktop component

```sh
npm run build:desktop:release
```

This embeds active-key release material in generated desktop output.

### Stage a standalone desktop release ZIP

```sh
npm run release:desktop
```

This produces a separately refreshed desktop release under local `releases/` staging. It is not the complete website release.

### Build the canonical production release

```sh
npm run build
```

This is the command to use when the goal is **“create exactly what will be deployed.”**

### Build-command quick reference

| Goal                                   | Command                         | Output                              | HMAC source   |
| -------------------------------------- | ------------------------------- | ----------------------------------- | ------------- |
| Develop browser game                   | `npm run dev`                   | Vite dev server                     | none embedded |
| Inspect unsigned PWA                   | `npm run build:pwa:unsigned`    | `.release-components/pwa-unsigned/` | unsigned      |
| Inspect release PWA                    | `npm run build:pwa:release`     | `.release-components/pwa/`          | active        |
| Inspect unsigned web bundle            | `npm run build:web:unsigned`    | `.release-components/web-unsigned/` | unsigned      |
| Inspect release web bundle             | `npm run build:web:release`     | `.release-components/web/`          | active        |
| Build unsigned desktop                 | `npm run build:desktop`         | `desktop/target/`                   | unsigned      |
| Build release desktop                  | `npm run build:desktop:release` | `desktop/target/`                   | active        |
| Stage standalone desktop ZIP           | `npm run release:desktop`       | `releases/`                         | active        |
| **Build canonical production release** | **`npm run build`**             | **`dist/`**                         | **active**    |
| Provision a new deployment             | `npm run release:provision`     | `dist/`                             | new active    |
| Prepare HMAC rotation                  | `npm run release:rotate-hmac`   | `.release-candidates/hmac-next/`    | next          |

Internal `_build:*` commands are implementation details. Use them directly only when working on release tooling itself.

---

## Production Release Pipeline

`npm run build` creates a full active-key production release.

At a high level it:

```text
acquire release lock
       ↓
recover interrupted promotion
       ↓
validate output plan + clean source
       ↓
verify version/provenance inputs
       ↓
read active HMAC key
       ↓
verify key storage/leak invariants
       ↓
create transient build identity
       ↓
build PWA + about + Java desktop
       ↓
assemble complete release
       ↓
create exact-commit source archives
       ↓
write release metadata + checksums
       ↓
verify complete release
       ↓
recheck source cleanliness
       ↓
journal-promote verified tree to dist/
```

More concretely, the release pipeline:

1. acquires the shared release-operation lock;
2. recovers any interrupted prior full-release promotion;
3. validates the requested output locations and clean source state;
4. verifies project versions are consistent;
5. loads the active key from ignored local secret storage;
6. checks that release secrets are ignored and have not leaked into tracked files;
7. creates an in-memory build stamp/cache identity;
8. builds PWA, about page, and Java desktop release into managed generated locations;
9. assembles the complete site candidate;
10. creates source archives from the exact Git commit;
11. writes `release.json` and `checksums.sha256`;
12. verifies the generated release;
13. rechecks source cleanliness;
14. journal-promotes verified output to `dist/`;
15. releases the operation lock.

A failure before promotion leaves the previous canonical `dist/` intact. If the process dies during promotion, the next release operation recovers the transaction before creating new output.

---

## Release Safety and Provenance

The release system is intentionally conservative because it recursively manages generated directories and coordinates local signing keys.

### Clean source requirement

Active-key and next-key production builds require a clean Git tree and check source state again before final promotion.

This keeps release provenance tied to the commit recorded by the artifact.

### Managed output locations

Release commands do not accept arbitrary recursive-cleanup destinations. Artifact classes have managed generated locations.

This prevents a bad output argument from turning release cleanup into deletion of source or unrelated filesystem content.

### Symlink and junction safety

Generated-output validation checks managed roots, path components, and children. Release walkers reject linked paths where link traversal could escape the expected generated tree.

This matters on both POSIX symlinks and Windows junction/reparse-point scenarios.

### Atomic writes and copies

Important release state is written through temporary files and renames rather than unsafe in-place updates. The same philosophy applies to release metadata, key state, journals, and staged ZIP copies.

### Release-operation lock

Mutating release operations share a lock. Nested release scripts participate in the same logical operation rather than racing their parent.

Stale lock recovery is process-aware; do not manually delete lock state while a release command may still be active.

### Journaled `dist/` promotion

The full release is verified before it is allowed to replace `dist/`.

Conceptually:

```text
verified pending release
       |
       v
journal prepared
       |
       v
old dist -> backup
       |
       v
pending -> dist        <-- commit point
       |
       v
cleanup backup + journal
```

Recovery preserves either the previous complete release or the new complete release depending on which side of the commit point the crash occurred.

Do not replace this with `rm -rf dist` followed by an ordinary move.

### Generated production metadata

`release.json` records release identity/provenance information including application/build identity, Git source state, release kind, HMAC key source/fingerprint, PWA cache identity, deployment metadata, and source archive metadata.

It does **not** contain the full HMAC key.

`checksums.sha256` covers the generated release tree except for the checksum file itself.

---

## Generated Directory Lifecycle

### `.release-components/`

Noncanonical component and synthetic-test output.

Safe to regenerate. Do not deploy it by assuming it is identical to a full production release.

### `.release-candidates/`

Persistent generated coordination state, including the next-key HMAC rotation candidate.

Do not commit or manually promote it outside the documented rotation workflow.

### `.release-secrets/`

Local HMAC keys plus release lock/recovery state.

Treat this directory as private local state. Never package or publish it.

### `desktop/target/`

Java compile/package output.

Delete and rebuild it rather than editing generated files.

### `releases/`

Local staging for independently refreshed desktop release ZIPs.

It is not the canonical website deployment tree.

### `dist/`

The canonical promoted production release.

Treat it as generated deployment output, never source.

---

## Testing

`npm test` exercises application behavior and the release system itself.

The current suite covers areas including:

- PWA save/restore and corrupted-storage recovery;
- browser high-score/HMAC behavior;
- PWA build configuration and cache stamping;
- unsigned-build behavior;
- release output planning and provenance;
- filesystem/path and link safety;
- atomic write/copy failure handling;
- release-lock concurrency, nested holders, stale/malformed recovery, and stress cases;
- journaled `dist/` recovery;
- HMAC import/rotation/leak scanning;
- release relocation/preview behavior;
- release failure/recovery scenarios;
- exact-candidate HMAC finalization;
- production smoke-test behavior against a mock server;
- Java high-score protocol behavior.

Before release, also run:

```sh
npm run lint
npm run format:check
npm audit --audit-level=high
```

When changing release safety, add an adversarial regression test that demonstrates the failure mode rather than only verifying the happy path.

---

## Production API Smoke Test

The production smoke test verifies that the selected release key agrees with the real score server without creating a fake leaderboard entry.

Run:

```sh
npm run smoke:production-api -- --confirm-production
```

Before contacting production, the command verifies the selected release artifact.

It uses:

```text
https://meatfighter.com/api/ms-pac-man-2010/scores
```

The smoke test:

1. downloads the existing leaderboard;
2. selects an already-existing score tuple;
3. signs and POSTs that duplicate once;
4. verifies the authoritative table is unchanged;
5. fetches again to confirm it remains unchanged.

The command refuses to POST when the production table is empty.

---

## HMAC Rotation Workflow

Rotation is a coordinated client/server operation. The key rule is:

> Finalization promotes the **exact candidate bytes that were already tested against the new server key**.

Suppose:

```text
A = current active/client/server key
B = next key
```

The transition is:

```text
client A <-> server A
       |
       | build B candidate
       v
candidate B + local next B
       |
       | manually change server to B
       v
candidate B <-> server B
       |
       | production smoke test B
       v
promote exact candidate B + make B locally active
```

Commands:

```sh
npm run release:rotate-hmac
npm run hmac:rotate:show-next

# Manually install B on the external production server and restart it.

npm run smoke:production-api -- --confirm-production --key-source=next

# Only after the B-key production smoke test succeeds:
npm run release:finalize-hmac
```

Preferred order:

1. build and verify the B candidate with `release:rotate-hmac`;
2. stage/test the exact candidate from `.release-candidates/hmac-next/`;
3. replace server key A with B;
4. run the next-key production smoke test immediately;
5. run `release:finalize-hmac`;
6. deploy the exact finalized bytes.

`release:finalize-hmac` does **not** rebuild the client.

If finalization is interrupted, rerun:

```sh
npm run release:finalize-hmac
```

Recovery state determines whether the transaction should be completed or cleaned up.

Never finalize the local key state before the production B-key smoke test succeeds.

### Rotation-candidate provenance after finalization

Finalization promotes the exact candidate bytes; it does not rewrite them merely to make their metadata look like a fresh active-key build.

For that reason, the finalized `dist/release.json` intentionally retains the provenance with which the immutable candidate was created:

```text
releaseKind   = rotation-candidate
hmacKeySource = next
```

After finalization, active-key verification accepts this artifact only when its recorded fingerprint matches the now-active local key.

### Aborting or rolling back a rotation

Before server cutover, an unwanted staged next key/candidate can be discarded with:

```sh
npm run hmac:rotate:abort
```

After the server has already moved from key A to key B, do **not** manually delete next-key/candidate state.

To roll back to A:

1. restore server `MSPACMAN_HMAC_KEY_HEX=A`;
2. restart the external score service;
3. verify public GET and an A-key authenticated request as appropriate;
4. verify the server fingerprint matches local active A;
5. only then run `npm run hmac:rotate:abort` locally.

If server B is healthy and only static staging/deployment needs repair, keep the server on B, preserve the B candidate/next-key state, repair the static deployment, and continue to finalization.

### Provisioning a brand-new deployment

For a deployment that does not yet have a production HMAC key:

```sh
npm run release:provision
npm run hmac:show
```

`release:provision` creates a new active local key and produces a complete verified release. It does **not** modify the external score server.

Use `hmac:show` only when deliberately installing that key in the server configuration, then restart/verify the external service through its own deployment process.

---

## Common Change Workflows

### Changing gameplay

1. Start in `pwa/src/mspacman/`.
2. Find the corresponding Java behavior under `desktop/src/`.
3. Determine whether the change is a parity fix, intentional browser divergence, or shared behavior change.
4. Keep browser-only concerns in the browser integration layer.
5. Run the main checks.
6. Play-test the affected mode/mechanic.

### Changing save/continue

1. Review `pwa/src/mspacman/persistence/`.
2. Decide whether existing snapshots remain compatible.
3. Update snapshot/serializer/store logic deliberately.
4. Update relevant tests.
5. Test New Game, Continue, reload, malformed state, and any affected game modes.

### Adding or moving PWA resources

1. update the actual PWA resource files;
2. update the browser resource inventory when the application must explicitly prepare them;
3. build the PWA;
4. verify generated PWA output/precache behavior;
5. test from a non-root/staging path when URL behavior changed.

### Changing service-worker behavior

1. update the service worker and/or registration/build code;
2. consider production + staging on the same origin;
3. keep the score API outside Cache API handling;
4. consider upgrade behavior with an already-running game;
5. run PWA/release tests;
6. manually test install, reload, offline reload, and update.

### Changing high-score protocol behavior

1. update browser and Java protocol/client behavior together;
2. preserve the canonical signed-string contract unless intentionally versioning it;
3. run browser and desktop high-score tests;
4. verify unsigned-client behavior;
5. verify active-key release behavior;
6. do not change server administration from this repository.

### Changing desktop dependencies

Update together:

- desktop runtime files;
- launcher/classpath/native assumptions;
- `desktop/RUNTIME_DEPENDENCIES.md`;
- licenses/notices;
- required corresponding source;
- desktop packaging checks;
- desktop ZIP/release verification.

Then launch the **generated ZIP** on every platform/JVM combination you intend to advertise.

### Changing release infrastructure

1. identify the generated-path and key-provenance policy involved;
2. preserve the rule that only the canonical full release promotes to `dist/`;
3. add tests for crash/race/failure states, not only the success path;
4. preserve secret-leak checks;
5. preserve source provenance;
6. run the relevant tests repeatedly when concurrency/recovery behavior changes;
7. run a complete production build from a clean checkout.

---

## Useful Commands

| Command                                                | Purpose                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `npm run dev`                                          | Start local PWA development server.                                            |
| `npm run clean`                                        | Remove/recreate managed canonical build output as defined by the clean script. |
| `npm test`                                             | Run application/release-system tests.                                          |
| `npm run format`                                       | Apply Prettier.                                                                |
| `npm run format:check`                                 | Check formatting.                                                              |
| `npm run lint`                                         | Run ESLint.                                                                    |
| `npm run build:pwa:unsigned`                           | Build unsigned PWA component.                                                  |
| `npm run build:pwa:release`                            | Build active-key PWA component.                                                |
| `npm run build:web:unsigned`                           | Build unsigned about + PWA + downloads component.                              |
| `npm run build:web:release`                            | Build active-key about + PWA + downloads component.                            |
| `npm run build:desktop`                                | Build unsigned desktop output.                                                 |
| `npm run build:desktop:release`                        | Build active-key desktop output.                                               |
| `npm run release:desktop`                              | Stage a verified standalone desktop release ZIP.                               |
| `npm run run:desktop`                                  | Run the desktop Java build.                                                    |
| `npm run build`                                        | Build/verify/promote canonical production release to `dist/`.                  |
| `npm run verify:pwa-build`                             | Verify generated PWA release output.                                           |
| `npm run verify:release`                               | Verify canonical release output with active-key provenance.                    |
| `npm run preview:release -- --base=/test-location/`    | Serve existing `dist/` under another base path without rebuilding it.          |
| `npm run hmac:check`                                   | Validate local HMAC state and print fingerprints.                              |
| `npm run smoke:production-api -- --confirm-production` | Verify release/server HMAC coordination using a duplicate production score.    |
| `npm run release:rotate-hmac`                          | Build verified next-key rotation candidate.                                    |
| `npm run release:finalize-hmac`                        | Promote exact tested rotation candidate and finalize local key state.          |

---

## Where Do I Make This Change?

| Goal                                | Start here                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------- |
| Game mechanics/modes/entities       | `pwa/src/mspacman/`, compare Java under `desktop/src/`                      |
| Browser startup/shell               | `pwa/src/app/main.ts`                                                       |
| Browser persistent-key scoping      | `pwa/src/app/BrowserStorageKeys.ts`                                         |
| Browser resource inventory          | `pwa/src/app/resourceManifest.ts`                                           |
| Save/continue serialization         | `pwa/src/mspacman/persistence/`                                             |
| Browser high-score protocol/service | `pwa/src/mspacman/HighScoreProtocol.ts`, `HighScoreService.ts`              |
| Static service-worker/PWA resources | `pwa/public/`, `pwa/vite.config.ts`                                         |
| Public project/about page           | `about/`, `assets/`, `scripts/build-about.mjs`                              |
| Java behavior                       | `desktop/src/`                                                              |
| Desktop runtime dependencies        | `desktop/RUNTIME_DEPENDENCIES.md` and full-repo runtime material            |
| Desktop packaging                   | `scripts/build-desktop.mjs`                                                 |
| Full release orchestration          | `scripts/build-release.mjs`                                                 |
| Release output policy               | `scripts/release-output-plan.mjs`                                           |
| Release verification                | `scripts/verify-release.mjs`                                                |
| HMAC state                          | `scripts/hmac-config.mjs`, `scripts/hmac-cli.mjs`                           |
| Release lock                        | `scripts/release-lock.mjs`                                                  |
| Atomic full-release promotion       | `scripts/release-dist-promotion.mjs`                                        |
| HMAC rotation/finalization          | `scripts/release-rotate-hmac.mjs`, `scripts/release-finalize-hmac.mjs`      |
| Production API smoke test           | `scripts/smoke-production-api.mjs`                                          |
| Source archives                     | `scripts/write-source-archive.mjs`                                          |
| Release metadata/checksums          | `scripts/write-release-metadata.mjs`, `scripts/write-release-checksums.mjs` |
| Third-party notices                 | root/PWA notices plus desktop license/source material                       |

---

## Production Release Checklist

From an already configured release workstation:

```sh
git status --porcelain
npm ci --ignore-scripts
npm run hmac:check
npm test
npm run lint
npm run format:check
npm audit --audit-level=high
npm run build
npm run verify:release
npm run smoke:production-api -- --confirm-production
git status --porcelain
```

Both Git-status commands should produce no output.

After the build, inspect `dist/release.json` and confirm that it identifies:

- production release kind;
- active HMAC key source;
- clean Git tree;
- the intended current commit.

Compare its HMAC fingerprint with the active fingerprint printed by:

```sh
npm run hmac:check
```

### Stage and deploy the exact bytes

1. Upload the exact generated `dist/` beneath the staging location.
2. Exercise the PWA against the production same-origin score API.
3. Test online/offline behavior, New Game/Continue, score GET, non-mutating authenticated POST, keyboard/gamepad, audio, fullscreen, and the desktop ZIP.
4. Confirm the score API is not present in Cache Storage.
5. Promote the **same release bytes** to the final static location; do not rebuild or rewrite them.
6. Verify deployed files against `dist/checksums.sha256`.
7. Update public links/legacy redirects only after the new deployment is accepted.

---

## Troubleshooting

### Production build reports a dirty Git tree

Run:

```sh
git status --porcelain
```

Understand and resolve every change. Do not bypass the clean-tree guard for routine production output.

### A next HMAC key is already staged

A rotation is in progress. Finish/finalize it or safely abort it.

Do not manually delete key/candidate state to work around the guard.

### Desktop build cannot find `javac` or `jar`

Install/configure a JDK and ensure both tools are on `PATH`.

### Production smoke test refuses to POST because the table is empty

This is intentional. The smoke test uses an existing duplicate tuple so it cannot pollute production data.

### HMAC finalization was interrupted

Do not delete recovery/candidate/key state manually. Rerun:

```sh
npm run release:finalize-hmac
```

### Full release promotion was interrupted

Run the normal release command again. Promotion recovery executes under the release lock before new release output is created.

### New PWA release does not immediately control an open tab

The service worker intentionally follows the normal lifecycle. Close/reopen controlled application tabs during release acceptance rather than forcing a worker takeover under a running game.

### Staging appears to share production save state or cache

It should not. Deployment path/scope is part of browser-storage and service-worker cache identity.

Treat cross-deployment leakage as a defect and rerun relocation/preview tests.

---

## Design Principles

The repository’s structure and release machinery enforce a small set of rules:

1. **Preserve behavioral comparability between the TypeScript port and the Java game.**
2. **Keep browser-only concerns out of gameplay code where practical.**
3. **Treat component/candidate output as disposable until verified.**
4. **Only the canonical full-release workflow may replace `dist/`.**
5. **A production artifact should identify the source and HMAC provenance that produced it.**
6. **A failed or interrupted release should not destroy the previous good `dist/`.**
7. **Parallel/nested release operations must not race.**
8. **Secrets must never enter source, logs, source archives, or public artifacts.**
9. **Staging and production PWA deployments must not share cache/save namespaces.**
10. **The score API must never be satisfied from the PWA cache.**
11. **The browser and Java high-score protocols must remain in parity.**
12. **Server administration stays outside this client repository.**
13. **Release verification must inspect the artifact, not merely trust that a build command succeeded.**

If a shortcut violates one of these rules, understand why the guardrail exists before removing it.

---

## License and Third-Party Material

Project code is licensed under GPL-3.0-or-later unless a file says otherwise.

See:

- `LICENSE` for the project license;
- `THIRD_PARTY_NOTICES.md` for root notices;
- generated `dist/pwa/THIRD_PARTY_NOTICES.txt` for notices distributed with the browser artifact;
- `desktop/licenses/` for desktop dependency licenses/notices;
- desktop corresponding-source material included by the full repository/distribution;
- `desktop/RUNTIME_DEPENDENCIES.md` for details about the preserved Java runtime set.

When changing a redistributed dependency, treat license/notice/corresponding-source packaging as part of the dependency change, not as a later documentation task.
