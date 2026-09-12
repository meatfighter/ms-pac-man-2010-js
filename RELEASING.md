# Releasing

This file contains the reproducible repository-local release procedure. Detailed maintainer rollout matrices, browser/device acceptance history, key-rotation coordination, and cross-project deployment notes are intentionally kept outside the public source tree.

## Prerequisites

Use a Node.js version supported by [package.json](package.json), Git, and the JDK required by the desktop build. Install dependencies from the lockfile:

```sh
npm ci --ignore-scripts
```

Release from one reviewed commit with a clean working tree. Local qualification is the primary gate; GitHub Actions is optional and is not required for release.

## Production signing

Production release builds require the existing active Ms. Pac-Man score-submission HMAC key. Keep key material outside version control.

If an existing deployment checkout does not have the active local key, import the existing server-compatible key rather than generating a replacement merely because the file is absent:

```sh
npm run hmac:import
npm run hmac:check
```

The check prints a fingerprint, not the secret. Confirm the active key is the intended server key before building a production release. Synthetic/manual verification artifacts are test artifacts and must not be deployed as production builds.

Unsigned development remains available through the repository's unsigned build commands and does not require production key material.

## Qualify the exact commit

From the repository root:

```sh
git status --short
npm run qualify
```

`npm run qualify` runs formatting/lint/tests, the dependency audit, active-key production build, release verification, Chromium/browser checks, offline verification, and clean-tree checks defined by the repository scripts. It produces the complete verified distribution in `dist/`.

For browser-facing changes, also run the extended browser qualification against the built PWA:

```sh
npm run qualify:browsers
```

Install the Playwright browser engines and platform dependencies required by that command. Automated browser checks do not replace appropriate real-device acceptance for material PWA, audio, input, lifecycle, fullscreen, high-score, or offline changes.

## Inspect and preview

Confirm the working tree is still clean and preview the exact release output:

```sh
git status --short
npm run preview:dist
```

Before production deployment, stage the exact qualified `dist/` bytes and smoke-test the affected browser, Java desktop, and score-networking behavior. Do not rebuild after stage acceptance and substitute different bytes for deployment.

## Archive

Archive an already-qualified distribution outside the repository:

```sh
node scripts/archive-release.mjs dist /absolute/path/outside/repository/release-artifacts
```

Use a new output directory for each archive. Preserve and verify the generated release metadata/checksums after transfer. Keep the previous known-good archive available for rollback.

## Tag

After qualification and acceptance, create an annotated tag on the exact qualified commit. Use a new version tag and never move an existing release tag. Record the source commit, exact `slick2d-ts` dependency commit, archive/checksum information, and deployment time together.

Creating a build, archive, or tag does not deploy it.
