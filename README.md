# Ms. Pac-Man 2010

This repository contains the maintained **Ms. Pac-Man 2010** project: the original Java/Slick2D game, a TypeScript Progressive Web App port, the public project page, and the tooling used to build and verify releases.

The browser port is not an emulator. The original game logic has been translated to TypeScript and runs on [`slick2d-ts`](https://github.com/meatfighter/slick2d-ts), a browser-oriented Slick2D compatibility layer. The Java source remains in the repository as the behavioral reference for the port.

## Game

Ms. Pac-Man 2010 expands the classic maze game into four worlds with eight stages each:

- Blinky's world
- Pinky's world
- Inky's world
- Sue's world

In addition to the familiar pellets, energizers, ghosts, fruit, tunnels, and maze progression, the game includes new stage layouts, world selection, intermissions, an ending sequence, and a green energizer that temporarily increases Ms. Pac-Man's speed.

The game maintains a five-entry Hall of Fame for each world. Browser and desktop releases can retrieve and submit scores through the separate Ms. Pac-Man 2010 high-score service. Score networking is best-effort; loss of the score service does not prevent offline gameplay.

## Browser version

The browser version is an installable PWA with:

- responsive WebGL rendering;
- Smooth, Crisp, and Pixel Perfect scaling modes;
- keyboard and gamepad input;
- fullscreen support;
- persistent volume and scaling preferences;
- save/continue support;
- offline application/resource caching after installation;
- same-page menu, reset, suspend, and resume behavior.

Game state is stored in browser-local storage. Saved-state formats are versioned so incompatible future formats can be rejected without silently overwriting newer public saves.

### Controls

The game supports arrow-key/D-pad movement and keyboard/gamepad confirmation controls. In the browser shell, **Space** toggles fullscreen and **Escape** exits fullscreen. The on-screen menu provides New Game, Continue, Reset, volume, and scaling controls.

## Repository layout

```text
about/                         Public project/about page source
assets/                        Shared artwork and source assets
desktop/                       Java/Slick2D implementation and desktop packaging
pwa/                           TypeScript browser/PWA implementation
pwa/src/app/                   Browser shell and lifecycle integration
pwa/src/mspacman/              TypeScript game port
pwa/src/mspacman/persistence/  Browser save/continue implementation
scripts/                       Build, verification, packaging, and release tooling
version.json                   Application version/build metadata
```

Generated build output and local release state are intentionally excluded from Git.

## Requirements

### Node

Use a Node version accepted by `package.json`:

```text
^20.19.0 || ^22.13.0 || >=24
```

Install JavaScript dependencies from the lockfile:

```sh
npm ci --ignore-scripts
```

### Java desktop build

Current desktop build tooling uses **JDK 21** to compile and package the maintained Java source. The resulting desktop classes target the compatibility level required by the legacy Slick2D/LWJGL runtime bundled with the desktop distribution.

See `desktop/README.md` and `desktop/RUNTIME_DEPENDENCIES.md` for desktop-specific details.

## Development

Start the browser development server:

```sh
npm run dev
```

Run the main deterministic verification suite:

```sh
npm test
npm run lint
npm run format:check
```

Check current npm advisories separately:

```sh
npm run verify:dependencies
```

Build an unsigned browser artifact for local development/verification:

```sh
npm run build:pwa:unsigned
```

Build the Java desktop distribution:

```sh
npm run build:desktop
```

Run the desktop game after building:

```sh
npm run run:desktop
```

## Verification

The repository's automated checks cover substantially more than compilation. They include:

- TypeScript checking for browser-native integration code;
- Java/TypeScript structural and gameplay-parity guardrails;
- known Java `float` behavior at parity-sensitive movement boundaries;
- fixed-step timing contracts;
- browser input/controller behavior;
- save-state structure, validation, restore, and lifecycle behavior;
- high-score protocol and cross-language HMAC vectors;
- build/resource inventories and release integrity;
- real Chromium lifecycle/rendering checks;
- real offline-PWA reload verification;
- Java desktop packaging and high-score-client checks.

`slick2d-ts` is pinned to an immutable HTTPS commit archive. Engine upgrades should be treated as behavioral dependencies and qualified with the browser/gameplay verification suite rather than as ordinary package-version bumps.

## Browser save state

The PWA's save implementation lives under:

```text
pwa/src/mspacman/persistence/
```

Snapshots explicitly capture supported game state rather than serializing arbitrary runtime objects. Runtime bindings such as rendering resources, live browser requests, event handlers, and container objects are reconstructed rather than persisted.

The first public save-state version is defined in `GameStateSnapshot.ts`. Older development-only formats may be discarded; unsupported public versions are handled conservatively so an older build does not silently destroy a save created by another public format.

## High scores

Browser and desktop clients use the same bounded JSON score protocol. The server is maintained in the separate `ms-pac-man-2010-server` project.

The client protocol validates:

- protocol version;
- world range;
- positive Java-int score range and 10-point granularity;
- exactly three allowed initials characters;
- response size;
- content type;
- ordering and per-world row limits;
- duplicate score tuples.

Score submission uses HMAC-SHA-256 as an anti-casual-tampering mechanism. Because downloadable browser and desktop clients cannot keep an embedded key secret, it should not be interpreted as cryptographic proof that a score was legitimately earned.

## Rendering and parity

The TypeScript port intentionally retains Java-shaped organization where that makes behavior easier to compare with the original source. This is especially important for movement, timing, random-number generation, stage state, and cutscene logic.

The browser presents the original 800×600 logical game through `BufferedScalableGame` in `slick2d-ts`. Scaling mode changes are live and do not require recreating the game.

When changing gameplay code, prefer behavioral parity with the Java version unless the browser version intentionally documents a different behavior. When changing browser-only concerns such as storage, PWA lifecycle, responsive sizing, or service workers, keep those concerns in `pwa/src/app/` or the explicit persistence layer rather than pushing them into the Java-shaped gameplay classes.

## Releases

Release tooling builds the public project page, browser application, desktop download, source archives, release metadata, and checksums from the checked-in source. Production artifacts are generated output and are not committed to the source repository.

For ordinary development, use the unsigned build commands above. Production release commands require the release configuration expected by the project tooling and should be run only from a clean, reviewed source revision.

## License

Ms. Pac-Man 2010 is licensed under the **GNU General Public License, version 3 or later**. See [`LICENSE`](LICENSE).

Third-party components and redistributed desktop runtime material retain their respective licenses. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and the notices under `desktop/` for details.
