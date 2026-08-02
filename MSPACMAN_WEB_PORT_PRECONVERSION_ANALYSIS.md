# Ms. Pac-Man Web Port Pre-Conversion Analysis

Date: 2026-08-02

Scope: this is a research and planning document only. No game code has been written here. The target is a modern desktop-browser PWA SPA port of `C:\NetBeansProjects\SlickMsPacMan`, using the TypeScript Slick2D port in `C:\js-projects\slick2d-ts`, with a 1-to-1 Java class/method/function mapping wherever the browser platform permits it.

## Hard Decisions

- Target modern desktop browsers. We should not spend conversion effort on old Safari, Internet Explorer, or legacy mobile-browser fallbacks.
- Keep the original OGG audio files. Modern browsers can handle them, and the Java game already ships OGG assets.
- Preserve every Java game class as a TypeScript file. Browser-only shell code may exist outside that mapping, but it must not erase or collapse the Java class structure.
- Omit the dead remote high-score service at `http://meatfighter.com/cgi-bin/mspacman_scores.py`. Keep the Java-facing high-score API shape, but implement it as a placeholder that completes successfully and does not contact the network.
- Use a browser/PWA shell before the Java-equivalent game loop starts. The shell owns the start button, audio unlock, volume slider, loading splash, loading retries, installability, cache versioning, and hamburger return-to-menu behavior.
- Treat integer semantics as a first-class conversion concern. Java `int`, `char`, signed byte reads, truncating casts, integer division, bit shifts, and random number generation must be audited method by method.

## Browser Audio Finding

The current asset format is acceptable for modern browsers.

Sources checked:

- WebKit states that Safari 18.4 added Ogg container support for both Opus and Vorbis audio on macOS Sequoia 15.4, iOS 18.4, iPadOS 18.4, and visionOS 2.4: https://webkit.org/blog/16574/webkit-features-in-safari-18-4/
- Can I Use lists Ogg Vorbis as supported in Safari 18.4 and later, and reports 95.4 percent global usage support in the table checked on 2026-08-02: https://caniuse.com/ogg-vorbis
- MDN documents `BaseAudioContext.decodeAudioData()` as the preferred way to create Web Audio sources from complete fetched audio file data: https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData
- MDN documents that Web Audio playback is subject to autoplay blocking unless triggered after user interaction: https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay and https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_Web_Audio_API

Conclusion:

- Do not convert the `.ogg` files to MP4. If we ever need an older-browser fallback, use an audio fallback format such as MP3, AAC, or M4A, not MP4 as the primary sound-asset answer.
- The PWA start button is still required. Browser format support does not remove autoplay restrictions.
- The volume slider should set a master gain before the game starts and remain connected to all future audio playback.

## OGG Loading-Time Risk

The Java game's audio payload is small enough for a desktop-browser PWA.

Audio inventory:

- `music`: 12 OGG files, 2,617,483 bytes.
- `soundfx`: 30 OGG files, 317,687 bytes.
- Total audio: 42 OGG files, 2,935,170 bytes, about 2.80 MiB.
- Largest audio file: `music/stage_1.ogg`, 661,366 bytes, about 646 KiB.

Full asset inventory:

- `images`: 4 files, 83,340 bytes.
- `music`: 12 files, 2,617,483 bytes.
- `soundfx`: 30 files, 317,687 bytes.
- `stages`: 32 files, 195,312 bytes.
- `demos`: 4 files, 19,986 bytes.
- Total original asset payload: 3,233,808 bytes, about 3.08 MiB.

Risk assessment:

- Download size is not a serious desktop-browser concern.
- OGG decode time should be acceptable, but `decodeAudioData()` requires complete file data. The loader must show progress and errors because decode failures and network failures are still possible.
- Preloading all sound effects and music after the user's Start click is reasonable.
- If startup feels slow, the preferred compromise is to preload the assets required for the menu-to-first-stage path first, then continue decoding act/ending/late-game music in the background. This should only be done if it does not change Java-visible timing once gameplay begins.

## PWA Shell Plan

The PWA shell is not a replacement for the Java game classes. It is an outer browser adapter.

Required shell responsibilities:

- Show a first screen with a Start button.
- Show an audio volume slider on that first screen.
- Create or resume the `AudioContext` inside the Start button gesture.
- Load resources through a splash screen with animated dots.
- Show a user-visible error if loading fails.
- Retry downloads before declaring failure.
- Provide a hamburger icon in the upper-left during the game.
- Let the hamburger return to the menu without corrupting game state.
- Provide a PWA manifest.
- Provide a service worker.
- Keep an app/cache version number that can be incremented each build.
- Put an adjustable timestamp or version query parameter on referenced resource URLs to help break stale caches after deployment.

Reference projects:

- `C:\js-projects\pitfall-js` demonstrates the menu/start/volume pattern.
  - `src\start.ts` builds the start menu and volume slider around lines 21-47.
  - `src\start.ts` wires volume and start events around lines 51-56.
  - `src\start.ts` starts the game after setting volume around lines 129-139.
  - `src\audio.ts` creates/resumes `AudioContext`, sets master gain, decodes buffers, and plays `AudioBufferSourceNode`s.
- `C:\js-projects\worst-mario-game-ever` demonstrates a boot/loading surface.
  - `pwa\index.html` includes boot screen, animated dots, and error state styles.
  - `pwa\src\app\App.ts` loads resources, swaps to the game, and shows loading failure.

Service-worker versioning:

- MDN recommends a service-worker version number, a resource list, and a versioned cache name for PWAs: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Tutorials/CycleTracker/Service_workers
- MDN's PWA caching guide confirms service workers can precache resources and serve cached responses offline: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching

## Directory And Class Mapping

The Java project uses package directory `src\mspacman`. The TypeScript port should mirror that as a flat `src/mspacman` directory unless the final app scaffold already establishes a stricter source root.

Recommended game mapping root:

- Java: `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\*.java`
- TypeScript: `C:\js-projects\ms-pac-man-2010-js\src\mspacman\*.ts`

Recommended asset mapping:

- Java `src\images` -> web `public/assets/images` or equivalent static asset root.
- Java `src\music` -> web `public/assets/music`.
- Java `src\soundfx` -> web `public/assets/soundfx`.
- Java `src\stages` -> web `public/assets/stages`.
- Java `src\demos` -> web `public/assets/demos`.

Browser-only files should be outside `src/mspacman`, for example:

- `src/app` for PWA shell, menu, splash, hamburger, and browser lifecycle.
- `src/audio` for Web Audio adapter if not wholly supplied by `slick2d-ts`.
- `src/pwa` or project root files for manifest/service worker registration.

Do not merge multiple Java game classes into a single TypeScript file. Do not collapse the mode classes into a generic state machine. Do not replace the ghost hierarchy with data tables. The point is parity, not modernization.

## Java-To-TypeScript Class Ledger

| Java file | TypeScript file | Required mapping note |
| --- | --- | --- |
| `Act1Mode.java` | `src/mspacman/Act1Mode.ts` | Preserve cutscene counters, render order, animation frame transitions, and float cast behavior. |
| `Act2Mode.java` | `src/mspacman/Act2Mode.ts` | Preserve animation counters and all frame/position branches. |
| `Act3Mode.java` | `src/mspacman/Act3Mode.ts` | Preserve update and render sequencing. |
| `Act4Mode.java` | `src/mspacman/Act4Mode.ts` | Preserve float-to-int visual math and counter transitions. |
| `Act5Mode.java` | `src/mspacman/Act5Mode.ts` | Preserve random character/animation selection using Java-compatible random behavior. |
| `Act6Mode.java` | `src/mspacman/Act6Mode.ts` | Preserve all counter and animation state. |
| `Act7Mode.java` | `src/mspacman/Act7Mode.ts` | Preserve random character/animation selection using Java-compatible random behavior. |
| `AppletGameContainer2.java` | `src/mspacman/AppletGameContainer2.ts` | Browser-inapplicable Java applet/LWJGL class. Keep a mapped adapter/stub file with documented non-runtime status. |
| `AttractMode.java` | `src/mspacman/AttractMode.ts` | Preserve demo playback, attract-mode timing, mode transitions, and bit-shift tile positioning. |
| `CyanGhost.java` | `src/mspacman/CyanGhost.ts` | Preserve target calculation relative to red ghost and Ms. Pac-Man direction. |
| `EndingMode.java` | `src/mspacman/EndingMode.ts` | Preserve final cutscene counters, modulo animation, character code indexing, and casts. |
| `EnterInitialsMode.java` | `src/mspacman/EnterInitialsMode.ts` | Preserve initials editing behavior. Replace remote high-score access with a placeholder completion path. |
| `FruitTarget.java` | `src/mspacman/FruitTarget.ts` | Preserve speed remainder movement, random exit selection, tile wrap, scoring, and integer casts. |
| `Ghost.java` | `src/mspacman/Ghost.ts` | Preserve shared ghost movement, chase priority, randomness, eye movement, speed logic, and rendering. |
| `HallOfFameMode.java` | `src/mspacman/HallOfFameMode.ts` | Preserve scoreboard display and blinking/typing timing, with placeholder score data. |
| `HighScore.java` | `src/mspacman/HighScore.ts` | Direct small data class mapping. |
| `HumanInput.java` | `src/mspacman/HumanInput.ts` | Preserve input interface behavior through `slick2d-ts` input constants/events. |
| `IInput.java` | `src/mspacman/IInput.ts` | Direct interface mapping. |
| `IMode.java` | `src/mspacman/IMode.ts` | Direct interface mapping. |
| `IntroMode.java` | `src/mspacman/IntroMode.ts` | Preserve random world selection and intro timing. |
| `LoadingMode.java` | `src/mspacman/LoadingMode.ts` | Preserve Java mode shape while delegating browser download/decode to shell/resource cache. |
| `Main.java` | `src/mspacman/Main.ts` | Central port. Preserve field layout, mode switching, fixed update loop, resource wiring, draw helpers, and high-score placeholders. |
| `MsPacMan.java` | `src/mspacman/MsPacMan.ts` | Preserve pixel movement, speed remainder loop, pellet interactions, wrap, input priority, and sprite counters. |
| `OrangeGhost.java` | `src/mspacman/OrangeGhost.ts` | Preserve distance threshold behavior. |
| `PinkGhost.java` | `src/mspacman/PinkGhost.ts` | Preserve direction-offset target behavior. |
| `PlayingMode.java` | `src/mspacman/PlayingMode.ts` | Highest-risk gameplay class. Preserve stage copy, pellet math, regions, timers, fruit, ghosts, scoring, music, and render order. |
| `RedGhost.java` | `src/mspacman/RedGhost.ts` | Preserve direct Ms. Pac-Man targeting. |
| `RobotInput.java` | `src/mspacman/RobotInput.ts` | Preserve byte bit masks and demo index timing. |
| `ScalableGame2.java` | `src/mspacman/ScalableGame2.ts` | Preserve game-specific scaler mapping even though `slick2d-ts` has a compatible scaler. |
| `SelectWorldMode.java` | `src/mspacman/SelectWorldMode.ts` | Preserve selection animation, casts, shifts, and input flow. |
| `Stage.java` | `src/mspacman/Stage.ts` | Direct array/data container mapping. |
| `Thing.java` | `src/mspacman/Thing.ts` | Preserve tile math, wrapping, direction helpers, and drawing offset helpers. |

## Asset Ledger

Image assets:

| File | Bytes |
| --- | ---: |
| `images/pack_1.def` | 5,585 |
| `images/pack_1.png` | 11,974 |
| `images/pack_2.def` | 43,234 |
| `images/pack_2.png` | 22,547 |

Music assets:

| File | Bytes |
| --- | ---: |
| `music/act_1.ogg` | 48,156 |
| `music/act_2.ogg` | 122,544 |
| `music/act_3.ogg` | 30,961 |
| `music/game_over.ogg` | 76,584 |
| `music/high_score.ogg` | 208,169 |
| `music/intro.ogg` | 88,005 |
| `music/level_select.ogg` | 38,713 |
| `music/stage_1.ogg` | 661,366 |
| `music/stage_2.ogg` | 454,177 |
| `music/stage_3.ogg` | 293,753 |
| `music/stage_4.ogg` | 432,557 |
| `music/training.ogg` | 162,498 |

Sound-effect assets:

| File | Bytes |
| --- | ---: |
| `soundfx/ate_energizer.ogg` | 10,621 |
| `soundfx/ate_fruit.ogg` | 8,246 |
| `soundfx/ate_ghost.ogg` | 19,996 |
| `soundfx/ate_pellot.ogg` | 8,117 |
| `soundfx/blue_ghosts.ogg` | 40,114 |
| `soundfx/clapping.ogg` | 51,061 |
| `soundfx/died.ogg` | 51,091 |
| `soundfx/extra_life.ogg` | 5,120 |
| `soundfx/fruit_appeared.ogg` | 10,346 |
| `soundfx/pressed_enter.ogg` | 12,877 |
| `soundfx/speaking_1_0.ogg` | 4,842 |
| `soundfx/speaking_1_1.ogg` | 5,088 |
| `soundfx/speaking_1_2.ogg` | 5,065 |
| `soundfx/speaking_1_3.ogg` | 5,057 |
| `soundfx/speaking_1_4.ogg` | 4,957 |
| `soundfx/speaking_1_5.ogg` | 5,071 |
| `soundfx/speaking_1_6.ogg` | 5,033 |
| `soundfx/speaking_1_7.ogg` | 5,117 |
| `soundfx/speaking_1_8.ogg` | 5,028 |
| `soundfx/speaking_1_9.ogg` | 5,008 |
| `soundfx/speaking_2_0.ogg` | 4,904 |
| `soundfx/speaking_2_1.ogg` | 5,070 |
| `soundfx/speaking_2_2.ogg` | 4,916 |
| `soundfx/speaking_2_3.ogg` | 4,991 |
| `soundfx/speaking_2_4.ogg` | 4,993 |
| `soundfx/speaking_2_5.ogg` | 5,005 |
| `soundfx/speaking_2_6.ogg` | 4,940 |
| `soundfx/speaking_2_7.ogg` | 4,967 |
| `soundfx/speaking_2_8.ogg` | 4,937 |
| `soundfx/speaking_2_9.ogg` | 5,109 |

Stage assets:

| File | Bytes |
| --- | ---: |
| `stages/stage_0_0.dat` | 5,244 |
| `stages/stage_0_1.dat` | 5,676 |
| `stages/stage_0_2.dat` | 3,788 |
| `stages/stage_0_3.dat` | 5,532 |
| `stages/stage_0_4.dat` | 3,836 |
| `stages/stage_0_5.dat` | 5,532 |
| `stages/stage_0_6.dat` | 4,172 |
| `stages/stage_0_7.dat` | 5,196 |
| `stages/stage_1_0.dat` | 3,932 |
| `stages/stage_1_1.dat` | 5,964 |
| `stages/stage_1_2.dat` | 3,980 |
| `stages/stage_1_3.dat` | 5,484 |
| `stages/stage_1_4.dat` | 5,532 |
| `stages/stage_1_5.dat` | 8,204 |
| `stages/stage_1_6.dat` | 6,748 |
| `stages/stage_1_7.dat` | 3,884 |
| `stages/stage_2_0.dat` | 4,860 |
| `stages/stage_2_1.dat` | 4,100 |
| `stages/stage_2_2.dat` | 9,068 |
| `stages/stage_2_3.dat` | 5,388 |
| `stages/stage_2_4.dat` | 13,140 |
| `stages/stage_2_5.dat` | 4,908 |
| `stages/stage_2_6.dat` | 5,052 |
| `stages/stage_2_7.dat` | 4,700 |
| `stages/stage_3_0.dat` | 5,388 |
| `stages/stage_3_1.dat` | 6,204 |
| `stages/stage_3_2.dat` | 3,836 |
| `stages/stage_3_3.dat` | 5,436 |
| `stages/stage_3_4.dat` | 4,412 |
| `stages/stage_3_5.dat` | 7,084 |
| `stages/stage_3_6.dat` | 23,980 |
| `stages/stage_3_7.dat` | 5,052 |

Demo assets:

| File | Bytes |
| --- | ---: |
| `demos/demo_0_0.dat` | 4,390 |
| `demos/demo_1_1.dat` | 4,381 |
| `demos/demo_2_2.dat` | 7,539 |
| `demos/demo_3_3.dat` | 3,676 |

## Slick2D-TS Dependencies To Use

The TypeScript Slick2D port already contains two important parity helpers:

- `C:\js-projects\slick2d-ts\src\slick\support\BinaryReader.ts`
  - `read()` returns byte values or `-1`, matching the Java `InputStream.read()` pattern.
  - `readFully(target)` exists for demo byte arrays.
  - `readInt()` reads signed big-endian 32-bit integers, matching `DataInputStream.readInt()`.
- `C:\js-projects\slick2d-ts\src\slick\support\JavaRandom.ts`
  - Uses Java's 48-bit LCG constants.
  - Supports Java-compatible `nextInt()`, `nextInt(bound)`, `nextFloat()`, and `nextBoolean()`.

Required conversion consequence:

- Use `BinaryReader` for stages and demos. Do not hand-parse binary files with ad hoc string conversion.
- Use `JavaRandom` anywhere the Java code uses `java.util.Random`. Do not use `Math.random()` for gameplay, demos, cutscenes, fruit selection, ghost randomness, or intro/world randomization.

## Numeric Semantics Rules

Java and TypeScript differ in ways that matter for this game.

General rules:

- Java `int` is signed 32-bit. TypeScript `number` is IEEE-754 double.
- Java integer division truncates toward zero. Java `5 / 2` is `2`; JS `5 / 2` is `2.5`.
- Java `(int)float` truncates toward zero. Use explicit truncation at every cast site.
- Java bitwise operators already coerce to signed 32-bit in JavaScript, but this should not be used as a casual substitute for all integer arithmetic.
- Java `%` is remainder, not mathematical modulo. JS `%` has the same sign behavior for normal numbers.
- Java `char` is a UTF-16 code unit. In TypeScript, use `charCodeAt()` when indexing the `symbols[...][256]` tables.
- Java arrays are fixed-size reference arrays. TS must initialize all nested arrays explicitly.
- Java `System.arraycopy` copies references or primitive values according to array type. For stage tile maps, copy rows and values deliberately; do not alias mutable row arrays by accident.
- Java `float` is 32-bit. TypeScript numbers are 64-bit. For gameplay fields declared `float`, especially accumulators, use `Math.fround` on assignments and compound updates if deterministic tick parity matters.

Preferred helper concepts for the conversion:

- `intDiv(a, b)`: truncating division toward zero.
- `toInt(value)`: Java-style `(int)` truncation toward zero.
- `toFloat(value)`: Java-style single-precision rounding for fields that were Java `float`.
- `charCode(string, index)`: Java-style `charAt(index)` numeric code when indexing sprite/symbol arrays.

Do not sprinkle these helpers mechanically without understanding the Java source expression. Each use should correspond to a Java `int` division, cast, `char`, or float field assignment.

## Integer And Float Hotspots

### `Thing.java`

Source: `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Thing.java`

Important lines:

- Fields `x`, `y`, `dir`, `sprite`, `spriteIndex` are integer game state.
- Fields `speed` and `speedRemainder` are Java `float`.
- Lines 20-33 use `(y & 15) == 0` and `(x & 15) == 0` to determine whether movement is legal at tile boundaries.
- Lines 42-119 use `x >> 4`, `y >> 4`, wrapping around a 28 by 31 tile map.
- Lines 122-127 calculate render offsets from integer pixel positions.

Conversion rules:

- Keep `x` and `y` as integer pixel coordinates.
- Use bit shifts exactly for tile conversion.
- Preserve tile wrapping around columns `0..27` and rows `0..30`.
- Keep `speedRemainder` as a Java-float-like accumulator.

### `MsPacMan.java`

Source: `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\MsPacMan.java`

Important lines:

- Line 45 calculates speed with float math: `1.25f + 0.5f * main.stageIndex / 7`.
- Lines 96-100 add `speed` into `speedRemainder` and run a `while (speedRemainder >= 1f)` pixel loop.
- Lines 102-114 consume pellets and energizers based on tile type.
- Lines 117-154 preserve input priority in the order up, down, left, right.
- Lines 156-218 update `targetDir`, direction, position, and sprite.
- Lines 220-229 wrap pixel coordinates.
- Lines 250-256 update sprite index counters.
- Lines 266-279 render duplicate sprites at wrap edges.

Conversion rules:

- Do not replace the movement loop with elapsed-time interpolation.
- Do not collapse input priority into a vector.
- Preserve pellet checks after movement steps.
- Use Java-style float rounding around speed accumulation if trace parity drifts.

### `Ghost.java` And Ghost Subclasses

Source: `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Ghost.java`

Important lines:

- Line 9 defines reverse direction mapping.
- Lines 51-70 calculate ghost speed, including red ghost behavior based on pellet fraction.
- Lines 73-78 update sprite counters.
- Lines 80-116 run one-pixel movement loops from `speedRemainder`.
- Lines 142-179 move eyeballs through `homeTree`.
- Lines 231-314 perform random movement and region penalties.
- Lines 316-397 perform chase direction selection using squared distances.
- Line 464 resets speed.

Subclasses:

- `RedGhost.java` lines 21-29 target Ms. Pac-Man directly.
- `PinkGhost.java` lines 21-43 target ahead of Ms. Pac-Man based on direction.
- `CyanGhost.java` lines 21-46 target using Ms. Pac-Man, direction offset, and red ghost vector doubling.
- `OrangeGhost.java` lines 21-31 uses squared distance threshold `16384`.

Conversion rules:

- Preserve direction priority exactly. In chase logic, strict less-than comparisons and evaluation order matter.
- Use `JavaRandom` for all `main.random` calls.
- Preserve eye movement and `homeTree` tile indexing exactly.

### `FruitTarget.java`

Source: `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\FruitTarget.java`

Important lines:

- Lines 40-42 compute `yOffset` using `FastTrig.sin`, a float cast, and an int cast.
- Lines 44-49 update speed remainder and movement.
- Lines 50-75 handle eaten-fruit scoring and state.
- Lines 94 and 216 test tile alignment with `(x & 15) == 0`.
- Lines 168-209 choose entry/exit behavior with `main.random.nextInt(...)`.
- Lines 262-275 calculate exit direction using shifts and wrapping.

Conversion rules:

- Use `Math.trunc` for the Java `(int)` cast on `-sin * sin * 6`.
- Preserve entry/exit random selection using `JavaRandom`.
- Preserve tile wrapping and alignment checks.

### `PlayingMode.java`

Source: `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\PlayingMode.java`

This is the highest-risk gameplay file.

Important lines:

- Lines 21-74 declare the central gameplay fields and arrays.
- Lines 79-88 seed demo mode with `new Random(0xCAFEBABE)` and install `RobotInput`.
- Line 98 computes `pelletCountFraction = 1f / pelletCount`.
- Line 109 copies stage tile rows with `System.arraycopy`.
- Line 115 checks `i == 31` inside a loop where `i < 31`. This looks unreachable but must be preserved.
- Line 183 casts `91 * (3f - 2.75f * main.stageIndex / 7f)` to int for `exitDelayTarget`.
- Line 204 selects stage music with `main.stageIndex & 3`.
- Line 286 casts the blue ghost timer expression to int.
- Line 302 compares `score / 10000` to award extra lives. This is integer division.
- Lines 308-379 count and mutate regions using `>> 4` and wrapping.
- Lines 381-573 contain the main gameplay state machine.
- Lines 561-568 use `main.random.nextFloat()` for fruit spawn checks.
- Lines 595-603 use `nextInt(7)` and `nextInt(fruitTargetEntries.length)` for fruit selection.
- Lines 624-694 render tile/sprite positions with left shifts.

Conversion rules:

- Copy stage arrays by value.
- Preserve the unreachable-looking `i == 31` condition because it is part of source parity.
- Use truncating integer division for the 10,000-point extra-life check.
- Use Java-style int casts for timer calculations.
- Do not change state-machine order.
- Do not turn pellet/region arrays into sparse structures or maps.

### `RobotInput.java`

Source: `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\RobotInput.java`

Important lines:

- Lines 21-34 use byte bit masks for up/down/left/right.
- Line 58 increments the input frame index.

Conversion rules:

- Store demo bytes in `Uint8Array`.
- Preserve `data[index] & mask` behavior.
- Preserve exactly one index increment per update call.

### `Stage.java`

Source: `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Stage.java`

Important lines:

- Lines 4-8 define fixed arrays for `tileMap`, `regionMap`, `homeTree`, `fruitEntry`, and `fruitExit`.

Conversion rules:

- Initialize dimensions exactly: `31 x 28` for tile, region, and home maps.
- Initialize fruit entry and exit maps as the Java source expects.

### `Main.java`

Source: `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Main.java`

Important lines:

- Lines 37-133 define central fields, mode instances, resources, symbols, music, sound effects, and score state.
- Line 86 sets `musicVolumeFadeStep = 1f / 91f`.
- Lines 176-184 run the fixed update loop using `Sys.getTime()` and `Sys.getTimerResolution() / 91`.
- Line 190 creates fade colors with `(255 * i) / (fades.length - 1)`. This is Java integer division.
- Lines 194-215 handle Java fullscreen toggling.
- Lines 318-327 load demos using hardcoded byte lengths.
- Lines 332-381 load stages using `DataInputStream.readInt()` and `read()`.
- Lines 391-397 draw numbers using shifts, modulo, char math, and integer division.
- Lines 411-427 draw strings using Java `charAt`.
- Line 555 uses `(i & 1)` while loading graphics.
- Lines 690-695 build symbol mappings from character ranges.
- Lines 718-792 implement the remote high-score access that must become a placeholder.

Conversion rules:

- The fixed tick loop must preserve Java integer division in `Sys.getTimerResolution() / 91`. If `Sys.getTimerResolution()` is 1000, Java int division gives `10`, not `10.989010...`.
- Fade alpha calculations must use integer division/truncation.
- `drawNumber` must use truncating division for `value /= 10`.
- `drawString` and symbol loading must use numeric character codes, not one-character strings as array indexes.
- Browser fullscreen/menu behavior belongs in the shell, but keep the corresponding Java methods mapped or deliberately adapted.
- High-score methods should keep their signatures and completion flags, but not fetch the missing endpoint.

### `LoadingMode.java`

Source: `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\LoadingMode.java`

Important lines:

- Lines 1-79 define a Java-mode loader that loads music over update ticks.
- Line 67 increments `loadIndex`.
- Line 75 uses float division in the progress bar expression.

Conversion rules:

- Keep `LoadingMode` as a mapped class.
- Browser network/decode retry logic should live in the PWA shell or resource loader.
- `LoadingMode` can use already-fetched resources, but its visible behavior and transition role should remain understandable against the Java source.

### `ScalableGame2.java`

Source: `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\ScalableGame2.java`

Important lines:

- Lines 62-109 calculate target dimensions and offsets.
- Lines 71, 75, and 78 use boolean `&` rather than `&&`.
- Lines 73-84 cast calculated display values to int.
- Lines 122-144 render with safe block, clipping, translating, scaling, push/pop transform, and overlay clear.
- Lines 170-212 calculate mouse scaling.

Conversion rules:

- Keep a mapped `ScalableGame2.ts` in `src/mspacman`.
- It may delegate internally to `slick2d-ts`, but source class identity should remain.
- Preserve truncation at all cast sites.
- Preserve mouse coordinate scaling. Browser canvas coordinates and device pixel ratio must not change game input coordinates.

### Text, Cutscene, And Menu Modes

Files:

- `Act1Mode.java`
- `Act2Mode.java`
- `Act3Mode.java`
- `Act4Mode.java`
- `Act5Mode.java`
- `Act6Mode.java`
- `Act7Mode.java`
- `AttractMode.java`
- `EndingMode.java`
- `EnterInitialsMode.java`
- `HallOfFameMode.java`
- `IntroMode.java`
- `SelectWorldMode.java`

Conversion rules:

- Preserve counters and render order even where the code appears repetitive.
- Preserve character-code logic in `EnterInitialsMode`, `EndingMode`, `HallOfFameMode`, and symbol drawing.
- Use Java-compatible random behavior in `Act5Mode`, `Act7Mode`, and `IntroMode`.
- Preserve modulo animation counters.
- Preserve all timer thresholds and fade increments.

## Binary File Handling

Stage loading:

- Java uses `DataInputStream.readInt()` for counts/coordinates/metadata.
- Java uses `read()` for tile bytes and map bytes.
- TS must use the `slick2d-ts` `BinaryReader.readInt()` and `read()` equivalents.
- The stage parser must validate end-of-file conditions. Silent zero-filling would hide broken assets and destroy parity.

Demo loading:

- Java hardcodes demo lengths in `Main.loadDemo`.
- TS should either preserve those lengths or verify file length matches expected length before assigning the bytes.
- Demo data must be byte-addressable and unsigned at use sites, so `Uint8Array` is appropriate.

## High-Score Placeholder

The old endpoint no longer exists:

- `http://meatfighter.com/cgi-bin/mspacman_scores.py`

Keep:

- `HighScore` class.
- Score arrays and rendering.
- `HallOfFameMode`.
- `EnterInitialsMode`.
- `Main.accessScoresDatabaseAsync` or equivalent mapped method.
- Completion flags used by modes waiting for network results.

Change:

- No remote fetch.
- No blocking wait on unavailable service.
- No unhandled network error.
- Placeholder should provide deterministic local/default high-score rows.
- Submitting initials should complete successfully in the local placeholder path, even if it does not persist.

Do not remove the mode classes just because the network feature is omitted.

## Verification Plan Before And During Conversion

Required parity checks:

- Generate a Java source inventory and a TS inventory. Every Java file in `src\mspacman` must have a corresponding TS file.
- Maintain a conversion ledger. Every Java method and constructor should be marked converted, intentionally adapted, or browser-inapplicable.
- For each browser-inapplicable section, document the reason and where the browser equivalent lives.
- After conversion, grep for raw `/` divisions in gameplay files and classify each as float division, integer division, or visual scaling.
- After conversion, grep for Java cast comments or conversion helpers and confirm every Java `(int)` source site is represented.
- After conversion, grep for `Math.random()` and reject it in game classes.
- Verify random trace output for `JavaRandom(0xCAFEBABE)` against Java `Random(0xCAFEBABE)` for `nextInt(bound)` and `nextFloat`.
- Verify each stage file loads to the same tile map, region map, home tree, and fruit entry/exit values as Java.
- Verify each demo file produces the same input bit sequence as Java.
- Capture deterministic frame traces for at least attract/demo start, first stage start, pellet eating, energizer, ghost eaten, fruit spawn, death, and stage complete.
- Compare trace fields: mode name, frame/tick, score, lives, stage index, Ms. Pac-Man position/direction/target direction/sprite, ghost positions/directions/states, pellet count, timers, fruit state, and current music/sound triggers.
- Run visual screenshot comparisons at fixed ticks once rendering is functional.
- Run audio trigger logging before judging actual playback timing by ear.

Suggested trace-first milestones:

1. Port data classes and binary loaders.
2. Verify stage/demo binary parity.
3. Port input, random, and `Thing`.
4. Port `MsPacMan`, ghosts, fruit, and `PlayingMode`.
5. Produce headless gameplay traces before touching polish.
6. Port mode/cutscene rendering.
7. Add PWA shell, menu, loading, and service worker around the mapped game.
8. Compare screenshots/audio trigger logs.

## Source Risk Index

This section records the broad scan results from the Java source. It is intentionally noisy: some slash matches in string paths are false positives, but each source file's numeric and parity-sensitive areas are captured here so the later conversion audit has a checklist.

| File | Approx. LOC | Methods/ctors found | Numeric/parity markers |
| --- | ---: | ---: | --- |
| `Act1Mode.java` | 293 | 10 | Increment/decrement lines 109, 113, 209, 211, 216, 218, 236, 244, 262; float cast line 124. |
| `Act2Mode.java` | 264 | 21 | Increment/decrement lines 203, 211, 224, 256, 258. |
| `Act3Mode.java` | 239 | 17 | Increment/decrement lines 146, 163, 171, 184, 224, 226. |
| `Act4Mode.java` | 213 | 9 | Increment/decrement lines 92, 95, 139, 147, 160, 198, 200, 204, 206; float cast line 113. |
| `Act5Mode.java` | 246 | 12 | Increment/decrement lines 89, 107, 122, 141, 146, 190, 196, 209; char handling lines 93, 123, 128; random lines 95, 98, 101. |
| `Act6Mode.java` | 209 | 13 | Increment/decrement lines 131, 133, 138, 140, 149, 157, 170. |
| `Act7Mode.java` | 242 | 12 | Increment/decrement lines 89, 107, 122, 141, 146, 185, 191, 204; char handling lines 93, 123, 128; random lines 95, 98, 101. |
| `AppletGameContainer2.java` | 639 | 36 | Java applet/LWJGL container; browser-inapplicable runtime. Numeric target/mouse scaling lines around 516-546 still document adapter behavior. |
| `AttractMode.java` | 318 | 16 | Increment/decrement lines 80, 86, 95, 159, 166, 183, 229, 239, 303, 305; shifts lines 184, 203, 297; modulo line 240; division line 296. |
| `CyanGhost.java` | 49 | 3 | Target coordinate arithmetic lines 28, 31, 34, 37, 40-42. |
| `EndingMode.java` | 558 | 19 | Increment/decrement lines 118, 178, 235, 238, 258, 289, 325, 342, 346, 379, 407, 411; division line 119; float cast line 179; int cast line 328; char lines 329, 380, 386; modulo line 475. |
| `EnterInitialsMode.java` | 181 | 5 | Increment/decrement lines 48, 55, 62, 70, 81, 88, 99, 109, 122, 136, 165; char lines 93, 103, 120, 126, 138, 144; modulo line 166. |
| `FruitTarget.java` | 287 | 5 | Int array line 8; float cast line 40; int cast line 41; increment/decrement lines 48, 79, 113, 116, 119, 122, 126, 128, 130, 132, 138, 145; bitwise-and lines 94, 216; random lines 169, 209; shifts lines 263, 264. |
| `Ghost.java` | 467 | 12 | Int array line 9; increment/decrement lines 73, 75, 84, 125, 128, 131, 164, 167, 170, 173, 187, 190; random lines 99, 231, 248, 260, 272, 284; bitwise-and line 144; division line 464. |
| `HallOfFameMode.java` | 154 | 3 | Increment/decrement lines 45, 51, 59, 69, 79, 85, 124, 125, 134; modulo line 135. |
| `HighScore.java` | 7 | 0 | Small data class; no numeric risk found. |
| `HumanInput.java` | 60 | 12 | Input adapter; no numeric risk found. |
| `IInput.java` | 16 | 0 | Interface. |
| `IMode.java` | 10 | 0 | Interface. |
| `IntroMode.java` | 127 | 5 | Random line 27; increment/decrement lines 50, 56, 72, 78, 112, 114, 119, 121; modulo line 79. |
| `LoadingMode.java` | 79 | 3 | Increment/decrement line 67; float division in progress calculation line 75; slash matches in asset paths are false positives. |
| `Main.java` | 816 | 39 | Random line 66; update-loop division lines 180, 190; int arrays lines 319, 358, 370; shifts lines 391, 402, 414; modulo line 397; char lines 397, 412, 426, 690, 691, 694; bitwise-and line 555; parse-int lines 771, 772; many string-path slash false positives. |
| `MsPacMan.java` | 284 | 8 | Speed division line 45; increment/decrement lines 70, 76, 84, 100, 188, 196, 204, 212, 251, 253; commented RECORD bitwise-or lines 128, 131, 134, 137. |
| `OrangeGhost.java` | 35 | 3 | Distance-threshold coordinate math; no scanner numeric risk found. |
| `PinkGhost.java` | 46 | 3 | Direction-offset coordinate math; no scanner numeric risk found. |
| `PlayingMode.java` | 713 | 20 | Int arrays lines 25-30, 36, 48, 57, 100, 104, 117; random lines 80, 597, 603; increment/decrement lines 86, 108, 110, 127, 188, 232, 252, 271, 291, 304, 351, 376; division lines 98, 181, 182, 183, 286, 302; `System.arraycopy` line 109; int casts lines 183, 286; bitwise-and line 204; shifts lines 310, 311, 336, 337, 360, 361, 606, 609, 611, 614, 628, 634. |
| `RedGhost.java` | 31 | 3 | Direct target coordinate math; no scanner numeric risk found. |
| `RobotInput.java` | 61 | 12 | Bitwise-and lines 22, 26, 30, 34; increment/decrement line 58. |
| `ScalableGame2.java` | 215 | 7 | Division lines 66, 67, 68, 69, 92, 93, 100, 103, 105, 106, 128; float casts lines 67, 175, 176; boolean bitwise-and lines 71, 75, 78, 180, 184, 187; int casts lines 73, 74, 76, 77, 79, 80, 83, 84, 182, 183, 185, 186. |
| `SelectWorldMode.java` | 171 | 4 | Float casts lines 10, 13, 92, 151, 152; division lines 10, 13; increment/decrement lines 63, 65, 71, 76, 84, 90, 100, 107, 150, 153; shift line 98. |
| `Stage.java` | 12 | 0 | Fixed int arrays lines 4-8. |
| `Thing.java` | 135 | 14 | Bitwise-and lines 21, 25, 29, 33; shifts lines 43, 44, 59, 60, 75, 76, 91, 92, 107, 108. |

## Open Questions Before Writing Code

There are no blocking research questions left for the initial conversion.

Implementation choices still to make during conversion:

- Whether the high-score placeholder should be in-memory only or backed by `localStorage`. In-memory is the closest interpretation of "omit high scores for now"; `localStorage` is nicer for users but less faithful to omitting the feature.
- Whether to preload all audio before entering the game or only preload first-use audio and continue decoding later. The total size supports all-audio preload, which is simpler and safer.
- Whether to enforce Java `float` rounding everywhere with `Math.fround` from the first pass or only after trace comparison shows drift. For exact parity, the safer plan is to apply it to gameplay float fields immediately.

## Recommended Next Step

Start conversion with infrastructure and deterministic data:

1. Create the exact `src/mspacman/*.ts` class skeletons.
2. Copy assets into the web static asset tree without renaming.
3. Implement binary loading and Java-random parity first.
4. Verify stages and demos before gameplay code.
5. Port core game logic before browser polish.

This ordering gives us a real parity foundation instead of discovering numeric or binary-data drift after the entire UI exists.
