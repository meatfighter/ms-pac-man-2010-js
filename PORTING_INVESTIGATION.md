# Ms. Pac-Man Web Port Investigation

Date: 2026-08-02

This is an investigation-only report. No TypeScript game implementation was written in this pass.

## Scope

The target is a PWA SPA desktop-browser port of `C:\NetBeansProjects\SlickMsPacMan`, using the TypeScript Slick2D port in `C:\js-projects\slick2d-ts`, with exact Java-to-TypeScript behavioral parity. The port must preserve the Java project structure closely: every Java class must have an accounted TypeScript destination, each class must live in its own file, and the audit must prove that no Java source lines, resources, gameplay behavior, graphics, or audio paths were lost.

Projects inspected:

| Path | Purpose |
| --- | --- |
| `C:\NetBeansProjects\SlickMsPacMan` | Java game to port. |
| `C:\java-projects\slick2d` | Original Java Slick2D dependency. |
| `C:\js-projects\slick2d-ts` | TypeScript Slick2D port intended for the web port. |
| `C:\js-projects\pitfall-js` | Reference for start/menu/volume/audio unlock, hamburger return, resource download retries, and PWA cache busting. |
| `C:\js-projects\worst-mario-game-ever` | Reference for PWA boot splash, animated dots, load failure UI, service worker versioning, and build stamping. |

Separate companion report:

| File | Reason |
| --- | --- |
| `SLICK2D_TS_GAP_ANALYSIS.md` | Required because `slick2d-ts` is not a complete Slick2D port and one direct blocker was found in `PackedSpriteSheet.ts`. |

## Hard Requirements Captured

- Port the Java game to a web PWA SPA for desktop browsers.
- Preserve Java class structure: one class per TS file, with `src/mspacman` mirroring `src/mspacman`.
- Convert all Java logic and behavior, not just user-visible gameplay.
- Copy and account for all resources: images, `.def` atlases, stages, demos, music, and sound effects.
- Preserve resource names, including misspellings such as `ate_pellot.ogg`.
- Use TS formatting with semicolons where possible and 4-space indentation.
- Add a required menu/start screen before game launch so Web Audio is unlocked by a user gesture.
- Add a volume slider on the menu.
- Add an in-game hamburger icon in the upper-left that returns to the menu.
- Add a splash/loading screen with animated dots and a user-visible error state if loading fails.
- Add retrying downloads.
- Add PWA versioning with an incrementable version number.
- Add adjustable timestamp/version query parameters to referenced resource URLs to help clear caches on deployment.

## High-Level Findings

1. The Java game is small enough for class-for-class conversion: 32 Java source files, 8,096 physical source lines, and 184,416 source bytes.
2. The source assets are central to behavior. The 36 stage/demo `.dat` files and two packed sprite `.def` files must be treated as source inputs, not static decoration.
3. `slick2d-ts` contains the game-critical Slick/LWJGL API surface, but it is not a complete port of Java Slick2D. Full details are in `SLICK2D_TS_GAP_ANALYSIS.md`.
4. One `slick2d-ts` issue directly blocks this game: `src/slick/PackedSpriteSheet.ts` parses the `.def` block format incorrectly and would miss most sprites.
5. Browser audio must be started only after a user gesture. `AppGameContainer.start()` calls `SoundStore.get().init()`, so the container itself must be created/launched from the menu Start button or equivalent gesture path.
6. Java `Main.main()` calls `setSoundOn(false)`. This appears to disable sound effects while music is still used. The web port must make an explicit parity decision after testing the original runtime; do not silently enable or disable sound effects.
7. The Java high score endpoint uses insecure HTTP: `http://meatfighter.com/cgi-bin/mspacman_scores.py`. A PWA served over HTTPS cannot call this directly because of mixed-content/CORS constraints. This behavior must be mapped deliberately.

## Java Project Inventory

Source root: `C:\NetBeansProjects\SlickMsPacMan\src`

| Extension | Count | Total bytes |
| --- | ---: | ---: |
| `.java` | 32 | 184,416 |
| `.dat` | 36 | 215,298 |
| `.def` | 2 | 48,819 |
| `.png` | 2 | 34,521 |
| `.ogg` | 42 | 2,935,170 |

Build metadata:

- NetBeans Java SE project name: `SlickMsPacMan`.
- Main class: `mspacman.Main`.
- Java source/target: `1.5`.
- Source encoding: `UTF-8`.
- Dependencies from `nbproject/project.properties`:
  - `../slick/lib/jinput.jar`
  - `../slick/lib/lwjgl.jar`
  - `../slick/lib/natives-win32.jar`
  - `../slick/lib/slick.jar`
  - `../stickvania/lib/jogg-0.0.7.jar`
  - `../stickvania/lib/jorbis-0.0.17.jar`
- JVM native path in project properties contains a curly quote at the end: `run.jvmargs=-Djava.library.path=C:\\NetBeansProjects\\slick;C:\\NetBeansProjects\\slick\\lib` followed by `U+201D`.

## Java Class Conversion Checklist

Line counts below include physical lines and the nonblank/logical count reported by PowerShell `Measure-Object -Line`. The audit should use physical line ranges plus byte/hash checks so blank lines cannot disappear unnoticed.

| Java file | Bytes | Physical lines | Logical lines | Required TS file | Runtime/accounting notes |
| --- | ---: | ---: | ---: | --- | --- |
| `Act1Mode.java` | 7,253 | 292 | 252 | `src/mspacman/Act1Mode.ts` | Cutscene mode; head-on scene, stacked chase, clapper animation. |
| `Act2Mode.java` | 6,470 | 263 | 231 | `src/mspacman/Act2Mode.ts` | Cutscene mode; top-right, bottom-left, middle-right, top-left, bottom-right scenes. |
| `Act3Mode.java` | 5,473 | 238 | 208 | `src/mspacman/Act3Mode.ts` | Cutscene mode; stork carrying/dropping/junior scenes. |
| `Act4Mode.java` | 5,132 | 212 | 186 | `src/mspacman/Act4Mode.ts` | Training cutscene; uses `FastTrig`-style sprite timing. |
| `Act5Mode.java` | 5,825 | 245 | 215 | `src/mspacman/Act5Mode.ts` | Dialog/talking cutscene; uses speaking sound arrays. |
| `Act6Mode.java` | 5,284 | 208 | 178 | `src/mspacman/Act6Mode.ts` | Blue ghost chase cutscene. |
| `Act7Mode.java` | 5,592 | 241 | 210 | `src/mspacman/Act7Mode.ts` | Dialog/talking cutscene, same shape as Act5 but different content/timing. |
| `AppletGameContainer2.java` | 16,326 | 639 | 544 | `src/mspacman/AppletGameContainer2.ts` or an explicit audit-mapped browser replacement | Legacy Java Applet/AWT/LWJGL container. It is not suitable as browser runtime code, but its lines must be mapped to browser container/fullscreen/cursor behavior or to documented Java-platform-only no-ops. |
| `AttractMode.java` | 7,438 | 317 | 277 | `src/mspacman/AttractMode.ts` | Title/attract sequence; demo start and transition to select-world on Enter. |
| `CyanGhost.java` | 1,069 | 48 | 43 | `src/mspacman/CyanGhost.ts` | Ghost targeting: two tiles ahead of Ms. Pac-Man, then vector doubled relative to red ghost. |
| `EndingMode.java` | 12,888 | 557 | 497 | `src/mspacman/EndingMode.ts` | Ending presentation, credits, dialog strings, enemy scenes, fades. |
| `EnterInitialsMode.java` | 4,747 | 180 | 164 | `src/mspacman/EnterInitialsMode.ts` | High-score initials UI; direct `Input.KEY_*` use rather than `IInput`. |
| `FruitTarget.java` | 6,630 | 286 | 265 | `src/mspacman/FruitTarget.ts` | Fruit/red/green energizer path behavior; exit-map usage; point awards. |
| `Ghost.java` | 11,196 | 466 | 416 | `src/mspacman/Ghost.ts` | Shared ghost motion, chase/scatter/blue/eyeball/home movement and rendering. |
| `HallOfFameMode.java` | 4,662 | 153 | 134 | `src/mspacman/HallOfFameMode.ts` | High-score display and attract transition. |
| `HighScore.java` | 104 | 6 | 5 | `src/mspacman/HighScore.ts` | Data class: `score=0`, `initials="AAA"`. |
| `HumanInput.java` | 1,397 | 59 | 44 | `src/mspacman/HumanInput.ts` | Exact keyboard mapping: arrows plus WASD/IJKL/2468, Enter/Space/Escape/P. |
| `IInput.java` | 356 | 15 | 14 | `src/mspacman/IInput.ts` | Interface for human and robot/demo input. |
| `IMode.java` | 282 | 9 | 7 | `src/mspacman/IMode.ts` | Interface for mode lifecycle: `init`, `update`, `render`. |
| `IntroMode.java` | 3,414 | 126 | 109 | `src/mspacman/IntroMode.ts` | Intro animation before gameplay. |
| `LoadingMode.java` | 2,069 | 78 | 72 | `src/mspacman/LoadingMode.ts` | Java in-game loading mode for music/high scores; separate from required web boot splash. |
| `Main.java` | 27,564 | 815 | 737 | `src/mspacman/Main.ts` | Central game state, assets, resources, timing, modes, score DB, rendering helpers. |
| `MsPacMan.java` | 6,673 | 283 | 247 | `src/mspacman/MsPacMan.ts` | Player movement, pellet/energizer collision, speed modifiers, rendering/wrap. |
| `OrangeGhost.java` | 687 | 34 | 29 | `src/mspacman/OrangeGhost.ts` | Ghost targeting: chase unless too close, otherwise bottom-left scatter target. |
| `PinkGhost.java` | 956 | 45 | 40 | `src/mspacman/PinkGhost.ts` | Ghost targeting: four tiles ahead of Ms. Pac-Man in chase. |
| `PlayingMode.java` | 18,605 | 712 | 646 | `src/mspacman/PlayingMode.ts` | Main gameplay; stage maps, scoring, lives, ghosts, fruit, energizers, fade states. |
| `RedGhost.java` | 584 | 30 | 25 | `src/mspacman/RedGhost.ts` | Ghost targeting: Ms. Pac-Man in chase, top-right scatter target. |
| `RobotInput.java` | 1,107 | 60 | 46 | `src/mspacman/RobotInput.ts` | Demo input playback from `.dat` bytes; Enter interrupts demos. |
| `ScalableGame2.java` | 6,820 | 214 | 185 | `src/mspacman/ScalableGame2.ts` | Project-local scaler; `slick2d-ts` has a counterpart, but class-file parity favors a direct mapped file or a line ledger to the dependency file. |
| `SelectWorldMode.java` | 4,759 | 170 | 152 | `src/mspacman/SelectWorldMode.ts` | World select screen and transition to intro/playing. |
| `Stage.java` | 296 | 11 | 10 | `src/mspacman/Stage.ts` | Data class for tile, region, home-tree, exit maps, pellet and region counts. |
| `Thing.java` | 2,758 | 134 | 116 | `src/mspacman/Thing.ts` | Base movable object and tile/type access with map wrapping. |

## Method-Level Source Checklist

Constructors are listed by class name. Overloaded Java methods are intentionally repeated where the source has overloads.

| Java file | Constructors/methods to account for |
| --- | --- |
| `Act1Mode.java` | `init`, `update`, `render`, `updateHeadOn`, `renderHeadOn`, `updateStackedChase`, `updateSpriteIndices`, `renderStackedChase`, `updateClapper`, `renderClapper` |
| `Act2Mode.java` | `init`, `update`, `render`, `initTopRight`, `updateTopRight`, `renderTopRight`, `initBottomLeft`, `updateBottomLeft`, `renderBottomLeft`, `initMiddleRight`, `updateMiddleRight`, `renderMiddleRight`, `initTopLeft`, `updateTopLeft`, `renderTopLeft`, `initBottomRight`, `updateBottomRight`, `renderBottomRight`, `updateClapper`, `renderClapper`, `updateSpriteIndices` |
| `Act3Mode.java` | `init`, `update`, `render`, `initCarrying`, `updateCarrying`, `renderCarrying`, `initDropping`, `updateDropping`, `renderDropping`, `initJunior`, `updateJunior`, `renderJunior`, `updateClapper`, `renderClapper`, `renderFade`, `moveStork`, `renderSprites` |
| `Act4Mode.java` | `init`, `update`, `render`, `initTraining`, `updateTraining`, `renderTraining`, `updateClapper`, `renderClapper`, `renderFade`, `updateSpriteIndices` |
| `Act5Mode.java` | `init`, `update`, `render`, `initString`, `updateString`, `renderString`, `initTalking`, `updateTalking`, `renderTalking`, `updateClapper`, `renderClapper`, `renderFade` |
| `Act6Mode.java` | `init`, `update`, `render`, `initRight`, `updateRight`, `renderRight`, `initLeft`, `updateLeft`, `renderLeft`, `updateSpriteIndices`, `updateClapper`, `renderClapper`, `renderFade` |
| `Act7Mode.java` | `init`, `update`, `render`, `initString`, `updateString`, `renderString`, `initTalking`, `updateTalking`, `renderTalking`, `updateClapper`, `renderClapper`, `renderFade` |
| `AppletGameContainer2.java` | `destroy`, `destroyLWJGL`, `start`, `startLWJGL`, anonymous `run`, `stop`, `init`, `addNotify`, `removeNotify`, `getContainer`, nested `ContainerPanel`, `createDisplay`, nested `Container.start`, `initGL`, nested `Container`, `initApplet`, `isRunning`, `stopApplet`, `getScreenHeight`, `getScreenWidth`, `supportsAlphaInBackBuffer`, `hasFocus`, `getApplet`, `setIcon`, `setMouseGrabbed`, `isMouseGrabbed`, `setMouseCursor` overloads, `get2Fold`, `setIcons`, `setDefaultMouseCursor`, `isFullscreen`, `setDisplayMode`, `setFullscreen`, `runloop`, nested `ConsolePanel` |
| `AttractMode.java` | `init`, `update`, `render`, `initStaring`, `updateStaring`, `renderStaring`, `initBars`, `updateBars`, `updateDots`, `renderBars`, `init2010`, `update2010`, `render2010`, `initFlyingTitle`, `updateFlyingTitle`, `renderFlyingTitle`, private `drawString`, `updateSpriteIndices`, `renderFade` |
| `CyanGhost.java` | `CyanGhost`, `reset`, `updateGhost` |
| `EndingMode.java` | `init`, `update`, `render`, `initPresented`, `updatePresented`, `renderPresented`, `initCredits`, `updateCredits`, `renderCredits`, `initString`, `updateString`, `renderString`, overloaded `renderString`, `initEnemies`, `updateEnemies`, `renderEnemies`, `initText`, `updateText`, `renderText`, `renderFade2`, `renderFade`, `updateSpriteIndices` |
| `EnterInitialsMode.java` | `init`, `update`, `setChar`, `updateStrings`, `render` |
| `FruitTarget.java` | `FruitTarget`, `reset`, `update`, `getExitDirection`, `render` |
| `Ghost.java` | `Ghost`, `getDist`, `update`, `reverseDirection`, `enterHome`, `moveEyeBalls`, `moveInHome`, `moveRandomly`, `chase`, `intersects`, `render`, abstract `updateGhost`, `reset` |
| `HallOfFameMode.java` | `init`, `update`, `render` |
| `HighScore.java` | No methods; public fields `score` and `initials` only. |
| `HumanInput.java` | `HumanInput`, `reset`, `isUp`, `isDown`, `isLeft`, `isRight`, `isEnter`, `isSpace`, `isEscape`, `isPause`, `clearKeyPressedRecord`, `update` |
| `IInput.java` | `reset`, `isUp`, `isDown`, `isLeft`, `isRight`, `isEnter`, `isSpace`, `isEscape`, `isPause`, `clearKeyPressedRecord`, `update` |
| `IMode.java` | `init`, `update`, `render` |
| `IntroMode.java` | `init`, `update`, `render`, `renderFade`, `updateSpriteIndices` |
| `LoadingMode.java` | `init`, `update`, `render` |
| `Main.java` | `Main`, `init`, `update`, `initializeFadeColors`, `fullScreenToggleCheck`, `render`, `advanceStage`, `setMode`, `showMouseCursor`, `hideMouseCursor`, `findNativeDisplayMode`, `loadStages`, `loadDemos`, `loadDemo`, `loadStage`, `drawNumber`, overloaded `drawString`, alpha `draw`, `playSound`, `stopSound`, `stopAllSoundEffects`, `stopAllSounds`, rotate/scale `draw`, `drawScaled`, `fadeMusic`, `stopMusic`, `playMusic`, `loopMusic`, `loadSoundEffects`, `loadGraphics`, `loadSymbols`, `resetNextFrameTime`, `intersects`, `initializeHighScores`, `isHighScore`, `downloadScores`, `accessScoresDatabaseAsync`, async thread `run`, `accessScoresDatabase`, `closeRequested`, static `main` |
| `MsPacMan.java` | `MsPacMan`, `reset`, `update`, `boostSpeed`, `corneringEnhancesSpeed`, `updateSpriteIndexWalled`, `updateSpriteIndexEating`, `render` |
| `OrangeGhost.java` | `OrangeGhost`, `reset`, `updateGhost` |
| `PinkGhost.java` | `PinkGhost`, `reset`, `updateGhost` |
| `PlayingMode.java` | `init`, `reset`, `playerKilled`, `ghostEaten`, `atePellot`, overloaded `ateEnergizer`, `addPoints`, `getRegionCount`, `incrementRegionCount`, `decrementRegionCount`, `update`, `distanceToMsPacMan`, `distance`, `createRedEnergizer`, `createGreenEnergizer`, `createFruit`, `fruitTargetExited`, `render`, `renderFade` |
| `RedGhost.java` | `RedGhost`, `reset`, `updateGhost` |
| `RobotInput.java` | `RobotInput`, `reset`, `isUp`, `isDown`, `isLeft`, `isRight`, `isEnter`, `isSpace`, `isEscape`, `isPause`, `clearKeyPressedRecord`, `update` |
| `ScalableGame2.java` | overloaded `ScalableGame2`, `init`, `update`, `render`, `renderOverlay`, `closeRequested`, `getTitle`, `containerSizeChanged` |
| `SelectWorldMode.java` | `init`, `update`, `render`, `renderFade` |
| `Stage.java` | No methods; public fields only. |
| `Thing.java` | `Thing`, `canMoveLeft`, `canMoveRight`, `canMoveUp`, `canMoveDown`, `getMsPacManDistance`, `getHomeDirection`, `getTile`, `setTile`, `getType`, `setType`, overloaded `draw`, abstract `update`, abstract `render` |

## Important Java Behavior To Preserve

### `Main`

- Extends `BasicGame`.
- Direction constants: `UP=0`, `DOWN=1`, `LEFT=2`, `RIGHT=3`.
- Color constants: `RED=0`, `PINK=1`, `CYAN=2`, `ORANGE=3`, `WHITE=4`, `YELLOW=5`.
- Static mode instances: attract, select-world, intro, playing, act1 through act7, ending, hall-of-fame, loading, enter-initials.
- Global state includes `Random random = new Random()`, display mode fields, current music, input, score/lives/world/stage, high-score matrix, demo state, all sprite arrays, music fields, and sound fields.
- `init` sequence: print thread name, find native display mode, initialize high scores and fade colors, load graphics, load sound effects, load stages, load demos, create `HumanInput`, then `setMode(loadingMode, gc)`.
- `update` has a fixed-step loop:
  - Music fade step is `1f / 91f`.
  - Pause toggles on `P`; while paused, `gc.setMusicOn(false)` and a pause overlay is rendered.
  - Logic loop condition is `while(nextFrameTime < Sys.getTime())`.
  - Next frame time increments by `Sys.getTimerResolution() / 91`. Because Java integer division is involved, this may be 10 ms if the LWJGL timer resolution is 1000. The TS port must deliberately preserve or verify this, not assume `1000 / 91` floating-point behavior.
  - Maximum catch-up count is 8; if exceeded, `resetNextFrameTime()`.
- Fullscreen toggle:
  - Space toggles fullscreen/windowed.
  - Escape exits fullscreen only.
  - Java has separate `AppletGameContainer2` and `AppGameContainer` paths.
  - Cursor is hidden with an empty native cursor and restored with the previous cursor.
- `render` delegates to the current mode and renders a black pause overlay with `PAUSED`.
- Stage advancement maps stages 1 through 7 to Act1 through Act7 and stage 8 to Ending.
- `setMode` calls `mode.init`, then immediately `mode.update`, clears key-pressed records, and resets frame time.
- Rendering helpers use glyph sprite arrays and `GL11.glPushMatrix`, `glTranslatef`, `glScalef`, and `glRotatef`.
- `stopSound(Sound sound)` ignores the parameter and always stops `blueGhostsSound`. This is a Java behavior/bug that must be preserved or explicitly marked in the audit.
- `playMusic`/`loopMusic` stop current music, reset volume to 1, set current, skip playback in demo mode, then restore the volume.
- High scores:
  - Default high scores are 4 worlds x 5 rows, all `AAA`/`0`.
  - Download/upload endpoint is `http://meatfighter.com/cgi-bin/mspacman_scores.py`.
  - Upload query parameters are `world`, `score`, and `initials`.
  - Response parser expects CSV fields `world,score,initials`.
  - Errors are swallowed.
  - Upload is async via `new Thread`; `uploadComplete` is volatile.
- Java `main` creates `ScalableGame2(main, 800, 600, true)`, `AppGameContainer`, sets display 800x600, always render true, vsync true, smooth deltas false, show FPS false, sound off false, clear each frame true, then starts.

### `LoadingMode`

This is a Java in-game mode, not the new web boot splash. It must still be ported.

- `loadIndex` starts at 14.
- Update cases load or trigger:
  - 14: no operation.
  - 13: `main.downloadScores()`.
  - 12: `level_select.ogg`.
  - 11: `game_over.ogg`.
  - 10: `high_score.ogg`.
  - 9: `intro.ogg`.
  - 8: `training.ogg`.
  - 7: `stage_4.ogg`.
  - 6: `stage_3.ogg`.
  - 5: `stage_2.ogg`.
  - 4: `stage_1.ogg`.
  - 3: `act_3.ogg`.
  - 2: `act_2.ogg`.
  - 1: `act_1.ogg`.
  - 0: set mode to attract.
- After each case: decrement `loadIndex` and call `main.resetNextFrameTime()`.
- Render draws a white rectangle at `(328,276,144,48)`, blue progress fill width `143 * (1f - loadIndex / 14f)`, and red `LOADING` at `(344,292)`.

### `PlayingMode`

- Constants: `FADE_NONE=0`, `FADE_IN=1`, `FADE_OUT=2`; fade reasons killed/advance/game-over; tile types empty/pellot/energizer/wall.
- In demo mode:
  - Replace random with `new Random(0xCAFEBABE)`.
  - Use `robotInputs[demoIndex]`.
  - Reset robot input.
  - Set `stageIndex` and `worldIndex` to `demoIndex`.
  - Set lives to 5.
  - Increment `demoIndex` modulo 4.
- Stage setup:
  - Uses `main.stages[worldIndex][stageIndex]`.
  - Stage message is `STAGE N OF 8`.
  - Copies `stage.tileMap` to mutable `tileMap`.
  - Builds `typeMap` from tile IDs 47 empty, 48 pellot, 49 energizer, all others wall.
  - Collects fruit target entries on map edge where `regionMap[i][j] > 0`.
  - Java has boundary checks using `i == 31` even though `i < 31`, and later `entry[1] == 31`; these impossible branches must be preserved or explicitly documented.
- Reset state:
  - `exitIndex=1`; ghosts exit one at a time until 4.
  - `readyTimer=91`.
  - `fruitOdds = 0.5f - 0.25f * stageIndex / 7f`.
  - `redPelletOdds = fruitOdds / 2f`.
  - `exitDelayTarget = (int)(91 * (3f - 2.75f * stageIndex / 7f))`.
  - Resets Ms. Pac-Man, ghosts, and fruit target.
  - Starts looping `stageMusic[stageIndex & 3]`.
- Game loop:
  - Demo Enter exits to SelectWorldMode.
  - Game-over display holds for `5 * 91` updates.
  - Fade-in/out blocks normal gameplay.
  - Ready state blocks gameplay until timer reaches 0.
  - Finished stage toggles white maze every 23 updates and advances after 600 updates.
  - Player death fades music for 91 updates, plays death sound, spirals for `91 * 2`, then resets or shows game over.
  - Energizer visibility toggles every 23 updates.
  - Blue-ghost blink offset is 2 at timers `<=22`, `45..67`, `91..113`, `135..157`.
  - Chase/scatter toggles between 7*91 scatter and 20*91 chase; leaving chase reverses non-eyeball ghosts.
  - Fruit/red/green energizer opportunity occurs every `10 * 91` updates.
  - Red energizer gives blue ghosts for `2 * 91`.
  - Green energizer boosts Ms. Pac-Man speed.
- Render:
  - Maze offset is `(176,48)` with 16px tiles.
  - Actor sprite offset is `(168 + x, 40 + y)` with 32px sprites.
  - Black bars surround the maze.
  - Score at `(176,16)`, stage message at `(400,16)`, lives and fruit icons along bottom.
  - `GAME OVER` is shown for demo mode and actual game-over; `READY!` during ready timer.

### `Thing`, `MsPacMan`, `Ghost`, and `FruitTarget`

- Map dimensions are 28 columns x 31 rows.
- Position units are pixels; tile coordinate is `x >> 4`, `y >> 4`.
- Java bitwise alignment checks such as `(x & 15) == 0` must map to integer bitwise behavior in TS.
- Wrapping:
  - X wraps at `448` and `-32`.
  - Y wraps at `496` and `-32`.
- Ms. Pac-Man:
  - Reset position `(13*16+8, 23*16)`, direction left.
  - Speed is `1.25 + 0.5 * stageIndex / 7`.
  - Sprite pattern is `{0,1,2,1}` with `CHOMP_SPEED=6`.
  - Input priority is up, down, left, right.
  - Pellet dampens speed by 10% for 10 update ticks.
  - Cornering enhances speed by 10% for 10 update ticks.
  - Blue ghosts add 10% speed.
  - Green energizer adds 60% speed for `7 * 91`.
- Ghost:
  - Base speed is `1 + 0.3 * stageIndex / 7`.
  - In home, blue, or out-of-bounds speed is 0.5.
  - Red ghost accelerates as pellets are eaten but caps at `1.01 * mspacman.speed`.
  - Eyeballs speed is 1.5 unless entering home, then 0.5.
  - Random blue movement uses `main.random.nextInt(7919)` and a 10,000,000 region-occupancy penalty.
  - Chase movement minimizes squared distance to target with the same occupancy penalty.
- Ghost target rules:
  - Red: chase Ms. Pac-Man; scatter target `(28*16, -1*16)`.
  - Pink: chase four tiles ahead; scatter target `(-1*16, -1*16)`.
  - Cyan: chase two tiles ahead, then double vector from red ghost; scatter target `(28*16, 31*16)`.
  - Orange: chase Ms. Pac-Man unless distance is `< 16384`, then bottom-left; scatter bottom-left.
- FruitTarget:
  - Speed 0.5.
  - Vertical bob uses `FastTrig.sin`, `yOffset = 3 + (int)(-sin * sin * 6)`, angle increments by 0.1.
  - Collision distance `< 400`.
  - Points by fruit index: 100, 200, 500, 700, 1000, 2000, 5000.
  - After being eaten, holds points for 91 update ticks.
  - Uses `homeTree`, `leftExitMaps`, and `rightExitMaps` for pathing.

## Asset Inventory

All assets below must be copied byte-for-byte or transformed only with a documented conversion and hash ledger. The simplest parity path is to copy them unchanged under web-served resource paths that preserve Java resource names: `images/...`, `stages/...`, `demos/...`, `music/...`, `soundfx/...`.

### Images and Atlases

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `images/pack_1.def` | 5,585 | `5A174049BFD8A192A3BC73C0722B93133774C50FABAE38C62A09CEE5511A25A1` |
| `images/pack_1.png` | 11,974 | `3321B2C50402383D1B1D72ECA6AD0D79119C619399BA1E2ABA53C8A86A2880A9` |
| `images/pack_2.def` | 43,234 | `B6C4A39F3E52BAC105E7377C45F3B7383D84D0DD3CC6B4DC6D5733CBC1DFA445` |
| `images/pack_2.png` | 22,547 | `5272C2B16395B45F483CEC7C0FD0A6B2C095DDE98B62998D0979C2B06C18BB6E` |

Correct Java-style `.def` parsing results:

| Atlas | Entries in `.def` | Referenced by `Main.loadGraphics` | Missing referenced entries | Unused entries |
| --- | ---: | ---: | ---: | --- |
| `pack_1.def` | 93 | 88 | 0 | 5 |
| `pack_2.def` | 744 | 699 | 0 | 45 |

Unused `pack_1` entries that must still be copied/accounted:

- `eyes_down_2`
- `eyes_left_2`
- `eyes_right_2`
- `eyes_up_2`
- `white_ghost_2`

Unused `pack_2` entries that must still be copied/accounted:

- `symbol_0` through `symbol_9`
- `symbol_a`, `symbol_b`, `symbol_c`, `symbol_d`, `symbol_e`, `symbol_f`, `symbol_g`, `symbol_h`, `symbol_i`, `symbol_j`, `symbol_k`, `symbol_l`, `symbol_m`, `symbol_n`, `symbol_o`, `symbol_p`, `symbol_q`, `symbol_r`, `symbol_s`, `symbol_t`, `symbol_u`, `symbol_v`, `symbol_w`, `symbol_x`, `symbol_y`, `symbol_z`
- `symbol_colon`, `symbol_comma`, `symbol_copyright`, `symbol_exclamation`, `symbol_forward_slash`, `symbol_hyphen`, `symbol_left_quote`, `symbol_period`, `symbol_right_quote`

### Music

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

### Sound Effects

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

### Demos

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `demos/demo_0_0.dat` | 4,390 | `81888E0D55FD0B30B67911DEA02B5B5408F9FC219207272C98ACFD048D1CDC84` |
| `demos/demo_1_1.dat` | 4,381 | `0DECDE22017F668240460012770EB4453166E0D98CBC6013297693369E6B5DFB` |
| `demos/demo_2_2.dat` | 7,539 | `3C14B3E494224FA382F4FBB053A010122FDBDBC9296AB89AC9DB4CBFED6904B4` |
| `demos/demo_3_3.dat` | 3,676 | `342BFEE6AD664E1E491DEF48BC43075CB8D3527EB9BAE0A7582564FB3E494194` |

### Stage Binary Format

Java parser: `Main.loadStage`.

Byte order: Java `DataInputStream`, big-endian.

Layout per stage file:

1. `int pelletCount`
2. `int regionCount`
3. 31 x 28 signed byte `tileMap`
4. 31 x 28 signed byte `regionMap`
5. 31 x 28 signed byte `homeTree`
6. `int leftExitMapCount`
7. For each left exit map: `int size`, then `size` records of `int x`, `int y`, `int direction`; direction is stored at `[y][x]`.
8. `int rightExitMapCount`
9. For each right exit map: same shape as left.

All 32 stage files were parsed to exact EOF with this format.

| Stage file | Bytes | Pellets | Regions | Left maps | Left entries | Right maps | Right entries | Exact EOF |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `stage_0_0.dat` | 5,244 | 224 | 65 | 4 | 106 | 4 | 110 | true |
| `stage_0_1.dat` | 5,676 | 250 | 61 | 4 | 124 | 4 | 128 | true |
| `stage_0_2.dat` | 3,788 | 249 | 72 | 2 | 47 | 2 | 49 | true |
| `stage_0_3.dat` | 5,532 | 250 | 65 | 4 | 118 | 4 | 122 | true |
| `stage_0_4.dat` | 3,836 | 244 | 59 | 2 | 49 | 2 | 51 | true |
| `stage_0_5.dat` | 5,532 | 246 | 53 | 4 | 118 | 4 | 122 | true |
| `stage_0_6.dat` | 4,172 | 244 | 60 | 2 | 63 | 2 | 65 | true |
| `stage_0_7.dat` | 5,196 | 254 | 81 | 4 | 104 | 4 | 108 | true |
| `stage_1_0.dat` | 3,932 | 230 | 59 | 2 | 53 | 2 | 55 | true |
| `stage_1_1.dat` | 5,964 | 238 | 63 | 4 | 136 | 4 | 140 | true |
| `stage_1_2.dat` | 3,980 | 206 | 46 | 2 | 55 | 2 | 57 | true |
| `stage_1_3.dat` | 5,484 | 222 | 57 | 4 | 116 | 4 | 120 | true |
| `stage_1_4.dat` | 5,532 | 222 | 68 | 4 | 118 | 4 | 122 | true |
| `stage_1_5.dat` | 8,204 | 206 | 61 | 8 | 226 | 8 | 234 | true |
| `stage_1_6.dat` | 6,748 | 214 | 62 | 6 | 167 | 6 | 173 | true |
| `stage_1_7.dat` | 3,884 | 238 | 60 | 2 | 51 | 2 | 53 | true |
| `stage_2_0.dat` | 4,860 | 240 | 64 | 4 | 99 | 4 | 85 | true |
| `stage_2_1.dat` | 4,100 | 237 | 65 | 2 | 61 | 2 | 61 | true |
| `stage_2_2.dat` | 9,068 | 8 | 82 | 8 | 288 | 8 | 244 | true |
| `stage_2_3.dat` | 5,388 | 198 | 68 | 4 | 112 | 4 | 116 | true |
| `stage_2_4.dat` | 13,140 | 252 | 70 | 10 | 359 | 10 | 511 | true |
| `stage_2_5.dat` | 4,908 | 254 | 78 | 4 | 92 | 4 | 96 | true |
| `stage_2_6.dat` | 5,052 | 16 | 78 | 4 | 98 | 4 | 102 | true |
| `stage_2_7.dat` | 4,700 | 8 | 77 | 2 | 85 | 2 | 87 | true |
| `stage_3_0.dat` | 5,388 | 251 | 68 | 4 | 108 | 4 | 120 | true |
| `stage_3_1.dat` | 6,204 | 234 | 60 | 4 | 146 | 4 | 150 | true |
| `stage_3_2.dat` | 3,836 | 4 | 52 | 2 | 49 | 2 | 51 | true |
| `stage_3_3.dat` | 5,436 | 216 | 52 | 4 | 114 | 4 | 118 | true |
| `stage_3_4.dat` | 4,412 | 234 | 62 | 2 | 73 | 2 | 75 | true |
| `stage_3_5.dat` | 7,084 | 222 | 60 | 6 | 181 | 6 | 187 | true |
| `stage_3_6.dat` | 23,980 | 242 | 40 | 24 | 870 | 24 | 894 | true |
| `stage_3_7.dat` | 5,052 | 14 | 58 | 4 | 92 | 4 | 108 | true |

## Reference PWA Findings

### `pitfall-js`

Files inspected:

- `src/bootstrap.ts`
- `src/app.ts`
- `src/progress.ts`
- `src/download.ts`
- `src/start.ts`
- `src/audio.ts`
- `src/screen.ts`
- `src/input.ts`
- `src/sw.ts`
- `public_html/app/app.html`
- `public_html/app/styles/app.css`
- `public_html/app/manifest.json`

Patterns to reuse:

- `src/start.ts` renders a start menu containing a range input volume slider and Start/New Game/Continue buttons.
- `startButtonClicked` and `continueButtonClicked` call `setVolume(store.volume)` during a user gesture before entering the game screen.
- `src/audio.ts` uses a single `AudioContext`, a `masterGain`, `setVolume(volume / 100)`, `resume()` after suspended state, visibility suspend/resume, and `stopAll()` on suspend.
- `src/screen.ts` creates the canvas only when entering the game and cleans up when returning to the menu.
- `src/screen.ts` draws a hamburger icon as three white lines and `src/input.ts` treats the upper-left 64 x 64 region as the hamburger hit target. Click/touch in that region calls `exit()` and returns to the start menu.
- `src/download.ts` retries fetches 5 times, requires a valid `Content-Length`, reads via `ReadableStream`, and reports byte progress.
- `src/sw.ts` uses a versioned cache name (`pitfall-cache-2025-01-25`), retries fetches 5 times in the service worker, caches successful responses, and posts download progress for `resources.zip`.
- `public_html/app/app.html` appends `?v=2025-01-25` to CSS, bootstrap JS, and service worker registration.

Differences for this port:

- Ms. Pac-Man is desktop-browser focused, so no portrait rotation is required unless chosen for compatibility.
- Ms. Pac-Man should not use a packed `resources.zip` unless we deliberately choose that distribution model. Direct file preloading with retry and original Java resource keys is simpler for Slick2D parity.
- Pitfall's menu is original-web-app style. Ms. Pac-Man should use the same functional pattern but avoid adding non-Java gameplay options.

### `worst-mario-game-ever`

Files inspected:

- `version.json`
- `scripts/stamp.mjs`
- `scripts/build-utils.mjs`
- `pwa/vite.config.ts`
- `pwa/index.html`
- `pwa/src/main.ts`
- `pwa/src/app/App.ts`
- `pwa/src/app/ServiceWorkerRegistrar.ts`
- `pwa/src/scenes/LoadingScene.ts`
- `pwa/public/sw.js`
- `pwa/public/manifest.webmanifest`
- `pwa/src/styles/app.css`

Patterns to reuse:

- Root `version.json` stores an incrementable `version` and a `buildStamp` timestamp.
- `scripts/stamp.mjs` updates `buildStamp` with `new Date().toISOString()`.
- Vite `transformIndexHtml` replaces `%APP_VERSION%` and `%BUILD_STAMP%`.
- HTML uses versioned URLs such as `manifest.webmanifest?v=%BUILD_STAMP%` and icon URLs with the same query.
- `ServiceWorkerRegistrar.ts` registers `sw.js?v=${__APP_VERSION__}-${__BUILD_STAMP__}` and skips service workers in dev/file mode.
- `public/sw.js` reads `v` from its own URL query and uses it in `CACHE_NAME`.
- `index.html` has an inline boot screen with CSS animated dots before the app module loads.
- `index.html` has a boot failure state triggered by module `onerror` or a custom failure event.
- `LoadingScene.ts` renders animated dots in the canvas once the app has mounted, and renders a user-visible failure message if `App.load()` throws.

Differences for this port:

- Ms. Pac-Man needs both boot-layer dots and a Java-equivalent `LoadingMode`; they are distinct. The boot-layer dots cover PWA module load and resource preload; Java `LoadingMode` covers the original mode sequence and must still be reached.
- The Mario service worker does not include retry logic; Pitfall's service worker does. Ms. Pac-Man should combine Mario's versioned cache naming with Pitfall's retry behavior.

## Required Web Architecture

Suggested file layout:

| Area | Files/directories |
| --- | --- |
| Java game parity | `src/mspacman/*.ts`, one per Java class. |
| Browser/PWA shell | `src/pwa/StartMenu.ts`, `src/pwa/ResourcePreloader.ts`, `src/pwa/ServiceWorkerRegistrar.ts`, `src/pwa/VolumeStore.ts`, `src/pwa/BootFailure.ts` or equivalent. |
| Entry | `src/main.ts`. |
| Static PWA | `index.html`, `public/manifest.webmanifest`, `public/sw.js`, `public/icons/*`. |
| Versioning | `version.json`, `scripts/stamp.mjs`, build-time constants for `APP_VERSION` and `BUILD_STAMP`. |
| Java resources | `public/images`, `public/stages`, `public/demos`, `public/music`, `public/soundfx` or equivalent paths that preserve Java resource refs. |
| Audit outputs | `audit/java-to-ts-map.csv`, `audit/resources.json`, `audit/stage-parse.json`, `audit/sprite-atlas.json`, `audit/runtime-snapshots/*`. |

Runtime sequence required for Web Audio and loading:

1. HTML displays boot splash with animated dots before JS module load.
2. App module mounts; failure before mount triggers HTML error UI.
3. App shows menu first, not the game.
4. User adjusts volume slider if desired.
5. User presses Start.
6. Start handler resumes/creates Web Audio context and applies volume.
7. App enters loading/preload screen with animated dots and progress if available.
8. Resource preloader fetches Java resources with retry and timestamp query parameters.
9. Preloader registers bytes into `ResourceLoader` under original Java keys such as `images/pack_1.def`.
10. Only after preload succeeds should the Slick container and `Main` initialize.
11. Java `Main.init` runs and enters Java `LoadingMode`.
12. When in-game, hamburger icon is drawn in upper-left and hit-tested to stop the container, stop audio, and return to the menu.

## Cache Busting and PWA Versioning

Required pattern:

- Keep a root `version.json` with at least `version` and `buildStamp`.
- Increment `version` for releases; update `buildStamp` for each build/deploy.
- Inject `APP_VERSION` and `BUILD_STAMP` into the bundle and HTML at build time.
- Append a timestamp/version query parameter to all resource URLs. Use a single value such as `v=${encodeURIComponent(APP_VERSION + "-" + BUILD_STAMP)}`.
- Register the service worker with the same query parameter: `sw.js?v=...`.
- Service worker cache name must include the version query value.
- On activation, delete old cache names for this app.
- Do not cache failed responses.
- For navigation requests, use network-first with offline fallback to `index.html`.
- For resources, use cache-first or stale-while-revalidate, but ensure query changes produce fresh cache entries.

Important Slick2D integration detail:

- `ResourceLoader.registerResource(ref, data)` stores bytes under the Java resource key.
- The fetch URL may be `images/pack_1.def?v=...`, but the registered key must be `images/pack_1.def`, because Java code constructs `PackedSpriteSheet("images/pack_1.def", ...)`.

## Slick2D TS Dependency Status

Game-critical APIs present in `slick2d-ts`:

- `AppGameContainer`, `BasicGame`, `Game`, `GameContainer`, `Graphics`, `Color`
- `Image`, `PackedSpriteSheet`, `SpriteSheet`, `Music`, `Sound`
- `Input`, `InputListener`, key constants used by the game
- `ScalableGame2`
- `ResourceLoader`, `FastTrig`, `Log`
- `SoundStore`
- `Display`, `DisplayMode`, `GL11`, `Sys`, `Mouse`, `Cursor`, `BufferUtils`
- `BinaryReader` and `JavaRandom` under `slick/support`

Direct blocker:

- `PackedSpriteSheet.ts` currently parses the Java `.def` format incorrectly. Correct Java-style parsing sees 93 and 744 entries in the two atlases. Current TS parser rhythm sees only 24 and 107 entries, causing `Main.loadGraphics` to fail. See `SLICK2D_TS_GAP_ANALYSIS.md`.

Other game-relevant risks:

- Web Audio context must not be initialized before the menu gesture.
- `ResourceLoader.loadResource` has no retry or timestamp query support by itself.
- `AppGameContainer.start()` awaits `ResourceLoader.waitForAll()` after `game.init`, but `PackedSpriteSheet` requires `.def` bytes synchronously during `Main.init`; therefore all `.def`, image, demo, and stage bytes must already be registered before constructing the game container or before `Main.init` executes.
- `Music` and `Sound` constructors queue resource loads asynchronously. The preload step must include all audio files and wait for decode/load completion before gameplay can be considered loaded.
- Unsupported Slick2D drawing methods such as `Graphics.drawOval` are not used by this game.

## High-Score Endpoint Plan

The Java behavior cannot be used directly from an HTTPS PWA because the endpoint is HTTP:

- `http://meatfighter.com/cgi-bin/mspacman_scores.py`

Parity options:

| Option | Parity impact | Deployment impact |
| --- | --- | --- |
| Keep direct HTTP fetch only when app is served over HTTP/local | Closest to Java when allowed, fails on HTTPS PWA. | Not viable for production HTTPS alone. |
| Add an HTTPS proxy preserving request/response shape | Best behavior parity if proxy exactly forwards and returns same CSV. | Requires server/cloud endpoint. |
| Local-only high scores fallback | Preserves UI flow but not global high-score behavior. | Works offline and in PWA, but not exact network parity. |

The report recommendation is to implement the Java request/parse behavior behind a `HighScoreService` equivalent, with direct HTTP/proxy/local fallback selected by environment and documented in the audit.

## Audit Plan For Perfect Parity

Required audit artifacts:

- `audit/java-source-inventory.json`: Java file paths, bytes, physical lines, logical lines, hashes.
- `audit/java-to-ts-map.csv`: every Java line range mapped to TS line range or explicit platform-replacement rationale.
- `audit/class-method-checklist.json`: class names, fields, constructors, methods, static initializers, and TS counterparts.
- `audit/resources.json`: every Java resource path, bytes, SHA-256, copied path, copied hash.
- `audit/sprite-atlas.json`: parsed `.def` entries, referenced sprite keys, unused-but-present keys, missing keys.
- `audit/stage-parse.json`: parsed stage structure and EOF validation for all stage `.dat` files.
- `audit/demo-parse.json`: demo byte lengths and hashes.
- `audit/runtime-snapshots`: deterministic per-update snapshots from Java and TS.
- `audit/screenshots`: pixel comparison frames at known mode/update counts.
- `audit/audio-events.json`: sound/music play/loop/stop/fade event sequence by update frame.

Static checks:

- Every Java source file must have one TS file or an explicit line-ledger mapping to a browser replacement.
- Every Java class/interface must have a TS class/interface with the same responsibility.
- Every Java field must be mapped to a TS field, property, or explicit replacement.
- Every Java method must be mapped.
- Java comments that describe behavior, disabled recording code, or bugs must be preserved or acknowledged in the ledger.
- Every Java numeric literal must be preserved unless the ledger explains a Java/TS type conversion.
- Every Java integer division and cast must be handled explicitly. Use `Math.trunc`/bitwise behavior where Java truncation matters.
- Every array initialization size must match.
- Every resource string must match original Java resource keys.

Runtime checks:

- Preload all resources and assert no missing `ResourceLoader` keys.
- Parse all 32 stage files and assert exact EOF.
- Parse both `.def` files and assert entry counts 93 and 744.
- Instantiate `Main`, call `init`, and assert initial mode is Java `LoadingMode`.
- Step Java `LoadingMode` through all 15 load indices and compare loaded music references and mode transitions.
- Run demo mode with `Random(0xCAFEBABE)` and recorded `.dat` input; compare update-by-update state snapshots for mode, score, lives, world, stage, player position/direction, ghost states, timers, pellets remaining, and random-dependent events.
- Capture known frames at 800x600 and compare rendered canvas pixels.
- Verify audio event order for pellet, energizer, blue ghosts, fruit, death, clapping, act music, stage music, game-over, high-score, level-select, intro, and training.
- Verify pause behavior, fullscreen toggle behavior, and hamburger return behavior.

## Conversion Order

1. Fix or wrap `slick2d-ts` blockers, especially `PackedSpriteSheet` parsing.
2. Create the PWA shell, version file, service worker, boot splash, menu, volume store, and retrying resource preloader.
3. Copy assets byte-for-byte and generate resource hash/audit manifests.
4. Port data interfaces/classes: `HighScore`, `Stage`, `IInput`, `IMode`.
5. Port inputs: `HumanInput`, `RobotInput`.
6. Port base game objects: `Thing`, `MsPacMan`, `Ghost`, specific ghosts, `FruitTarget`.
7. Port `PlayingMode`.
8. Port display modes: `LoadingMode`, `AttractMode`, `SelectWorldMode`, `IntroMode`, `HallOfFameMode`, `EnterInitialsMode`.
9. Port cutscenes: `Act1Mode` through `Act7Mode`, `EndingMode`.
10. Port `Main`.
11. Port or audit-map `ScalableGame2` and `AppletGameContainer2`.
12. Run static source/resource audit.
13. Run deterministic runtime snapshot audit.
14. Run screenshot/audio audit.
15. Package PWA and validate offline/cache behavior.

## Non-Negotiable Porting Details

- Preserve Java's `float` behavior where it affects gameplay. TS uses double precision; use `Math.fround` only where tests show Java float rounding matters.
- Preserve Java `Random` behavior. Use `slick/support/JavaRandom` or an exact local equivalent, and verify seeded sequences.
- Preserve Java signed-byte reading for stage maps and unsigned-style demo bit checks.
- Preserve Java map wrapping and integer shifts.
- Preserve the `pellot` spelling in fields/resource names if present.
- Preserve disabled recording blocks in comments or audit ledger because they explain `.dat` demo generation.
- Do not replace the mode system with a modern scene framework unless each Java mode/class still exists and the ledger proves equivalence.
- Do not merge multiple Java classes into one TS file.
- Do not convert sprite atlases into new generated sheets unless the audit proves exact subimage parity.
- Do not normalize the high-score initials/string rendering to browser fonts; the Java game uses sprite glyphs.
- Do not add new gameplay settings on the menu except required start and volume controls.

## Open Decisions

| Decision | Why it matters | Required resolution before implementation signoff |
| --- | --- | --- |
| `setSoundOn(false)` in Java `main` | May disable all sound effects in original desktop run while music remains. | Run original game or inspect Slick2D `SoundStore` behavior to decide whether web parity means sound effects off by default or whether this was an old deployment workaround. |
| High-score endpoint | HTTP endpoint is blocked in HTTPS PWA. | Choose direct HTTP/local/proxy strategy and document exact behavior. |
| `AppletGameContainer2` mapping | Java source must be accounted, but applets/AWT do not exist on the web. | Decide whether to direct-port as a browser shim file or ledger all lines to PWA/container replacements. |
| Timing truncation | Java `Sys.getTimerResolution() / 91` is integer division. | Confirm actual LWJGL timer resolution and compare runtime cadence before selecting TS timing. |
| Audio decode timing | Web Audio is async; Java Slick constructors appear synchronous from game perspective. | Preload and wait before `Main.init`/gameplay; verify no play call happens before a buffer is ready. |
