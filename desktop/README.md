# Ms. Pac-Man 2010 Legacy Java Desktop

This directory contains the maintained legacy Java desktop build for Ms. Pac-Man 2010. The source and resources keep the original flat `src/` layout, while the build is now Maven-based and no longer includes legacy IDE project metadata.

Included desktop materials:

- `src/` Java sources and runtime resources.
- `pom.xml` and `assembly.xml` for the Maven build.
- `lib/` vendored legacy Java dependencies.
- `licenses/` third-party license texts and binary provenance notes.
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
- Unsigned desktop builds have no embedded HMAC key. They can download scores, but remote POST is skipped unless a valid runtime override is supplied.
- Release desktop builds embed the selected deployment HMAC key in the generated JAR. The checked-in Java source never contains that key.
- Runtime HMAC key precedence is `-Dmspacman.hmacKeyHex`, then `MSPACMAN_HMAC_KEY_HEX`, then the embedded release key. Without any valid key, remote POST is skipped and local high-score behavior remains.
- Malformed explicit runtime overrides do not fall back. If `-Dmspacman.hmacKeyHex` or `MSPACMAN_HMAC_KEY_HEX` is present but is not exactly 64 lowercase hexadecimal characters, remote POST is disabled for that run.

Build from the repository root:

```text
npm.cmd run build:desktop
```

Build the release desktop archive from the repository root:

```text
npm.cmd run build:desktop:release
```

If Maven is installed, this should also be buildable from this directory:

```text
mvn package
```

Launch after building:

```text
npm.cmd run run:desktop
```

See `RUNTIME_DEPENDENCIES.md` and `licenses/` for the bundled legacy Slick2D/LWJGL runtime notes and third-party license material.
