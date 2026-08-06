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
