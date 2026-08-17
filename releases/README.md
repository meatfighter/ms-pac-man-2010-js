# Releases

This directory is a local staging area for uploadable desktop release artifacts.

Generated release zips are ignored by default to avoid accidental repository bloat. Use this command when the Java desktop download should be refreshed locally:

```text
npm.cmd run release:desktop
```

Upload the generated zip to GitHub Releases or another artifact host. If a zip truly needs to be committed, add that specific file intentionally with `git add -f`.

The desktop zip contains the runnable Java jar, legacy Slick2D/LWJGL jars, native libraries, launch scripts, and runtime notes.
