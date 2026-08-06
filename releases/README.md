# Releases

This directory contains intentionally committed downloadable artifacts.

Generated build folders such as `dist/` and `desktop/target/` remain ignored. Use this command when the committed Java desktop download should be refreshed:

```text
npm.cmd run release:desktop
```

The desktop zip contains the runnable Java jar, legacy Slick2D/LWJGL jars, native libraries, launch scripts, and runtime notes.
