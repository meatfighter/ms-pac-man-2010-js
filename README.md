# Ms. Pac-Man 2010

This repository contains the maintained **Ms. Pac-Man 2010** project: the original Java/Slick2D game, the TypeScript Progressive Web App (PWA) port, the public project page, desktop packaging, and the tooling used to build and verify releases.

The browser version is a source-level port, not an emulator. The translated game runs on [`slick2d-ts`](https://github.com/meatfighter/slick2d-ts), while the maintained Java source remains the behavioral and structural reference.

## Game

Ms. Pac-Man 2010 expands the classic maze game into four worlds with eight stages each:

- Blinky's world
- Pinky's world
- Inky's world
- Sue's world

Along with pellets, energizers, ghosts, fruit, tunnels, and maze progression, the game includes new mazes, world selection, intermissions, an ending sequence, and a green energizer that temporarily increases Ms. Pac-Man's speed.

Each world has a five-entry Hall of Fame. Browser and desktop clients can retrieve and submit scores through the separate `ms-pac-man-2010-server` project. Score networking is best-effort and does not prevent offline gameplay.

## Browser version

The PWA provides:

- responsive WebGL rendering;
- Smooth, Crisp, and Pixel Perfect scaling;
- keyboard and gamepad input;
- fullscreen support;
- persistent volume and scaling preferences;
- save/continue support;
- offline application/resource caching;
- same-page menu, reset, suspend, and resume behavior.

The browser shell uses **Space** to toggle fullscreen and **Escape** to exit fullscreen. The on-screen menu provides New Game, Continue, Reset, volume, and scaling controls.

## Save-state compatibility

Browser saves use an explicit versioned format and strict structural validation. Save schema **4** is the first public format; schemas 1–3 were development-only and are intentionally disposable.

Unsupported future public saves are preserved rather than silently deleted or overwritten by an older build. Runtime-only objects such as rendering resources, live browser requests, event handlers, and container bindings are reconstructed instead of serialized.

The persistence implementation lives under `pwa/src/mspacman/persistence/`.

## Repository layout

| Path                            | Purpose                                                   |
| ------------------------------- | --------------------------------------------------------- |
| `about/`                        | Public project/about page source                          |
| `assets/`                       | Shared artwork and source assets                          |
| `desktop/`                      | Java/Slick2D implementation and desktop packaging         |
| `pwa/`                          | TypeScript browser/PWA implementation                     |
| `pwa/src/app/`                  | Browser shell and lifecycle integration                   |
| `pwa/src/mspacman/`             | Java-shaped TypeScript game port                          |
| `pwa/src/mspacman/persistence/` | Browser save/continue implementation                      |
| `scripts/`                      | Build, verification, packaging, release, and HMAC tooling |
| `version.json`                  | Application version/build metadata                        |

Generated build output and local release state are not source and should not be edited manually.

## Requirements

Use a Node.js version accepted by `package.json`:

```text
^20.19.0 || ^22.13.0 || >=24
```

Install dependencies from the lockfile:

```sh
npm ci --ignore-scripts
```

The maintained desktop build uses **JDK 21**. See `desktop/README.md` and `desktop/RUNTIME_DEPENDENCIES.md` for desktop-specific details.

## Development

Start the browser development server:

```sh
npm run dev
```

Run the deterministic source/test suite:

```sh
npm test
npm run lint
npm run format:check
```

Audit current npm advisories:

```sh
npm run verify:dependencies
```

Build an unsigned PWA for local development or verification:

```sh
npm run build:pwa:unsigned
```

Build and run the Java desktop distribution:

```sh
npm run build:desktop
npm run run:desktop
```

## Browser verification

Run the real Chromium lifecycle/rendering checks:

```sh
npm run verify:browser
```

Run the true offline-PWA reload check separately:

```sh
npm run verify:offline
```

Automated verification also covers Java/TypeScript parity, Java `float` behavior, fixed-step timing, controller handling, save/restore, high-score protocol vectors, generated resources, release integrity, and desktop packaging.

## High scores

Browser and desktop clients share the same bounded JSON score protocol. The client validates protocol version, world range, Java-int score range and granularity, initials, response size/content type, ordering, row limits, and duplicate tuples.

Score submission uses HMAC-SHA-256 as an anti-casual-tampering mechanism. A key embedded in downloadable browser or desktop software cannot be secret, so the HMAC is not proof that a score was legitimately earned.

## Rendering and Java parity

The TypeScript port intentionally retains Java-shaped organization where that makes the implementation easier to compare with the original source. This is especially important for movement, timing, random-number generation, stage state, and cutscene logic.

The browser presents the original 800×600 logical game through `BufferedScalableGame` in `slick2d-ts`. Scaling changes are live and do not require recreating the game.

When changing gameplay code, prefer behavioral parity with the Java version unless the browser version intentionally documents a different behavior. Keep browser-only concerns such as storage, PWA lifecycle, responsive sizing, service workers, and network requests outside the Java-shaped gameplay classes where practical.

## `slick2d-ts`

The browser project pins an exact immutable HTTPS archive of a qualified `slick2d-ts` commit. Engine upgrades should be treated as behavioral dependencies and requalified against the game rather than as ordinary package bumps.

## Releases

Release tooling builds the project page, browser application, desktop download, source archives, metadata, and checksums from checked-in source. Production artifacts are generated output and are not committed to the source repository.

Use unsigned build commands for ordinary development. Production release commands require the repository's release configuration and should be run only from a clean, reviewed revision.

## License

Ms. Pac-Man 2010 is licensed under **GPL-3.0-or-later**. See [`LICENSE`](LICENSE).

Third-party components and redistributed desktop runtime material retain their respective licenses. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and the notices under `desktop/`.

## Production readiness

See [RELEASING.md](RELEASING.md) for browser qualification, reproducible source
identification, build archives and checksums, artifact retention, and rollback.

The PWA permits one writable game session per deployment path. Another tab can
request **Continue here**; the current owner saves and closes its game before the
new tab starts. Unresponsive owners are not forcibly displaced. This requires a
secure context (HTTPS or localhost), Web Locks, and BroadcastChannel. Close legacy
tabs during the first rollout so every open client uses the ownership protocol.

Resource requests have a 30-second deadline covering response bodies as well as
headers. Audio activation waits at most three seconds before allowing silent play.
Unknown public save versions and oversized saves are preserved; **New Game** and
**Reset** are the explicit paths for replacing protected saves.
