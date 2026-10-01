# Releasing

Releases are built and qualified locally from a clean Git checkout.

## 1. Install dependencies

Use a Node.js version supported by [package.json](package.json), Git, and the JDK required by the desktop build.

```sh
npm ci --ignore-scripts
```

## 2. Check the production signing key

Production builds require the active Ms. Pac-Man score-submission HMAC key. Keep key material outside version control.

If this checkout does not already have the active server-compatible key, import the existing key rather than generating a replacement:

```sh
npm run hmac:import
npm run hmac:check
```

`hmac:check` prints a fingerprint, not the secret. Confirm that it matches the intended server key before creating the release. Unsigned development builds remain available through the repository's unsigned build commands.

## 3. Qualify the release

Start from a clean committed checkout:

```sh
git status --short
npm run qualify
```

`npm run qualify` runs the repository's source checks, tests, dependency audit, active-key production build, release verification, browser verification, offline verification, and clean-tree checks. It produces the complete deployable release in `dist/`.

For browser-facing changes, also run:

```sh
npm run qualify:browsers
```

This command first builds a fresh production PWA under `.release-components/pwa/pwa` and runs the extended browser qualification against that temporary component output. It does not replace the complete release tree in `dist/`.

Material PWA, fullscreen, audio, lifecycle, input, offline, or high-score changes should also receive appropriate real-device testing.

## 4. Preview the complete release

```sh
git status --short
npm run preview:dist
```

Check the browser version, Java desktop download, project page, and score-networking behavior that changed.

## 5. Stage and deploy

Deploy the **contents of `dist/`** as one release unit. Do not deploy only `dist/pwa/`.

Stage the same `dist/` tree first, smoke-test it, and then deploy those exact bytes to production. Do not rebuild after stage acceptance and substitute a different artifact.

## 6. Archive if desired

An already-qualified `dist/` can be archived outside the repository:

```sh
node scripts/archive-release.mjs dist /absolute/path/outside/repository/release-artifacts
```

Keep the previous known-good release available for rollback.

## Dependency maintenance and artifact freeze

Use Node.js 24 or newer and npm's committed lockfile. Routine dependencies use compatible ranges; TypeScript stays on 6.0.x while the selected parser supports versions below 6.1. Review compiler and Node-typing major changes separately. Playwright, when present, stays exact with its matching browser installation. Audit development dependencies as well as runtime dependencies.

When extended qualification is required, run `npm ci`, `npm run qualify:browsers`, then `npm run qualify`. Inventory the complete resulting `dist` before any further check. Set `PWA_ROOT` to the absolute final `dist/pwa` and run every existing no-build leaf from `scripts/run-browser-qualification-suite.mjs`, including its game-specific Node scripts. The wrapper itself rebuilds and must not be used as evidence that its earlier checks covered the final packaged bytes. Recheck the complete inventory afterward. Preserve all About assets and desktop archives; stage the complete release and promote those same bytes after acceptance.

Firefox is required by default. Any explicitly authorized environmental exception must identify the affected scripts, browser, launch evidence and exact artifact; skipped coverage is not a pass. An assertion failure after successful launch is not an environmental waiver. Keep physical-device acceptance separate.
