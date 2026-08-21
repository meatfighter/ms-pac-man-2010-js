# Desktop Runtime Dependencies

This directory now includes a conservative legacy Slick2D/LWJGL runtime set to improve the chance that the archived Java game can be built and launched on modern machines without upgrading Slick2D to a different rendering/audio stack.

## Java Jars

Copied into `desktop/lib/`:

| Target              | Provenance                                       | Notes                                                                                                                   |
| ------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `slick.jar`         | Legacy Slick2D runtime                           | Slick2D jar paired with the LWJGL 2.8.5-era setup used by this desktop build.                                           |
| `lwjgl.jar`         | LWJGL 2.8.5 runtime                              | Core LWJGL 2 classes.                                                                                                   |
| `lwjgl_util.jar`    | LWJGL 2.8.5 runtime                              | LWJGL utility classes.                                                                                                  |
| `jinput.jar`        | LWJGL 2.8.5 runtime                              | JInput jar from the same LWJGL-era runtime set.                                                                         |
| `jogg-0.0.7.jar`    | JOrbis/JCraft OGG runtime                        | OGG support dependency used by Slick2D audio playback; GNU Lesser/Library GPL terms per JOrbis metadata/source headers. |
| `jorbis-0.0.17.jar` | JOrbis/JCraft OGG runtime                        | OGG support dependency used by Slick2D audio playback; GNU Lesser/Library GPL terms per JOrbis metadata/source headers. |
| `gson-2.11.0.jar`   | Maven Central `com.google.code.gson:gson:2.11.0` | Used only for syntactic JSON parsing in the replacement high-score API client.                                          |

## Native Libraries

Bundled from the LWJGL 2.8.5 native runtime set.

| Target                     | Contents                                                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `desktop/natives/windows/` | `lwjgl.dll`, `lwjgl64.dll`, `OpenAL32.dll`, `OpenAL64.dll`, `jinput-dx8.dll`, `jinput-dx8_64.dll`, `jinput-raw.dll`, `jinput-raw_64.dll` |
| `desktop/natives/linux/`   | `liblwjgl.so`, `liblwjgl64.so`, `libopenal.so`, `libopenal64.so`, `libjinput-linux.so`, `libjinput-linux64.so`                           |
| `desktop/natives/macosx/`  | `liblwjgl.jnilib`, `libjinput-osx.jnilib`, `openal.dylib`                                                                                |

## Compatibility Notes

The original Ms. Pac-Man distribution included only `natives-win32.jar`, which contained 32-bit Windows native libraries. That is unlikely to run on a normal modern 64-bit JVM.

The copied LWJGL 2.8.5 runtime set includes both 32-bit and 64-bit Windows native libraries, plus Linux 32-bit/64-bit native libraries. macOS support remains best-effort because these are old Intel-era native libraries and may not work on current macOS releases or Apple Silicon without compatibility layers.

If this desktop archive is launched directly, the launcher should set the native library paths explicitly. LWJGL uses `org.lwjgl.librarypath`; JInput supports `net.java.games.input.librarypath`; and `java.library.path` keeps `System.loadLibrary()`-based fallbacks pointed at the bundled native folder. The launcher should also set JInput's plugin explicitly so old JInput releases do not misidentify modern Windows versions. On Windows, that means launching with JVM arguments like:

```text
-Dorg.lwjgl.librarypath=desktop\natives\windows -Dnet.java.games.input.librarypath=desktop\natives\windows -Djava.library.path=desktop\natives\windows -Djinput.useDefaultPlugin=false -Dnet.java.games.input.plugins=net.java.games.input.DirectAndRawInputEnvironmentPlugin
```

The included run scripts do this automatically for the copied runtime layout. They also add `--enable-native-access=ALL-UNNAMED` and `--sun-misc-unsafe-memory-access=allow` only when the installed JVM supports those options, which suppresses modern-JDK warnings from legacy LWJGL internals without breaking older Java launches.

This dependency copy does not modernize Slick2D itself and does not upgrade the game code. It only vendors a better-matched legacy runtime set for desktop build work.

Before publishing a release, keep third-party license notices for the bundled runtime jars and native libraries with the downloadable desktop package. The canonical notice file is the repository root `THIRD_PARTY_NOTICES.md`.
