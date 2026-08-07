# Ms. Pac-Man 2010 Legacy Java Source

This directory is an archival copy of the Java project from `C:\NetBeansProjects\SlickMsPacMan`.

Copied into this repository:

- `src/`
- `test/`
- `build.xml`
- `manifest.mf`
- `nbproject/build-impl.xml`
- `nbproject/genfiles.properties`
- `nbproject/project.properties`
- `nbproject/project.xml`

Also included:

- `pom.xml`
- `assembly.xml`
- `lib/`
- `natives/`
- native-path launch scripts

Intentionally not copied:

- generated `build/`
- generated `dist/`
- machine-local `nbproject/private/`
- crash logs

The project now has a conservative Maven build and a local Node fallback build. The Java source layout remains legacy-style: Java files and resources both live under `src/`, matching the original NetBeans project.

The desktop build intentionally emits Java 8-compatible bytecode to improve the odds of running the legacy Slick2D/LWJGL stack across older and newer Java installations. The build suppresses the expected modern-JDK warning about Java 8 being an obsolete target, but real compilation errors still fail the build.

The original online high-score service is not restored. This build now targets the replacement JSON high-score API. `downloadScores()` performs one bounded best-effort fetch, preserving the local `0 AAA` defaults on any failure. Submitting initials updates the local in-memory table first, then performs one bounded best-effort POST when an HMAC key is configured. Network, HTTP, parsing, and validation failures are silently ignored.

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

See `RUNTIME_DEPENDENCIES.md` for the vendored legacy Slick2D/LWJGL jars and native libraries copied in to improve future desktop compatibility.
