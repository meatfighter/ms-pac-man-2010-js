# Desktop Third-Party License Materials

This directory is the canonical license bundle for the legacy Java desktop
distribution. Keep it in sync with `desktop/lib/`, `desktop/natives/`,
`desktop/RUNTIME_DEPENDENCIES.md`, and the root `THIRD_PARTY_NOTICES.md`.

## Bundled Java Jars

| File                    | SHA-256                                                            | Provenance                                                                                    | License material                                         |
| ----------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `lib/slick.jar`         | `02f7a1f0c48847a32fcc1a3330b12b869e73ad7658c7708174d9f1f2ec75847b` | Legacy Slick2D runtime jar bundled with the original desktop-era project materials.           | `SLICK2D-BSD-3-CLAUSE.txt`                               |
| `lib/lwjgl.jar`         | `a31267bf348e564217d833cb0b334cfe4062aab12b015c126f323882949d1c1d` | LWJGL 2.8.5-era runtime jar.                                                                  | `LWJGL-2-BSD.txt`                                        |
| `lib/lwjgl_util.jar`    | `2432cbacfcec9cd78165f44f45d045bafff9da122276ed288157699eeee688de` | LWJGL 2.8.5-era utility jar.                                                                  | `LWJGL-2-BSD.txt`                                        |
| `lib/jinput.jar`        | `36b6fbede7a2d2f00949a87b9de83007a1c6b4ce5a96978279c0cc612a9adef5` | JInput runtime jar bundled with the LWJGL 2 input stack.                                      | `JINPUT-BSD.txt`                                         |
| `lib/jogg-0.0.7.jar`    | `2e2744b9bfada5e62ba274d6b3089656676599afacc095647234ae383b991ecc` | JCraft Jogg 0.0.7 Ogg runtime dependency used by Slick2D audio.                               | `JORBIS-JOGG-LGPL-NOTICE.txt`, `GNU-LIBRARY-GPL-2.0.txt` |
| `lib/jorbis-0.0.17.jar` | `7096b7eef82228c7aea0260fac4884aec416b332dfaac8182dea8c28ba35b45f` | JCraft JOrbis 0.0.17 Vorbis runtime dependency used by Slick2D audio.                         | `JORBIS-JOGG-LGPL-NOTICE.txt`, `GNU-LIBRARY-GPL-2.0.txt` |
| `lib/gson-2.11.0.jar`   | `57928d6e5a6edeb2abd3770a8f95ba44dce45f3b23b7a9dc2b309c581552a78b` | Maven Central `com.google.code.gson:gson:2.11.0`; jar metadata identifies Apache License 2.0. | `APACHE-2.0.txt`                                         |

## Bundled Native Libraries

| File                                  | SHA-256                                                            | Provenance                                                                                                           | License material                                         |
| ------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `natives/windows/lwjgl.dll`           | `60377a953f707aab277410c5fec00224ffa1b861838b657e5916247cfb151453` | LWJGL 2.8.5-era Windows native runtime.                                                                              | `LWJGL-2-BSD.txt`                                        |
| `natives/windows/lwjgl64.dll`         | `5520eab49c484495a46f04974ee8815477a1c46f0c7b01739eb3a93d863d541a` | LWJGL 2.8.5-era Windows 64-bit native runtime.                                                                       | `LWJGL-2-BSD.txt`                                        |
| `natives/windows/jinput-dx8.dll`      | `f6ee33701bfbba481870f4a370d707b87001fb3213efcc60bff325013b4e219c` | JInput DirectInput Windows native runtime.                                                                           | `JINPUT-BSD.txt`                                         |
| `natives/windows/jinput-dx8_64.dll`   | `511dc50c2001d3e25845dd479ca82fdfc9d42403f9aa69c6493257c66ddf0266` | JInput DirectInput Windows 64-bit native runtime.                                                                    | `JINPUT-BSD.txt`                                         |
| `natives/windows/jinput-raw.dll`      | `0fcd33e00ba5c51f3fdf3613d89c6e9e00381fef03b550412ea73bc837237dcf` | JInput raw-input Windows native runtime.                                                                             | `JINPUT-BSD.txt`                                         |
| `natives/windows/jinput-raw_64.dll`   | `74cd74d55ea20e8fcea7aed8b97c2cf096da1fcde3faf183f815a4dce9364ec3` | JInput raw-input Windows 64-bit native runtime.                                                                      | `JINPUT-BSD.txt`                                         |
| `natives/windows/OpenAL32.dll`        | `af7fbb5f60b3e63577d4567ba58df6ede48a7705658c9de6a322d02dde0759b8` | OpenAL Soft native runtime; binary strings identify `OpenAL Soft`, `OpenAL Community`, and `1.1 ALSOFT 1.14`.        | `OPENAL-SOFT-LGPL-NOTICE.txt`, `GNU-LIBRARY-GPL-2.0.txt` |
| `natives/windows/OpenAL64.dll`        | `3ebc1009680b0e04f4b99b54a0e7b768c14603bf5e8080255aa82a01a269b92b` | OpenAL Soft 64-bit native runtime; binary strings identify `OpenAL Soft`, `OpenAL Community`, and `1.1 ALSOFT 1.14`. | `OPENAL-SOFT-LGPL-NOTICE.txt`, `GNU-LIBRARY-GPL-2.0.txt` |
| `natives/linux/liblwjgl.so`           | `e0de8f9c34e777578dea80d43ca0b61b16f4edb9d3b2ba8ce52c4d4dd2325f33` | LWJGL 2.8.5-era Linux native runtime.                                                                                | `LWJGL-2-BSD.txt`                                        |
| `natives/linux/liblwjgl64.so`         | `a448d44fc012e20bef022ece083070ead143fa37daedbc570872d42da11e4189` | LWJGL 2.8.5-era Linux 64-bit native runtime.                                                                         | `LWJGL-2-BSD.txt`                                        |
| `natives/linux/libjinput-linux.so`    | `ff7af7a1306451428c98e3f50c5bf2f19bb6cbc5835730917cdd755b8cc626d0` | JInput Linux native runtime.                                                                                         | `JINPUT-BSD.txt`                                         |
| `natives/linux/libjinput-linux64.so`  | `86e650f47790e789696a7a5809461eb4b503f5f841e17488aa7ee5a1bedc05a6` | JInput Linux 64-bit native runtime.                                                                                  | `JINPUT-BSD.txt`                                         |
| `natives/linux/libopenal.so`          | `0d6511ac012104c470c1fee7311f1459379d1201c796918eb50ae2acecb5801b` | OpenAL Soft native runtime; binary strings identify `OpenAL Soft`, `OpenAL Community`, and `1.1 ALSOFT 1.14`.        | `OPENAL-SOFT-LGPL-NOTICE.txt`, `GNU-LIBRARY-GPL-2.0.txt` |
| `natives/linux/libopenal64.so`        | `2a0ee434b0113a61ea98e583787df0de7e082385613d1d94d7c0515a9e301687` | OpenAL Soft 64-bit native runtime; binary strings identify `OpenAL Soft`, `OpenAL Community`, and `1.1 ALSOFT 1.14`. | `OPENAL-SOFT-LGPL-NOTICE.txt`, `GNU-LIBRARY-GPL-2.0.txt` |
| `natives/macosx/liblwjgl.jnilib`      | `ed4800ba1920a4b4bcf74cf78206e662ccfb0d0bc271f85b7e2c8f80336d43d8` | LWJGL 2.8.5-era macOS native runtime.                                                                                | `LWJGL-2-BSD.txt`                                        |
| `natives/macosx/libjinput-osx.jnilib` | `d155c29cfa7d7b49cab0821d5ba00a8fdc8b386c8bf5669f0313a62e44ba70d6` | JInput macOS native runtime.                                                                                         | `JINPUT-BSD.txt`                                         |
| `natives/macosx/openal.dylib`         | `ff5e52380b5ef5255654c4e61397822cf57598fce5ed5e6d3cde0762b5c837c8` | OpenAL Soft macOS native runtime; binary strings identify `OpenAL Soft`, `OpenAL Community`, and `1.1 ALSOFT 1.14`.  | `OPENAL-SOFT-LGPL-NOTICE.txt`, `GNU-LIBRARY-GPL-2.0.txt` |

## LGPL Source Availability

JOrbis/Jogg and the bundled OpenAL Soft native libraries are shipped
unmodified as separate runtime dependencies. When publishing the desktop ZIP,
also make corresponding source available from the same release location or a
clearly linked source location. If any binary is replaced, re-identify the
exact component/version from the new artifact and update this directory before
publishing.
