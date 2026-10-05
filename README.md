# Ms. Pac-Man 2010

**[Project page: meatfighter.com/mspacman2010/](https://meatfighter.com/mspacman2010/)** — background, gameplay, controls, and downloads.

This repository contains the maintained Java desktop implementation and TypeScript browser port.

## Development

Use the Node.js version supported by [package.json](package.json), Git, and a JDK with `java`, `javac`, and `jar` on `PATH`. JDK 21 is the reference toolchain; desktop output targets Java 8.

```sh
npm ci --ignore-scripts
npm run dev
```

Run commands from the repository root. On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

## Repository layout

| Path                                  | Purpose                                                 |
| ------------------------------------- | ------------------------------------------------------- |
| `about/content.md`, `about/footer.md` | Project-page article and attribution                    |
| `about/index.html`, `about/assets/`   | Page template and artwork                               |
| `desktop/src/`, `desktop/`            | Java gameplay, resources, and desktop packaging         |
| `pwa/src/mspacman/`                   | Browser gameplay, high-score client, and persistence    |
| `pwa/src/app/`, `pwa/public/`         | Browser shell, lifecycle, resources, and service worker |
| `scripts/`, `version.json`            | Build, test, signing, metadata, and version tooling     |

## Build and check

| Task                                      | Command                                                     |
| ----------------------------------------- | ----------------------------------------------------------- |
| Format / lint                             | `npm run format` / `npm run lint`                           |
| Build unsigned browser / web distribution | `npm run build:pwa:unsigned` / `npm run build:web:unsigned` |
| Build project-page component              | `npm run build:about`                                       |
| Build / run unsigned Java                 | `npm run build:desktop` / `npm run run:desktop`             |
| Run source and behavior checks            | `npm test`                                                  |
| Qualify a production release              | `npm run qualify`                                           |
| Run the extended browser matrix           | `npm run qualify:browsers`                                  |
| Preview the assembled release             | `npm run preview:dist`                                      |

Unsigned development does not need production signing material. Full release qualification requires the active-key configuration described in [RELEASING.md](RELEASING.md), plus the sibling score-server checkout and its qualified `dist/` for loopback integration checks. Never point automated fixtures at the live leaderboard.

The complete release is assembled in `dist/`. Component builds use `.release-components/` and do not refresh the complete distribution. Do not edit generated HTML, bundles, archives, or release metadata by hand.

Standard browser checks use a local Chrome, Chromium, or Edge; set `CHROMIUM_PATH` if discovery fails. Install the extended matrix with `npx playwright install chromium firefox webkit`. Linux may also require browser system dependencies and a display or Xvfb. See [RELEASING.md](RELEASING.md) for the clean-commit qualification sequence; do not run its nested suites separately first.

## Maintenance

Keep Java and TypeScript gameplay changes aligned, including fixed-step timing, numeric semantics, and random-call ordering. Keep browser networking, lifecycle, and storage concerns separate from gameplay; avoid allocations or unnecessary work in update/render paths.

Saved games support the current schema. Unsupported or corrupt saves are ignored without rewriting the slot during load; a later authorized save overwrites the slot. No migration layer for older schemas is maintained.

Regenerate affected resource and parity metadata through the repository scripts. The `slick2d-ts` dependency is pinned to an immutable commit archive; update it and the lockfile together only when intentionally adopting a new engine revision.

See [PERSISTENCE_FUZZING.md](PERSISTENCE_FUZZING.md) for the deterministic qualification campaign, overnight discovery, replay/minimization, evidence isolation and required complete-game resources.

## High-score integration

The [score service](https://github.com/meatfighter/ms-pac-man-2010-server) is maintained separately. Gameplay remains usable when networking is unavailable. Production browser clients use the same-origin `/api/ms-pac-man-2010/scores` endpoint.

Production builds require the existing server-compatible HMAC configuration. Do not generate replacement keys during routine maintenance or commit key material. The embedded client key deters casual edits; it is not proof of legitimate play. See [RELEASING.md](RELEASING.md#2-check-the-production-signing-key).

## Project page and documentation

Edit article prose in `about/content.md` and attribution in `about/footer.md`; layout and metadata are maintained in `about/index.html` and `scripts/build-about.mjs`.

- [desktop/README.md](desktop/README.md): Java build and runtime requirements.
- [releases/README.md](releases/README.md): local release artifacts.
- [LICENSE](LICENSE), [COPYRIGHT.md](COPYRIGHT.md), and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md): source licensing, attribution, and third-party scope.
