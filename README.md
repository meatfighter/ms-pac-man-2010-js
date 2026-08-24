# Ms. Pac-Man 2010 JS

This repository contains the browser and desktop release project for **Ms. Pac-Man 2010**.

The browser version is a TypeScript Progressive Web App (PWA) port of the original Java game and uses the public `slick2d-ts` package as its Slick2D-style runtime layer. The desktop version preserves the Java game as a buildable and distributable legacy artifact.

This repository also owns the **client release pipeline**. A production release is more than a Vite build: it contains the about page, PWA, Java desktop download, source archives, release metadata, checksums, high-score client configuration, and the verification/recovery machinery used to produce a canonical `dist/` tree.

The high-score **server is a separate project**. This repository builds and verifies the clients that talk to it; it deliberately does not automate SSH, service management, or root-owned server configuration.

## Start Here

If you are seeing this repository for the first time, keep these ideas in mind:

1. **`pwa/` is the browser game.** It is the TypeScript port deployed on the web.
2. **`desktop/` is the preserved Java game.** Production releases include a downloadable desktop ZIP built from it.
3. **`about/` is the public project page.** It is separate from the PWA but assembled into the same release.
4. **`scripts/` is the release system.** It builds, verifies, packages, locks, promotes, and recovers release artifacts.
5. **`dist/` is the canonical production artifact.** Do not manually assemble production from the source directories.
6. **The HMAC key coordinates score submissions with the external score server.** It is local-only and must never enter Git or source archives.
7. **A release is built once and deployed unchanged.** The bytes tested in staging should be the bytes promoted to production.

For ordinary browser development, you usually need only:

```text
npm.cmd ci --ignore-scripts
npm.cmd run dev
```

For a production release, use the [Production Release Workflow](#production-release-workflow). Avoid invoking internal `_build:*` scripts directly unless you are working on the release system itself.

> Command examples use `npm.cmd`, matching the Windows release workstation. On macOS/Linux, use `npm` instead.

## Mental Model

There are three layers:

```text
SOURCE
  about/        static project page
  pwa/          TypeScript browser game
  desktop/      Java desktop game
  assets/       shared source assets
       |
       v
RELEASE TOOLING
  scripts/      build + verify + package + HMAC + recovery
  .release-*    local generated state, candidates, and secrets
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
build into a temporary pending tree
       |
       v
verify PWA + desktop + archives + metadata + checksums
       |
       v
atomically promote the verified tree to dist/
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

The important distinction is that **building and deploying are separate operations**. `npm.cmd run build` creates the release. Deployment copies that already-verified release; it should not rebuild it.

## Why the Release Pipeline Is So Defensive

For a small game, the release tooling may look unusually elaborate. Most of the complexity exists to preserve a few important invariants:

- The PWA and Java desktop client must use the HMAC key expected by the score server.
- A release tested in staging should not be silently rebuilt into different bytes before production.
- A failed build must not replace a previously good `dist/`.
- A process crash during release promotion or HMAC rotation must be recoverable.
- Concurrent release commands must not race and leave artifacts and keys out of sync.
- Recursive cleanup must never escape generated directories through a bad path, symlink, or junction.
- HMAC material must never leak into Git, source archives, logs, or public release metadata.
- Staging and production PWA deployments must coexist on the same origin without sharing save state or service-worker cache namespaces.

The scripts therefore use clean-tree checks, allowlisted output locations, link-safe filesystem validation, atomic writes/copies, release locks, transaction journals, HMAC fingerprints, checksums, and full artifact verification.

**Day-to-day development remains much simpler than the release implementation.** Most developers should use the public npm commands and let the scripts manage these details.

## Repository Layout

### Source and configuration

| Path                     | Purpose                                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `about/`                 | Static project/about page. The production release places this at the top of `dist/` and links into the PWA.                                                                                                               |
| `assets/`                | Source assets shared by generated pages and icons.                                                                                                                                                                        |
| `pwa/`                   | TypeScript browser PWA. `pwa/src/app/` contains browser shell/menu/storage/bootstrap code; `pwa/src/mspacman/` contains the game port; `pwa/public/` contains the manifest, service worker, icons, and static PWA assets. |
| `desktop/`               | Legacy Java game, build metadata, runtime JARs, native libraries, launchers, licenses, and corresponding-source material.                                                                                                 |
| `scripts/`               | Node-based build, verification, HMAC, preview, release, recovery, and test tooling.                                                                                                                                       |
| `version.json`           | Checked-in project version metadata. Release build stamps are supplied in memory instead of rewriting this file.                                                                                                          |
| `package.json`           | Top-level development/build/test/release command surface.                                                                                                                                                                 |
| `THIRD_PARTY_NOTICES.md` | Third-party notices used by release packaging.                                                                                                                                                                            |
| `LICENSE`                | Project license.                                                                                                                                                                                                          |

### Generated/local state

| Path                                  | Purpose                                                                | Commit?   |
| ------------------------------------- | ---------------------------------------------------------------------- | --------- |
| `node_modules/`                       | Installed JavaScript dependencies.                                     | No        |
| `desktop/target/`                     | Generated Java classes, JARs, ZIPs, and distribution staging.          | No        |
| `dist/`                               | **Canonical verified production release.**                             | No        |
| `releases/`                           | Local staging area for separately refreshed desktop release ZIPs.      | No        |
| `.release-components/`                | Noncanonical component builds and synthetic test releases.             | No        |
| `.release-candidates/`                | Verified next-key release candidate during HMAC rotation.              | No        |
| `.release-secrets/`                   | Local HMAC keys, release lock state, and non-secret recovery journals. | **Never** |
| `.dist-pending-*`                     | Temporary full-release promotion state.                                | No        |
| `.dist-previous-*`                    | Temporary release rollback state.                                      | No        |
| `.dist-active-before-hmac-finalize-*` | Temporary HMAC-finalization rollback state.                            | No        |

Generated state should also be removed from review/source-export ZIPs. In particular, do not include `dist/`, `.release-components/`, `.release-candidates/`, `.release-secrets/`, or `desktop/target/` in review archives.

## Prerequisites

### Node/TypeScript toolchain

Supported Node versions are declared in `package.json`:

```text
^20.19.0 || ^22.13.0 || >=24
```

Install dependencies from the lockfile with:

```text
npm.cmd ci --ignore-scripts
```

The project uses TypeScript, Vite, ESLint, Prettier, `sharp`, and the Git-based `slick2d-ts` runtime dependency.

### Java desktop toolchain

Desktop builds require these JDK tools on `PATH`:

```text
javac
jar
```

The desktop build emits Java 8-compatible bytecode to improve compatibility with the legacy Slick2D/LWJGL stack. Maven metadata is retained in `desktop/pom.xml`, but the canonical production desktop artifact is produced by the **top-level release pipeline**, not by manually copying a Maven output.

If Maven is installed, the desktop project can also be built directly from `desktop/`:

```text
mvn package
```

That path is useful for Java-only work, but the canonical production desktop artifact still comes from the top-level full release.

See `desktop/README.md` and `desktop/RUNTIME_DEPENDENCIES.md` for desktop-specific details.

## Project Pieces

### Browser PWA

The PWA is the primary browser game. It uses a menu-first shell because browser audio requires a user gesture before Web Audio can reliably begin playback. The shell also owns New Game/Continue, volume/options, and transition into the game canvas. The in-game hamburger button can return to the menu.

The PWA is designed to work offline after its release resources have been cached. Its service-worker behavior is part of the release contract and is verified during the build.

### Java desktop version

The desktop tree preserves the original Java game as a runnable legacy artifact. The release pipeline builds the JAR/ZIP, bundles runtime/native files, includes required licensing and corresponding-source material, embeds the selected release HMAC key in a generated resource, and verifies the packaged ZIP.

### About page

The about page is static and separate from the PWA. It is built into the same final release and uses deployment-relative links so the same `dist/` can be staged and deployed under different directory names without rewriting files.

### High-score server boundary

The production browser API path is:

```text
/api/ms-pac-man-2010/scores
```

The PWA deliberately uses a same-origin root-relative path because the score server is not intended to provide CORS.

The desktop client defaults to:

```text
https://meatfighter.com/api/ms-pac-man-2010/scores
```

Server administration remains outside this repository.

## Common Developer Workflows

### Start the PWA development server

```text
npm.cmd ci --ignore-scripts
npm.cmd run dev
```

`npm.cmd run dev` starts the Vite dev server on loopback.

### Run the main checks

```text
npm.cmd test
npm.cmd run lint
npm.cmd run format:check
npm.cmd audit --audit-level=high
```

`npm audit` is intentionally separate from the deterministic build/test pipeline because it depends on the external npm advisory service.

### Format the repository

```text
npm.cmd run format
```

### Build an unsigned PWA

```text
npm.cmd run build:pwa:unsigned
```

Output:

```text
.release-components/pwa-unsigned/
```

This is useful for local inspection and does not embed the production submission key.

### Build unsigned web artifacts

```text
npm.cmd run build:web:unsigned
```

Output:

```text
.release-components/web-unsigned/
```

### Build and run the Java desktop version

```text
npm.cmd run build:desktop
npm.cmd run run:desktop
```

The unsigned desktop build can download scores but does not contain the production submission key.

### Preview an existing release under another base path

```text
npm.cmd run preview:release -- --base=/test-location/
```

This serves the existing `dist/` tree under a synthetic mount path **without rebuilding or rewriting it**. Use it to verify relocatability.

## Which Build Command Should I Use?

| Goal                                   | Command                             | Output                              | Key source     |
| -------------------------------------- | ----------------------------------- | ----------------------------------- | -------------- |
| Develop browser game                   | `npm.cmd run dev`                   | Vite dev server                     | None embedded  |
| Inspect unsigned PWA                   | `npm.cmd run build:pwa:unsigned`    | `.release-components/pwa-unsigned/` | Unsigned       |
| Inspect release PWA component          | `npm.cmd run build:pwa:release`     | `.release-components/pwa/`          | Active         |
| Inspect unsigned web artifacts         | `npm.cmd run build:web:unsigned`    | `.release-components/web-unsigned/` | Unsigned       |
| Inspect release web component          | `npm.cmd run build:web:release`     | `.release-components/web/`          | Active         |
| Build unsigned desktop                 | `npm.cmd run build:desktop`         | `desktop/target/`                   | Unsigned       |
| Build release desktop component        | `npm.cmd run build:desktop:release` | `desktop/target/`                   | Active         |
| Refresh standalone desktop release ZIP | `npm.cmd run release:desktop`       | `releases/`                         | Active         |
| **Build canonical production release** | **`npm.cmd run build`**             | **`dist/`**                         | **Active**     |
| Provision a brand-new deployment       | `npm.cmd run release:provision`     | `dist/`                             | New active key |
| Prepare HMAC rotation                  | `npm.cmd run release:rotate-hmac`   | `.release-candidates/hmac-next/`    | Next           |

If the goal is “create what will be deployed,” use **`npm.cmd run build`**. Component builds are not substitutes for the canonical full release.

## Build Types and Provenance

The release system distinguishes artifact types so a local/test artifact cannot accidentally masquerade as production.

### Component builds

PWA/web component builds live under `.release-components/`; desktop components live under `desktop/target/`. They are useful for development and qualification but are not the canonical site bundle.

### Canonical active-key production release

```text
npm.cmd run build
```

The build creates a temporary full-release tree, verifies it, and promotes it to `dist/` only after all release checks pass.

Expected provenance:

```text
releaseKind   = production
hmacKeySource = active
```

### Synthetic full release

Release-system tests sometimes need a full bundle without using the real production key. A synthetic full release uses the known test HMAC key and writes only to:

```text
.release-components/synthetic-full/
```

Example:

```text
set MSPACMAN_HMAC_KEY_HEX=000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
node scripts/build-release.mjs --target=full --key-source=env
```

Synthetic releases must never become canonical `dist/`.

### Rotation candidate

HMAC rotation produces a fully verified next-key candidate at:

```text
.release-candidates/hmac-next/
```

Finalization promotes those **exact tested bytes** instead of rebuilding them.

## What `npm.cmd run build` Does

At a high level, the canonical production build:

1. acquires the release-operation lock;
2. recovers any interrupted previous full-release promotion;
3. validates the output plan and clean source state;
4. verifies project versions match;
5. reads the active HMAC key from ignored local secret storage;
6. checks that release secrets are ignored and have not leaked into tracked files;
7. creates a transient in-memory build stamp and PWA cache identity;
8. builds the PWA, about page, and Java desktop release into managed generated locations;
9. assembles the complete site release;
10. creates source archives from the exact Git commit;
11. writes release metadata and checksums;
12. fully verifies the generated release;
13. checks again that the production source tree is clean;
14. journal-promotes the verified tree to `dist/`;
15. releases the operation lock.

A failure before the promotion commit point leaves the previous canonical release intact. If the process dies during promotion, the next release operation recovers the transaction before starting new work.

## Script Organization

The scripts are split by responsibility rather than concentrated in one large release script.

| Area                | Important scripts                                                                                                                              | Responsibility                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Build orchestration | `build-release.mjs`, `release-output-plan.mjs`, `build-utils.mjs`, `build-*-unsigned.mjs`                                                      | Decide artifact type, key source, legal output location, and child build environment.                                     |
| Artifact creation   | `assemble.mjs`, `build-about.mjs`, `build-desktop.mjs`, `generate-icons.mjs`, `write-release-*.mjs`, `write-source-archive.mjs`                | Create the concrete files that enter a release.                                                                           |
| Verification        | `verify-pwa-build.mjs`, `verify-release.mjs`                                                                                                   | Verify PWA precache/cache identity, metadata, checksums, archives, desktop ZIPs, deployment paths, and HMAC provenance.   |
| Filesystem safety   | `release-io.mjs`, `release-lock.mjs`, `release-dist-promotion.mjs`                                                                             | Strict walkers, symlink/junction rejection, atomic writes/copies, release locking, and crash-safe full-release promotion. |
| HMAC lifecycle      | `hmac-config.mjs`, `hmac-cli.mjs`, `release-provision.mjs`, `release-rotate-hmac.mjs`, `release-finalize-hmac.mjs`, `smoke-production-api.mjs` | Manage active/next keys, candidates, finalization, and production API verification.                                       |
| Preview/testing     | `preview-release.mjs`, `test-*.mjs`                                                                                                            | Test relocation, application behavior, protocol parity, adversarial release cases, and failure recovery.                  |

When changing release tooling, add a regression test for the failure mode being fixed. Much of this code exists because unusual crash, filesystem, and concurrency scenarios are explicitly tested.

## Versioning and Cache Identity

The project version must agree across:

- `version.json`;
- `package.json`;
- `desktop/pom.xml`.

Release builds verify this consistency.

A release also gets a fresh **transient build stamp** passed through the build environment. The scripts do not rewrite tracked `version.json` just to stamp a build. This avoids leaving the source tree dirty if a process is killed mid-build.

The PWA cache identity includes:

- application version;
- build stamp;
- either an unsigned marker or selected HMAC-key fingerprint.

The PWA verifier enumerates the generated PWA tree and checks that everything intended for precaching appears exactly once in the generated service-worker resource list.

## Relocatable Web Releases

The same generated `dist/` is intended to work beneath different directories on `https://meatfighter.com/`, such as:

```text
/ms-pac-man-2010-staging/
/ms-pac-man-2010/
```

Static about/PWA links are deployment-relative. Do not hard-code deployment roots such as `/pwa/`, `/mspacman2010/`, `/ms-pac-man-2010/`, or a staging path into static asset references.

The intentional exception is the score API:

```text
/api/ms-pac-man-2010/scores
```

All same-origin deployments should use the same production API.

### Service-worker isolation

The service worker is registered relative to the current PWA page. Its Cache Storage namespace includes the service-worker scope path, allowing staging and production copies on the same origin to coexist.

The score API is bypassed **before Cache API handling**. Score responses must never be served from the PWA offline cache.

The production service worker deliberately does not use `skipWaiting`; release testing should respect the normal service-worker lifecycle rather than forcing a new worker underneath an active game session.

### Browser storage isolation

Save-state and volume keys include the encoded deployment path, so staging and production keep separate local state even though they share an origin.

## High-Score HMAC Model

Release clients sign score submissions with an HMAC key. This is a release-coordination/spam-resistance measure, **not a true client secret**: browser JavaScript and desktop JARs are inspectable, so the server must validate every submitted score independently.

The canonical signed string is:

```text
mspacman-score|1|WORLD|SCORE|INITIALS
```

The browser and Java clients are tested for protocol parity.

### PWA behavior

Unsigned/dev PWA builds use `MSPACMAN_SCORE_API_URL` when set, otherwise:

```text
/api/ms-pac-man-2010/scores
```

Release PWA builds require the fixed production root-relative API path.

### Desktop behavior

Desktop Java uses `MSPACMAN_SCORE_API_URL` or:

```text
-Dmspacman.scoreApiUrl=...
```

and otherwise defaults to the production HTTPS endpoint.

Release desktop builds generate an embedded key resource under `desktop/target/classes/`. Runtime HMAC precedence is:

1. `-Dmspacman.hmacKeyHex`
2. `MSPACMAN_HMAC_KEY_HEX`
3. embedded release resource
4. no key

A malformed explicit JVM property/environment value disables remote submission and does not silently fall back to the embedded key.

Without a valid key, score downloads can still work; remote submission remains disabled/local-only.

## Local HMAC State

Local release keys live under:

```text
.release-secrets/
```

The relevant states are:

- **active** — current production/client/server key;
- **next** — staged key during rotation;
- **previous** — retained after rotation as local reference/rollback history.

`.release-secrets/` must never be copied into `dist/`, `releases/`, source archives, or review archives.

`hmac:check` validates key state, verifies ignored storage, scans tracked files for leaks, and prints fingerprints only.

`hmac:show` and `hmac:rotate:show-next` print actual key material. Use them only when intentionally provisioning the external server.

## HMAC Commands

### One-time setup for an existing production key

```text
npm.cmd run hmac:import
npm.cmd run hmac:check
```

`hmac:import` uses a hidden prompt and refuses to overwrite an existing active key. The imported value must match the key configured on the production score server.

### Command reference

| Command                             | Purpose                                                    |
| ----------------------------------- | ---------------------------------------------------------- |
| `npm.cmd run hmac:init`             | Create a new local active key.                             |
| `npm.cmd run hmac:import`           | Import an existing production key through a hidden prompt. |
| `npm.cmd run hmac:check`            | Validate key state, scan for leaks, print fingerprints.    |
| `npm.cmd run hmac:show`             | Print active key for deliberate server provisioning.       |
| `npm.cmd run hmac:rotate:prepare`   | Stage a next key.                                          |
| `npm.cmd run hmac:rotate:check`     | Validate active + next rotation state.                     |
| `npm.cmd run hmac:rotate:show-next` | Print next key for deliberate server cutover.              |
| `npm.cmd run hmac:rotate:abort`     | Remove staged next state when it is safe to abort.         |

A normal active-key production release refuses to run while a next key is staged. Complete/finalize the rotation or abort it first.

## Release Safety Model

The release system is intentionally conservative because it recursively manages generated directories and coordinates local deployment keys.

### Clean source requirement

Active- and next-key production builds require a clean Git tree and check it again before final promotion. This keeps production artifacts traceable to the recorded Git commit.

### Managed output locations

Production release commands do not accept arbitrary output directories. Each artifact class has an allowlisted generated location. This prevents recursive cleanup from being redirected into source directories or unrelated filesystem locations.

### Symlink/junction safety

Generated-output checks validate the managed root, each existing intermediate component, and final file/directory destinations. Release tree walkers reject linked roots and linked children.

This prevents a generated path from escaping through a POSIX symlink or Windows junction.

### Atomic writes and copies

Important release state is written to temporary files, flushed where supported, and renamed into place. Pre-rename failures remove temporary files. This pattern is used for key state, journals, lock records, and standalone desktop ZIP staging.

### Release-operation lock

Mutating release operations share a lock in `.release-secrets/`. Public release commands may invoke child release commands, so nested holders register their PIDs under the same token. Holder-record updates are serialized with a short-lived update guard, and stale recovery occurs only after registered holder processes are gone.

This prevents concurrent builds, key changes, or promotions from racing.

### Journaled full-release promotion

A canonical full release is built in a temporary tree and promoted approximately as follows:

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
pending -> dist          <-- commit point
        |
        v
cleanup backup + journal
```

If the process dies before the commit point, recovery restores the old release. If it dies after the commit point, recovery keeps the new release and completes cleanup.

### Journaled HMAC finalization

HMAC finalization changes both a candidate artifact and local key state, so it uses a stronger transaction journal. If finalization is interrupted, rerun `release:finalize-hmac`; do not manually remove its candidate, next-key, backup, or journal state.

## Generated Production Artifacts

A canonical `dist/` includes:

- `dist/index.html` and about-page assets;
- `dist/pwa/` with the PWA, service worker, manifest, icons, and static game assets;
- `dist/pwa/THIRD_PARTY_NOTICES.txt`;
- stable and versioned source ZIPs under `dist/downloads/`;
- stable and versioned desktop ZIPs under `dist/downloads/`;
- `dist/release.json`;
- `dist/checksums.sha256`.

Source ZIPs are generated with `git archive` from the exact commit recorded in `release.json`; they contain committed source, not arbitrary untracked workstation files.

`release.json` records app version, transient build stamp, Git commit/tree state, release kind, HMAC key source/fingerprint, PWA cache identity, deployment metadata, and source archive metadata. It never contains the full HMAC key.

`checksums.sha256` covers every generated release file except itself.

## Testing

`npm.cmd test` exercises both application behavior and the release system itself. It includes:

- PWA save/restore and corrupted-storage recovery;
- PWA high-score/HMAC protocol behavior;
- PWA build configuration and cache stamping;
- release output planning and provenance;
- symlink/junction and generated-path safety;
- atomic write/copy failure handling;
- release-lock concurrency, nested holders, stale/malformed-lock recovery, and stress tests;
- journaled `dist/` crash recovery;
- HMAC import/rotation/leak scanning;
- preview relocation/path safety;
- release failure and recovery scenarios;
- HMAC finalization/exact-candidate promotion;
- production smoke-test behavior against a mock server;
- Java high-score protocol tests.

Also run these release qualification gates:

```text
npm.cmd run lint
npm.cmd run format:check
npm.cmd audit --audit-level=high
```

When changing release safety logic, add an adversarial regression test that demonstrates the old failure mode as well as the corrected behavior.

## Production API Smoke Test

The smoke test proves that the selected release key agrees with the real production server without adding a fake leaderboard entry.

```text
npm.cmd run smoke:production-api -- --confirm-production
```

Before contacting production it verifies the selected release artifact. It then uses the fixed endpoint:

```text
https://meatfighter.com/api/ms-pac-man-2010/scores
```

The test downloads the leaderboard, selects an already-existing tuple, signs and POSTs that duplicate once, verifies the authoritative table is unchanged, and fetches again to confirm it remains unchanged.

It refuses to POST if the production table is empty.

## Production Release Workflow

From an already configured release workstation:

```text
git status --porcelain
npm.cmd ci --ignore-scripts
npm.cmd run hmac:check
npm.cmd test
npm.cmd run lint
npm.cmd run format:check
npm.cmd audit --audit-level=high
npm.cmd run build
npm.cmd run verify:release
npm.cmd run smoke:production-api -- --confirm-production
git status --porcelain
```

Both `git status --porcelain` commands should produce **no output**.

After the build, inspect `dist/release.json` and confirm:

```text
releaseKind   = production
hmacKeySource = active
gitTreeState  = clean
gitCommit     = current HEAD
```

Compare `hmacKeyFingerprint` with the active fingerprint printed by:

```text
npm.cmd run hmac:check
```

### Stage and deploy the exact bytes

1. Upload the exact generated `dist/` beneath `/ms-pac-man-2010-staging/`.
2. Test the staged client against the production same-origin `/api/ms-pac-man-2010/` API while leaving the historical `/mspacman2010/` site untouched.
3. Exercise PWA online/offline behavior, save/continue, score GET, non-mutating authenticated POST, keyboard/gamepad, audio, fullscreen, and the desktop ZIP.
4. Confirm the score API is not present in Cache Storage.
5. Promote the **same files** beneath `/ms-pac-man-2010/`; do not rebuild or rewrite them for the final location.
6. Verify deployed files against `dist/checksums.sha256`.
7. Update public links to the new location.
8. Only after production acceptance, redirect the historical `/mspacman2010/` location.
9. Archive/disable the old writable score CGI separately after migration/historical-score review is complete.

## New Deployment Provisioning

For a brand-new production key:

```text
npm.cmd run release:provision
npm.cmd run hmac:show
```

`release:provision` creates a new active local key and produces a complete verified full release. It **does not modify the server**.

Use `hmac:show` only when deliberately provisioning the external score service. Manually install that key as the server's `MSPACMAN_HMAC_KEY_HEX`, restart the service, and verify the deployment.

## HMAC Rotation Workflow

Rotation uses a staged next key and a verified full candidate. The central rule is that finalization promotes the **exact candidate bytes already tested with the new server key**.

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
        | change server to B
        v
candidate B <-> server B
        |
        | smoke test B
        v
promote exact candidate B + make B locally active
```

### Commands

```text
npm.cmd run release:rotate-hmac
npm.cmd run hmac:rotate:show-next

# Manually install key B on the production server and restart the service.

npm.cmd run smoke:production-api -- --confirm-production --key-source=next

# Only after the production B-key smoke test succeeds:
npm.cmd run release:finalize-hmac
```

Preferred order:

1. Build and verify the B candidate with `release:rotate-hmac`.
2. Stage the exact candidate from `.release-candidates/hmac-next/`.
3. Test everything possible before server cutover.
4. Replace server key A with B and restart the score service.
5. Run the next-key production smoke test immediately.
6. Run `release:finalize-hmac` locally.
7. Promote the exact finalized bytes to the final static location.

`release:finalize-hmac` does **not** rebuild the client.

After finalization, `dist/release.json` intentionally retains:

```text
releaseKind   = rotation-candidate
hmacKeySource = next
```

That provenance describes how the immutable candidate bytes were built. Finalization does not rewrite the artifact just to make its metadata say `production/active`. Active-key smoke testing accepts this finalized state only when its fingerprint matches the now-active key.

If finalization is interrupted, rerun:

```text
npm.cmd run release:finalize-hmac
```

The recovery journal determines whether to complete or clean up the interrupted transaction.

**Never finalize locally before the production B-key smoke test has succeeded.**

## Aborting or Rolling Back a Rotation

Before server cutover, discard an unwanted staged key/candidate with:

```text
npm.cmd run hmac:rotate:abort
```

After the server has already moved from A to B, do not manually delete `.next` or `.release-candidates/hmac-next/`.

To roll the server back:

1. restore server `MSPACMAN_HMAC_KEY_HEX=A`;
2. restart the score service;
3. verify public GET;
4. verify an A-key client/controlled POST as appropriate;
5. verify the server fingerprint matches local active A;
6. only then run `hmac:rotate:abort` locally.

If server B is healthy and only static staging/deployment needs repair, keep the server on B, preserve the next key/candidate, repair and retest, then continue to finalization.

## Fingerprint Comparison

Local active fingerprint:

```text
npm.cmd run hmac:check
```

On the server, an administrator can print the same 12-character fingerprint from `/etc/ms-pac-man-2010-server.env` without displaying the key:

```sh
sudo bash -lc 'set -a; source /etc/ms-pac-man-2010-server.env; set +a; printf "%s" "$MSPACMAN_HMAC_KEY_HEX" | xxd -r -p | sha256sum | cut -c1-12'
```

## Common Problems

### Production build reports a dirty Git tree

Run:

```text
git status --porcelain
```

Understand and resolve every change before producing an active/next production release. Do not bypass the guard.

### A next HMAC key is already staged

A rotation is in progress. Either finish/finalize it or safely abort it. Do not work around the guard by manually deleting key/candidate files.

### Desktop build cannot find `javac` or `jar`

Install/configure a JDK and ensure both tools are on `PATH`.

### Production smoke test refuses to POST because the table is empty

This is intentional. The smoke test submits only an existing duplicate tuple so it cannot pollute production data.

### HMAC finalization was interrupted

Do not manually delete recovery state. Rerun:

```text
npm.cmd run release:finalize-hmac
```

### Full release promotion was interrupted

Run the normal release command again. Promotion recovery runs under the release lock before new release output is created.

### New PWA release does not immediately control an already-open tab

The service worker intentionally follows the normal lifecycle and does not call `skipWaiting`. Close/reopen controlled application tabs as part of release acceptance rather than forcing activation underneath a running game.

### Staging appears to share production save state/cache

It should not. Deployment path is part of both browser-storage and service-worker cache namespaces. Treat cross-deployment leakage as a defect and rerun relocation/preview tests.

## Rules of Thumb for Contributors

- Treat `dist/` as generated output, never source.
- Prefer public npm commands over internal `_build:*` scripts.
- Never copy `.release-secrets/` into any artifact or review archive.
- Never put a real HMAC key into source, tests, documentation, shell scripts, or logs.
- Do not bypass clean-tree checks for production builds.
- Do not rebuild between staging acceptance and production deployment.
- Do not add hard-coded deployment paths to static PWA/about assets.
- Do not cache `/api/ms-pac-man-2010/` in the service worker.
- Do not manually delete release journals/locks/candidates while a recovery workflow exists.
- Keep browser and Java score-protocol behavior in parity.
- Add adversarial tests when changing release-safety behavior.
- Preserve the external-server boundary: this repository should not automate root/SSH server changes.

## License

Project code is licensed under GPL-3.0-or-later unless a file says otherwise. Third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
