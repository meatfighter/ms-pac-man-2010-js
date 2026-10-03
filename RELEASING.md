# Releasing

Release from a reviewed, clean Git commit using the Node.js version in [package.json](package.json), Git, JDK 21, and the browsers required by qualification.

## 1. Install prerequisites

```sh
npm ci --ignore-scripts
npx playwright install chromium firefox webkit
```

Install the corresponding browser system dependencies when required by the host.

## 2. Check the production signing key

Production builds require the existing server-compatible HMAC key. Keep key material outside version control. When necessary, import the existing key with `npm run hmac:import`, then use `npm run hmac:check` to compare its fingerprint with the intended server configuration. Do not generate or rotate a key during routine maintenance. Unsigned development builds remain available.

Full integration qualification also requires the sibling score-server checkout and its qualified `dist/`. Keep automated server checks on loopback with separate data and test keys.

## 3. Qualify the candidate

Finish the code, tests, documentation, version, and generated-metadata changes together. Format and lint, commit them, and verify that `git status --short` is empty. Then run:

```sh
npm run qualify
npm run qualify:browsers
```

`qualify` runs its nested verification/release checks and creates the assembled release in `dist/`. Do not separately run `verify` and `release` as prerequisites. The extended browser command builds and checks a component under `.release-components/`; it does not replace the assembled `dist/` tree. Passing it is not, by itself, evidence that every extended check ran against the assembled bytes.

If a gate fails, repair the cause, format/lint and commit the coherent correction, then repeat the two gates. Do not skip assertions or erase failing coverage to obtain a pass. Install dependencies again only when the lockfile or installation changes.

## 4. Review and preserve the artifact

Preview the assembled output with `npm run preview:dist` and inspect the affected browser, project-page, and Java desktop behavior on appropriate hardware. Automated checks do not replace real-device review.

Keep the complete qualified `dist/` intact. Deploy it as a unit, including the project page, PWA, downloads, and metadata. Do not rebuild or substitute files after acceptance. A source change requires a new committed and qualified candidate.

An optional archive can be created outside the checkout:

```sh
node scripts/archive-release.mjs dist /absolute/path/outside/repository/release-artifacts
```

Record the commit and artifact checksums, and keep a known-good release for rollback. Never move an existing release tag.

## Dependency maintenance

Keep the committed lockfile, runtime/compiler compatibility, and installed browser versions aligned. Use the supported versions in `package.json`, audit development and runtime dependencies through the existing gates, and review major upgrades separately. Do not advance the pinned engine revision as a side effect of documentation maintenance.
