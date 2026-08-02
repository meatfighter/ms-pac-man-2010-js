# Slick2D Java vs TypeScript Reaudit 10 for SlickMsPacMan

Date: 2026-08-02

## Scope

This audit compares the Java Slick2D implementation at `C:\java-projects\slick2d\Slick\src\org\newdawn\slick` and related LWJGL-facing behavior against the TypeScript port at `C:\js-projects\slick2d-ts`, with the specific filter requested by the user: only problems relevant to converting `C:\NetBeansProjects\SlickMsPacMan` to a desktop-browser PWA SPA should be filed for repair.

This pass also rechecks the areas that were previously reported and then supposedly repaired by another AI. Browser-intentional omissions, Java-only desktop behaviors, and Slick2D APIs not used by the MsPacMan port were not treated as repair issues unless they would affect this game.

## Result

No new Slick2D TypeScript repair items were found for the SlickMsPacMan web port in this pass.

Because no new game-relevant Slick2D defect was found, there is no bug list for the other AI to repair from this audit. This file records the evidence and the explicit non-issues so the same areas do not keep getting refiled without cause.

## Verification Commands

Executed in `C:\js-projects\slick2d-ts`:

```powershell
.\node_modules\.bin\tsc.cmd -p tsconfig.json --noEmit
```

Result: passed with exit code 0.

Executed in `C:\js-projects\slick2d-ts` with filesystem approval because the package emits `dist` outside this workspace's writable root:

```powershell
npm.cmd test
```

Result: passed. The suite built the package and ran 20 tests, all passing.

The passing tests include:

- `FastTrig.sin mirrors Java Slick2D angle reduction`
- `FastTrig.cos mirrors Java Slick2D sin offset rule`
- `Sound.stop and Sound.playing track only the latest source for that Sound`
- `sound-effect gain matches Java's double sound-volume application and is not retroactive`
- `Music no-argument play and loop reset instance volume to Java default`
- `AppGameContainer defaults to Java visible-only updates`
- `hidden frames skip update/render by default`
- `browser-forced fullscreen exit restores the last windowed canvas mode`

An earlier sandboxed `npm.cmd test` attempt failed because the sandbox could not write `C:\js-projects\slick2d-ts\dist`. That was a sandbox permission failure, not a confirmed Slick2D TS defect. The approved rerun passed.

## Game Slick2D Surface Rechecked

The game imports Slick2D/LWJGL through wildcard imports in most `mspacman` classes and uses the following relevant Slick2D/LWJGL surface:

- `AppGameContainer`, `GameContainer`, `Game`, `Graphics`, `Input`, `Image`, `Color`, `Music`, `Sound`, `PackedSpriteSheet`, `SlickException`
- `SlickCallable`, `CursorLoader`
- `Display`, `DisplayMode`, `GL11`, `Mouse`, `BufferUtils`, `Sys`

Important game references:

- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Main.java:177` to `Main.java:180`: simulation loop uses `Sys.getTime()` and `Sys.getTimerResolution() / 91`.
- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Main.java:266` to `Main.java:279`: transparent native cursor hide/restore.
- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Main.java:285` to `Main.java:300`: native display mode selection from `Display.getAvailableDisplayModes()`.
- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Main.java:405` to `Main.java:481`: direct `GL11` matrix transforms around image drawing.
- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Main.java:524` to `Main.java:537`: sound-effect construction.
- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Main.java:545` to `Main.java:548`: `PackedSpriteSheet` construction with `Image.FILTER_NEAREST`.
- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Main.java:673` to `Main.java:674`: `juniorSprite.getFlippedCopy(true, false)`.
- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Main.java:803` to `Main.java:813`: desktop container startup calls.
- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\HumanInput.java:16` to `HumanInput.java:49`: keyboard constants and one-shot controls.
- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\ScalableGame2.java:62` to `ScalableGame2.java:144`: project-specific scaler init/render behavior.

## Previously Reported Areas Rechecked

### FastTrig

Status: fixed, no new issue.

Java Slick2D:

- `C:\java-projects\slick2d\Slick\src\org\newdawn\slick\util\FastTrig.java:18` to `FastTrig.java:29`: Java `reduceSinAngle`.
- `FastTrig.java:37` to `FastTrig.java:44`: Java `sin`.
- `FastTrig.java:52` to `FastTrig.java:54`: Java `cos` delegates through `sin(radians + Math.PI / 2)`.

TypeScript:

- `C:\js-projects\slick2d-ts\src\slick\util\FastTrig.ts:7` to `FastTrig.ts:16`: matching angle reduction.
- `FastTrig.ts:23` to `FastTrig.ts:29`: matching reduced-angle `sin`.
- `FastTrig.ts:36` to `FastTrig.ts:38`: matching `cos`.
- `C:\js-projects\slick2d-ts\test\fast-trig-parity.test.mjs:41` to `fast-trig-parity.test.mjs:51`: parity tests cover both methods.

Conclusion: the previous FastTrig parity issue should not be refiled.

### Sound, Music, and SoundStore

Status: fixed/acceptable for this game, no new issue.

Java `Sound`:

- `C:\java-projects\slick2d\Slick\src\org\newdawn\slick\Sound.java:106` to `Sound.java:118`: `play()` delegates to `play(1.0f, 1.0f)` and applies `volume * SoundStore.get().getSoundVolume()`.
- `Sound.java:146` to `Sound.java:158`: `loop()` delegates to `loop(1.0f, 1.0f)` and applies the same global sound volume.
- `Sound.java:165` to `Sound.java:173`: `playing()`/`stop()` query/stop the wrapped audio implementation.

TypeScript `Sound`:

- `C:\js-projects\slick2d-ts\src\slick\Sound.ts:56` to `Sound.ts:72`: `play()` defaults to pitch 1, volume 1, applies global sound volume, and tracks the latest handle.
- `Sound.ts:79` to `Sound.ts:90`: `loop()` defaults to pitch 1, volume 1 and tracks the latest handle.
- `Sound.ts:93` to `Sound.ts:107`: `playing()` and `stop()` operate on the latest handle.

Java `SoundStore`:

- `C:\java-projects\slick2d\Slick\src\org\newdawn\slick\openal\SoundStore.java:394` to `SoundStore.java:398`: `playAsSoundAt` multiplies gain by `soundVolume` again and clamps exact zero to `0.001f`.
- `SoundStore.java:399` to `SoundStore.java:403`: returns failure when sound is disabled or no free source exists.

TypeScript `SoundStore`:

- `C:\js-projects\slick2d-ts\src\slick\openal\SoundStore.ts:295` to `SoundStore.ts:308`: browser sound play returns `null` when disabled/unavailable and uses a finite source pool.
- `SoundStore.ts:337` to `SoundStore.ts:348`: records the logical source handle and applies the same second global sound-volume multiplication/clamp.
- `SoundStore.ts:352` to `SoundStore.ts:361`: releases handles on natural completion.

Java `Music`:

- `C:\java-projects\slick2d\Slick\src\org\newdawn\slick\Music.java:222` to `Music.java:230`: no-arg `loop()` and `play()` use volume `1.0f`.
- `Music.java:239` to `Music.java:250`: explicit-volume `play`/`loop`.
- `Music.java:259` to `Music.java:277`: start clamps volume, plays, sets `playing`, and stores instance volume.

TypeScript `Music`:

- `C:\js-projects\slick2d-ts\src\slick\Music.ts:113` to `Music.ts:127`: no-arg `play()`/`loop()` default to volume 1, explicit overloads preserve supplied volume.
- `Music.ts:129` to `Music.ts:169`: pause/stop/resume/playing maintain current-music state.
- `Music.ts:172` to `Music.ts:178`: `setVolume` clamps to 0..1.

Tests:

- `C:\js-projects\slick2d-ts\test\sound-store-parity.test.mjs:116` to `sound-store-parity.test.mjs:135`: finite source pool.
- `sound-store-parity.test.mjs:137` to `sound-store-parity.test.mjs:173`: `Sound.stop`/`Sound.playing` latest-handle behavior.
- `sound-store-parity.test.mjs:256` to `sound-store-parity.test.mjs:275`: double global sound-volume application.
- `sound-store-parity.test.mjs:277` to `sound-store-parity.test.mjs:309`: music default/explicit volume behavior.

Conclusion: the previously reported sound/music parity issues are repaired and covered by tests. The double global sound-volume application is intentional Java parity, not a bug.

### AppGameContainer and Update Visibility

Status: acceptable for this game, no new issue.

The Java container has accumulated-delta update behavior that is not fully identical to the TypeScript browser frame loop. However, this is not a new game-relevant Slick2D repair item because SlickMsPacMan does not depend on the passed `delta` for simulation. Its `Main.update` drives the actual gameplay ticks with `Sys.getTime()` and `Sys.getTimerResolution() / 91` at `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Main.java:176` to `Main.java:184`.

The game also uses its own `paused` boolean and does not call `GameContainer.setPaused`; see `Main.java:165` to `Main.java:175`.

Relevant TypeScript:

- `C:\js-projects\slick2d-ts\src\slick\AppGameContainer.ts:373` to `AppGameContainer.ts:388`: browser loop polls input, caps delta, calls `game.update`, then polls music/sound.
- `AppGameContainer.ts:376` to `AppGameContainer.ts:379`: hidden frames skip update/render by default.
- `C:\js-projects\slick2d-ts\test\app-game-container-visibility.test.mjs:91` to `app-game-container-visibility.test.mjs:127`: verifies visible-only default and hidden-time non-accumulation.

Conclusion: do not file the Java desktop update-loop difference as a blocker for this port.

### ScalableGame2 Rendering and Input Transform

Status: fixed/acceptable, no new issue.

Game Java `ScalableGame2`:

- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\ScalableGame2.java:62` to `ScalableGame2.java:109`: target-size calculation, input listener registration, input scale/offset, held init.
- `ScalableGame2.java:122` to `ScalableGame2.java:144`: safe block, clip, translate, scale, matrix push, held render, pop, clear clip, leave safe block, overlay.
- `ScalableGame2.java:170` onward: browser/window size-change equivalent recalculates the target size.

TypeScript `ScalableGame2`:

- `C:\js-projects\slick2d-ts\src\slick\ScalableGame2.ts:33` to `ScalableGame2.ts:40`: init calculates target size, registers input listener, applies input transform, then calls held init.
- `ScalableGame2.ts:50` to `ScalableGame2.ts:75`: target-size calculation mirrors the Java branch structure and uses `Math.trunc` for Java int casts.
- `ScalableGame2.ts:77` to `ScalableGame2.ts:83`: input scale/offset matches Java formulas.
- `ScalableGame2.ts:87` to `ScalableGame2.ts:100`: render ordering matches the project Java wrapper.

TypeScript rendering support:

- `C:\js-projects\slick2d-ts\src\slick\rendering\WebGLRenderer.ts:344` to `WebGLRenderer.ts:355`: screen-space scissor clip.
- `WebGLRenderer.ts:381` to `WebGLRenderer.ts:395`: transform stack and translation post-multiply.
- `WebGLRenderer.ts:572` to `WebGLRenderer.ts:581`: `glRotatef`/`glTranslatef`.
- `WebGLRenderer.ts:614` to `WebGLRenderer.ts:616`: `glScalef`.
- `C:\js-projects\slick2d-ts\src\slick\opengl\SlickCallable.ts:12` to `SlickCallable.ts:25`: safe block flush/push/pop/flush.

Conclusion: no new scaler/render repair item found.

### Image and PackedSpriteSheet

Status: acceptable for this game, no new issue.

Java `PackedSpriteSheet`:

- `C:\java-projects\slick2d\Slick\src\org\newdawn\slick\PackedSpriteSheet.java:127` to `PackedSpriteSheet.java:143`: image line plus repeated section loading.
- `PackedSpriteSheet.java:177` to `PackedSpriteSheet.java:190`: reads `name`, `x`, `y`, `width`, `height`, `tilesx`, `tilesy`, two throwaway lines, then clamps `tilesx`/`tilesy` to at least 1.

TypeScript `PackedSpriteSheet`:

- `C:\js-projects\slick2d-ts\src\slick\PackedSpriteSheet.ts:37` to `PackedSpriteSheet.ts:49`: constructor loads the `.def`, derives the image ref, and loads the full image with the requested filter/transparent color.
- `PackedSpriteSheet.ts:57` to `PackedSpriteSheet.ts:64`: `getSprite` returns a sub-image from the full image.
- `PackedSpriteSheet.ts:77` to `PackedSpriteSheet.ts:110`: parser matches the game `.def` files' section format.

Game `.def` format:

- `C:\NetBeansProjects\SlickMsPacMan\src\images\pack_1.def`: first line is `pack_1.png`; each section then has `{`, sprite name, x, y, width, height, `0`, `0`, `0`, `0`, `}`.

Java `Image`:

- `C:\java-projects\slick2d\Slick\src\org\newdawn\slick\Image.java:545` to `Image.java:559`: plain draw overloads.
- `Image.java:929` to `Image.java:930`: `setAlpha`.
- `Image.java:954` to `Image.java:975`: `getSubImage` shares texture data and adjusts offsets.
- `Image.java:1194` to `Image.java:1196`: `copy()` uses `getSubImage`.
- `Image.java:1244` to `Image.java:1257`: `getFlippedCopy` flips texture offsets/widths.

TypeScript `Image`:

- `C:\js-projects\slick2d-ts\src\slick\Image.ts:254` to `Image.ts:310`: draw overloads cover the game's plain draw and transformed draw usage.
- `Image.ts:380` to `Image.ts:382`: `setAlpha`.
- `Image.ts:390` to `Image.ts:400`: `getSubImage` shares the same texture resource and adjusts source coordinates.
- `Image.ts:418` to `Image.ts:428`: copy preserves TypeScript image state.
- `Image.ts:454` to `Image.ts:460`: `getFlippedCopy`.
- `Image.ts:551` to `Image.ts:566`: draw path applies alpha, source offsets, and horizontal/vertical flips.

Game usage:

- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Main.java:433` to `Main.java:436`: temporary alpha draw.
- `Main.java:465` to `Main.java:481`: direct GL matrix transform around `image.draw`.
- `Main.java:673` to `Main.java:674`: only game `getFlippedCopy` call is a horizontal flip of `juniorSprite`.

Conclusion: no new image or packed-sheet repair item found for this game. Unsupported or intentionally omitted Java image features that are not on this game path should not be filed in this MsPacMan-specific repair list.

### Input

Status: acceptable, no new issue.

Java key constants used by the game:

- `C:\java-projects\slick2d\Slick\src\org\newdawn\slick\Input.java:31`, `35`, `39`, `43`, `47`, `63`, `75`, `79`, `87`, `91`, `93`, `95`, `103`, `105`, `107`, `145`, `251`, `255`, `257`, `261`.

TypeScript key constants:

- `C:\js-projects\slick2d-ts\src\slick\Input.ts:23`, `25`, `27`, `29`, `31`, `35`, `41`, `43`, `45`, `46`, `47`, `48`, `52`, `53`, `54`, `62`, `75`, `76`, `77`, `78`.

Java input behavior:

- `C:\java-projects\slick2d\Slick\src\org\newdawn\slick\Input.java:448` to `Input.java:459`: scale/offset support.
- `Input.java:667` onward: `isKeyPressed` consumes the one-shot pressed record.
- `Input.java:753` to `Input.java:754`: `isKeyDown` queries held state.

TypeScript input behavior:

- `C:\js-projects\slick2d-ts\src\slick\Input.ts:273` to `Input.ts:282`: scale/offset support.
- `Input.ts:293` to `Input.ts:298`: `isKeyPressed` consumes the one-shot record.
- `Input.ts:300` to `Input.ts:302`: `isKeyDown` checks held state.
- `Input.ts:758` to `Input.ts:813`: DOM key-code mapping covers all movement/action keys used by `HumanInput` and `EnterInitialsMode`.
- `Input.ts:820` to `Input.ts:840`: browser default prevention covers game keys while leaving form controls protected by the interactive-element guard immediately above it.

Game usage:

- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\HumanInput.java:16` to `HumanInput.java:49`.
- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\EnterInitialsMode.java:73` to `EnterInitialsMode.java:110`.

Conclusion: no new keyboard/input repair item found.

### Display, Fullscreen, and Cursor

Status: acceptable for a desktop-browser web port, no new issue.

Game usage:

- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Main.java:266` to `Main.java:279`: save native cursor, create transparent 32x32 cursor, apply/restore cursor.
- `Main.java:285` to `Main.java:300`: choose largest available display mode.
- `Main.java:803` to `Main.java:813`: windowed startup and container flags.

TypeScript `Display`:

- `C:\js-projects\slick2d-ts\src\lwjgl\opengl\Display.ts:144` to `Display.ts:167`: display mode/current mode/available modes include browser screen, active container, 640x480, and 800x600.
- `Display.ts:169` to `Display.ts:178`: `setDisplayMode`.
- `Display.ts:180` to `Display.ts:198`: browser fullscreen returns a promise when necessary and restores state on failure.

TypeScript `AppGameContainer`:

- `C:\js-projects\slick2d-ts\src\slick\AppGameContainer.ts:100` to `AppGameContainer.ts:130`: `setDisplayMode` handles windowed/fullscreen and browser-applied display sizes.
- `AppGameContainer.ts:140` to `AppGameContainer.ts:150`: fullscreen request is asynchronous by browser necessity.
- `AppGameContainer.ts:427` to `AppGameContainer.ts:440`: forced browser fullscreen exit restores windowed mode and cursor.

TypeScript cursor:

- `C:\js-projects\slick2d-ts\src\lwjgl\input\Mouse.ts:40` to `Mouse.ts:57`: native cursor assignment maps to CSS cursor.
- `Mouse.ts:64` to `Mouse.ts:70`: forced fullscreen cursor restoration.
- `Mouse.ts:72` to `Mouse.ts:114`: transparent cursor maps to CSS `none`.
- `C:\js-projects\slick2d-ts\src\slick\opengl\CursorLoader.ts:18` to `CursorLoader.ts:32`: string, buffer, and image-data cursor overloads.

Conclusion: fullscreen asynchrony and CSS cursor implementation are browser-port intentional, not repair defects for this game.

## Porting Cautions That Are Not Slick2D TS Repair Items

These are still important for the actual MsPacMan Java-to-TypeScript conversion, but they are not bugs in `slick2d-ts`:

- Java integer division must be preserved in the game port. Example: `Main.java:180` uses `Sys.getTimerResolution() / 91`, which is integer division in Java. A literal TS `/` would produce a fraction unless truncated.
- Java integer arithmetic must be preserved for color fade values. Example: `Main.java:190` uses `(255 * i) / (fades.length - 1)` as an integer alpha argument to `new Color(...)`. A TS port must intentionally truncate/round according to the Java expression semantics before passing to `Color`.
- The PWA start/menu screen and volume slider are application shell responsibilities required by browser Web Audio user-activation rules. They should use the existing `slick2d-ts` audio helpers, not be filed as Slick2D API omissions.
- Java-only desktop/app-specific pieces such as AWT toolkit startup and applet container behavior are not expected to map 1-to-1 in the browser shell.

## Final Repair List for Other AI

No new game-relevant Slick2D TypeScript problems were found in this pass.

Do not repair or change anything based solely on this audit unless a future runtime/game-port test exposes a concrete mismatch not covered here.
