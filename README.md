# Ms. Pac-Man 2010

**[Project page: meatfighter.com/mspacman2010/](https://meatfighter.com/mspacman2010/)** — background, gameplay, controls, and downloads.

This README covers development and maintenance of the Java and TypeScript implementations.

## Repository layout

| Path                                | Purpose                                                            |
| ----------------------------------- | ------------------------------------------------------------------ |
| `about/content.md`                  | Project-page prose; edit this to update the public article         |
| `about/index.html`, `about/assets/` | Page template, SEO metadata placeholders, and artwork              |
| `desktop/src/`                      | Maintained Java gameplay reference and resources                   |
| `desktop/`                          | Desktop build, runtime libraries, and platform-specific packaging  |
| `pwa/src/mspacman/`                 | TypeScript gameplay port                                           |
| `pwa/src/mspacman/persistence/`     | Save schema, validation, serialization, and restoration            |
| `pwa/src/app/`                      | Browser shell, preferences, session ownership, and lifecycle       |
| `pwa/public/`                       | Static game resources and service worker                           |
| `scripts/`                          | Build tools, local checks, generated metadata, and release tooling |
| `version.json`                      | Version and build-stamp source                                     |

Generated output belongs in `dist/`, `.release-components/`, and desktop build directories. Do not edit generated bundles or release metadata by hand.

## Getting started

Use Node.js 24 and Git. Other supported Node versions are listed in [package.json](package.json). Desktop builds and Java checks need a JDK with `java`, `javac`, and `jar` on `PATH`. JDK 21 is the reference toolchain; JDK 25 has also been used successfully for a full release build. Desktop output targets Java 8.

Run commands from the repository root:

```sh
npm ci --ignore-scripts
npm run dev
```

The commands also work in Windows PowerShell; use `npm.cmd` if PowerShell blocks `npm.ps1`.

## Common tasks

| Task                                | Command                                             | Output / notes                                                              |
| ----------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------- |
| Run browser development server      | `npm run dev`                                       | Local URL printed by Vite                                                   |
| Build unsigned PWA                  | `npm run build:pwa:unsigned`                        | `.release-components/pwa-unsigned/`                                         |
| Build about page                    | `npm run build:about`                               | `.release-components/about/`                                                |
| Build unsigned web distribution     | `npm run build:web:unsigned`                        | `.release-components/web-unsigned/`; includes desktop download              |
| Build / run unsigned desktop client | `npm run build:desktop` / `npm run run:desktop`     | See [desktop/README.md](desktop/README.md)                                  |
| Check source and behavior           | `npm test`                                          | Includes native TypeScript, parity, persistence, and release-tooling checks |
| Check formatting / lint             | `npm run format:check` / `npm run lint`             | Run before committing                                                       |
| Check browser / offline behavior    | `npm run verify:browser` / `npm run verify:offline` | See browser prerequisites below                                             |
| Audit dependencies                  | `npm run verify:dependencies`                       | Queries current npm advisories                                              |
| Build production release            | `npm run release`                                   | `dist/`; requires active-key release configuration                          |
| Qualify local commit                | `npm run qualify`                                   | Full local pre-push qualification; builds and verifies `dist/`              |

Component builds use isolated output directories; building a component does not refresh the complete `dist/` distribution. Use the public scripts above rather than invoking internal `_build:*` steps directly.

Browser fixtures use a locally installed Chrome, Chromium, or Edge. Set `CHROMIUM_PATH` to the executable if automatic discovery fails. Offline verification also needs a built PWA; consult [scripts/run-offline-verification.mjs](scripts/run-offline-verification.mjs) for its output-directory selection.

For the separate Chromium/Firefox/WebKit qualification, install the browser engines locally with `npx playwright install chromium firefox webkit`, then run `npm run qualify:browsers` against an already built `dist/pwa/`. Set `PWA_ROOT` to use another built PWA directory. Linux also needs the Playwright system dependencies and a graphical display or Xvfb. Run `npm run qualify` before pushing release-affecting changes; use the extended browser matrix and appropriate real-device acceptance for material browser-facing changes. GitHub Actions is an optional manual Linux check.

## Maintenance principles

- Compare gameplay changes with the corresponding Java source. Preserve useful structural correspondence, fixed-step timing, Java numeric behavior, and random-state behavior.
- Keep browser storage, networking, presentation, and lifecycle concerns in the browser-support layer where practical.
- Avoid unnecessary temporary objects and repeated computation in update and render loops. Use the focused tests listed in [package.json](package.json).
- Before the first public release, development save schemas may be deliberately bumped or reset. Once a public compatibility baseline is declared, preserve unfamiliar public saves and update schema validation/restoration together rather than silently discarding them.
- Regenerate affected resource or parity metadata through the repository scripts and check it before committing.
- The [slick2d-ts](https://github.com/meatfighter/slick2d-ts) dependency is pinned to an immutable HTTPS commit archive. Update `package.json` and `package-lock.json` together, then verify gameplay and browser behavior against that engine revision.

## Project page and deployment

Edit the article in [about/content.md](about/content.md); layout and SEO wiring live in [about/index.html](about/index.html) and [scripts/build-about.mjs](scripts/build-about.mjs).

The canonical URL and Open Graph page URL identify `https://meatfighter.com/mspacman2010/`. Play, download, and page-asset links are relative so the assembled site can be tested beneath a staging directory. Keep production canonical URLs during staging and configure a staging-only `X-Robots-Tag: noindex` response header at the host. That header is a hosting requirement, not something the current build adds.

## High-score integration

The high-score server is maintained in a separate private repository. Access to it or its release keys is not required for unsigned local development; gameplay remains usable when score networking is unavailable.

Use `build:pwa:unsigned`, `build:web:unsigned`, and `build:desktop` for development. `npm run build` and `npm run release` require the maintainer's active-key configuration. Synthetic verification artifacts are not production releases.

Production browser builds use the fixed same-origin endpoint `/api/ms-pac-man-2010/scores`. Moving a build to another directory on the same host does not isolate leaderboard requests. The same leaderboard may be used for staging and production when that is intentional. The current release build does not accept an alternate API path.

The embedded HMAC key deters casual tampering; it cannot authenticate legitimate play. See the public [client implementation](pwa/src/mspacman/) for protocol handling and [RELEASING.md](RELEASING.md#production-signing) for maintainer signing configuration.

## Further documentation

- [RELEASING.md](RELEASING.md): exact-commit qualification, production signing, archive/checksum, and tagging procedure.
- [desktop/README.md](desktop/README.md): Java build and runtime details.
- [releases/README.md](releases/README.md): desktop ZIP packaging and uploadable artifacts.
- [LICENSE](LICENSE): source-code license, GPL-3.0-or-later.
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md): third-party licenses and redistributed components.
