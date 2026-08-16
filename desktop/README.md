# Ms. Pac-Man 2010 Legacy Java Desktop

This directory contains the maintained legacy Java desktop build for Ms. Pac-Man 2010. The source and resources keep the original flat `src/` layout, while the build is now Maven-based and no longer includes legacy IDE project metadata.

Included desktop materials:

- `src/` Java sources and runtime resources.
- `test/` desktop test/support material.
- `pom.xml` and `assembly.xml` for the Maven build.
- `lib/` vendored legacy Java dependencies.
- `natives/` bundled LWJGL/JInput native libraries.
- platform launch scripts that set the required native library paths.

Generated build outputs are intentionally ignored:

- `build/`
- `dist/`
- `target/`
- crash logs

The desktop build intentionally emits Java 8-compatible bytecode to improve the odds of running the legacy Slick2D/LWJGL stack across older and newer Java installations. The build suppresses the expected modern-JDK warning about Java 8 being an obsolete target, but real compilation errors still fail the build.

The original online high-score service is not restored. This build targets the replacement JSON high-score API. `downloadScores()` performs one bounded best-effort fetch, preserving the local `0 AAA` defaults on any failure. Submitting initials updates the local in-memory table first, then performs one bounded best-effort POST when an HMAC key is configured. Network, HTTP, parsing, and validation failures are silently ignored.

High-score configuration:

- API URL: `MSPACMAN_SCORE_API_URL` or `-Dmspacman.scoreApiUrl=...`; default is `https://meatfighter.com/api/ms-pac-man-2010/scores`.
- HMAC key: `MSPACMAN_HMAC_KEY_HEX` or `-Dmspacman.hmacKeyHex=...`; without it, remote POST is skipped and local high-score behavior remains.

Build from the repository root:

```text
npm.cmd run build:desktop
```

If Maven is installed, this should also be buildable from this directory:

```text
mvn package
```

Launch after building:

```text
npm.cmd run run:desktop
```

See `RUNTIME_DEPENDENCIES.md` for the bundled legacy Slick2D/LWJGL runtime notes.
