# Ms. Pac-Man 2010 Java Reference Implementation

This directory contains the maintained Java/Slick2D reference implementation of Ms. Pac-Man 2010. The Java gameplay code is used to validate the TypeScript browser port and is also the source of the downloadable desktop client.

The source and resources keep the game's existing `desktop/src` layout. Current builds use the JDK tools directly; no separate build-system or IDE-specific project metadata is required.

## Build

JDK 21 LTS is the reference toolchain; JDK 25 has also been used successfully for a full release build. Put `java`, `javac`, and `jar` on `PATH`. The build emits Java 8-compatible bytecode for the legacy Slick2D/LWJGL runtime.

From the repository root, build an unsigned desktop client with:

```sh
npm run build:desktop
```

Build the release desktop component through the root release tooling:

```sh
npm run build:desktop:release
```

The repository build script owns the compile classpath, resource copying, generated high-score release configuration, manifest creation, vendored runtime/native packaging, license/corresponding-source checks, and final ZIP construction. The canonical production desktop client is produced as part of the verified root release pipeline.

## High-score configuration

The original online high-score service is not restored. The maintained Java client targets the replacement JSON high-score API. Unsigned builds can download scores but do not embed the production HMAC submission key. Release builds inject the selected key into generated output without placing it in checked-in Java source.

Runtime HMAC precedence remains:

1. `-Dmspacman.hmacKeyHex`;
2. `MSPACMAN_HMAC_KEY_HEX`;
3. the embedded release key;
4. no key.

Malformed explicit overrides disable remote submission rather than silently falling back.

## Run

From the repository root:

```sh
npm run run:desktop
```

See `RUNTIME_DEPENDENCIES.md`, `licenses/`, and `third-party-sources/` for the vendored runtime, license, provenance, and corresponding-source material.
