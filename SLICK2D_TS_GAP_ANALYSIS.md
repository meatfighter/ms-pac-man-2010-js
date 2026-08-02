# Slick2D TS Gap Analysis

Date: 2026-08-02

This report compares `C:\js-projects\slick2d-ts` with the Java Slick2D source in `C:\java-projects\slick2d\Slick`, with special attention to the needs of the Ms. Pac-Man port in `C:\NetBeansProjects\SlickMsPacMan`.

## Summary

`slick2d-ts` is useful for the Ms. Pac-Man web port, but it is not a complete TypeScript port of Java Slick2D.

Observed counts:

| Item | Count |
| --- | ---: |
| Java Slick2D production class-like files under `Slick/src/org/newdawn/slick` | 222 |
| TypeScript Slick2D class-like files under `slick2d-ts/src/slick` | 55 |
| Direct relative path/name matches | 36 |
| Missing Java Slick2D class-like files | 186 |

For Ms. Pac-Man specifically, most direct API calls are present. The blocking issue is not broad class coverage; it is an incorrect conversion of `PackedSpriteSheet.ts` parsing.

## Direct Blocker For Ms. Pac-Man

### `src/slick/PackedSpriteSheet.ts` parses `.def` files incorrectly

Java source inspected:

- `C:\java-projects\slick2d\Slick\src\org\newdawn\slick\PackedSpriteSheet.java`

TS source inspected:

- `C:\js-projects\slick2d-ts\src\slick\PackedSpriteSheet.ts`

Java behavior:

- Read image filename.
- Loop while ready:
  - Read opening `{`.
  - Construct `Section(reader)`.
  - `Section` reads exactly:
    - name
    - x
    - y
    - width
    - height
    - tilesx
    - tilesy
    - two ignored lines
  - Then outer loop reads the closing `}`.

Current TS behavior:

- Reads image filename.
- Increments past one line.
- Reads section fields.
- Skips only two ignored lines.
- Does not consume the closing `}` before the next iteration.

Measured effect on Ms. Pac-Man atlases:

| Atlas | Correct Java-style entry count | Current TS parser entry count | Missing during current TS parse |
| --- | ---: | ---: | ---: |
| `images/pack_1.def` | 93 | 24 | 69 parsed definitions are lost or malformed |
| `images/pack_2.def` | 744 | 107 | 637 parsed definitions are lost or malformed |

Correct Java-style parsing of the actual Ms. Pac-Man source atlases gives:

| Atlas | Entries | Game-referenced keys | Missing game-referenced keys |
| --- | ---: | ---: | ---: |
| `pack_1.def` | 93 | 88 | 0 |
| `pack_2.def` | 744 | 699 | 0 |

This means the Java resources themselves are complete. The TS parser is the problem.

Required fix:

- Consume the closing `}` after each section, exactly like Java.
- Keep `tilesx = Math.max(1, tilesx)` and `tilesy = Math.max(1, tilesy)`.
- Add a regression test using the real Ms. Pac-Man `pack_1.def` and `pack_2.def`.
- Assert counts 93 and 744.
- Assert that every sprite name referenced by `Main.loadGraphics` is present.

## Game-Critical API Status

APIs present and relevant to Ms. Pac-Man:

- `AppGameContainer`
- `ApplicationGameContainer`
- `BasicGame`
- `Color`
- `Game`
- `GameContainer`
- `Graphics`
- `Image`
- `Input`
- `InputListener`
- `Music`
- `PackedSpriteSheet`
- `ScalableGame`
- `ScalableGame2`
- `SlickException`
- `Sound`
- `SpriteSheet`
- `FastTrig`
- `Log`
- `ResourceLoader`
- `SoundStore`
- `CursorLoader`
- `ImageData`
- `ImageIOImageData`
- `InternalTextureLoader`
- `LoadableImageData`
- `Renderer`
- `SGL`
- `SlickCallable`
- `TGAImageData`
- `Display`
- `DisplayMode`
- `GL11`
- `Sys`
- `BufferUtils`
- `Cursor`
- `Mouse`
- `BinaryReader`
- `JavaRandom`

Input key constants needed by Ms. Pac-Man are present:

- `KEY_UP`
- `KEY_DOWN`
- `KEY_LEFT`
- `KEY_RIGHT`
- `KEY_ENTER`
- `KEY_SPACE`
- `KEY_ESCAPE`
- `KEY_P`
- `KEY_W`
- `KEY_A`
- `KEY_S`
- `KEY_D`
- `KEY_I`
- `KEY_J`
- `KEY_K`
- `KEY_L`
- `KEY_2`
- `KEY_4`
- `KEY_6`
- `KEY_8`

## Game-Relevant Risks And Differences

### Resource loading

`ResourceLoader` is intentionally browser-async but presents a synchronous Java-style `getResourceAsStream(ref)` for already-loaded bytes.

Implications for Ms. Pac-Man:

- `PackedSpriteSheet("images/pack_1.def", ...)` requires the `.def` bytes to already be registered.
- Stage and demo readers need bytes already registered.
- Image and audio loads queue async work; the PWA resource preloader must wait for all resources before gameplay.
- `ResourceLoader.loadResource(ref)` currently uses direct `fetch(url)` without retry, progress, or version query injection.

Required port behavior:

- Fetch `images/pack_1.def?v=...` or equivalent.
- Register it under `images/pack_1.def`.
- Retry downloads.
- Surface failures in the loading UI.

### Web Audio unlock

`SoundStore.getAudioContext()` lazily creates an `AudioContext`. `AppGameContainer.start()` calls `SoundStore.get().init()`.

Implications:

- If `AppGameContainer.start()` runs before a user gesture, the app risks creating/resuming Web Audio outside browser autoplay policy.
- The Ms. Pac-Man PWA must show a menu first and only start the Slick container from the Start button handler.
- The menu volume slider should apply both music and sound volume through `GameContainer` or `SoundStore`.

### Audio error reporting

`Music` and `Sound` constructors queue resource loads and catch some errors internally. Playback may silently not happen if a buffer fails to load.

Required checks:

- Preload all audio files explicitly.
- Wait for all resource/audio promises.
- Inspect `ResourceLoader.resourceFailed(ref)` or equivalent before leaving loading.
- Present failure UI if any required resource fails.

### `SoundStore.isMusicPlaying()`

`SoundStore` tracks active handles in one set. `isMusicPlaying()` checks all active handles, including sound-effect handles.

Ms. Pac-Man does not appear to call `isMusicPlaying()`, so this is not a direct blocker, but it is a Slick2D parity issue if future ports depend on it.

### Fullscreen and cursor behavior

Java fullscreen and cursor calls are synchronous or throw `SlickException`; browser equivalents may return promises or be blocked by user gesture.

Ms. Pac-Man uses:

- `Display.getAvailableDisplayModes()`
- `DisplayMode`
- `AppGameContainer.setDisplayMode(...)`
- `GameContainer.setFullscreen(...)`
- `Mouse.getNativeCursor()`
- `Mouse.setNativeCursor(...)`
- empty cursor construction through `BufferUtils`

Required checks:

- Space/Escape fullscreen toggles must be tested in browser.
- Hidden cursor behavior must be mapped to CSS cursor hiding when native cursor APIs are not meaningful.
- Browser fullscreen failures must not break gameplay.

### Timing

`Sys.getTime()` returns integer milliseconds and `Sys.getTimerResolution()` returns 1000 in `slick2d-ts`.

Java code uses `Sys.getTimerResolution() / 91`, which is integer division in Java. If Java LWJGL timer resolution is 1000, the Java increment is 10 ticks, not 10.989 ticks.

Required check:

- Verify original runtime cadence or intentionally preserve Java truncation with `Math.trunc(Sys.getTimerResolution() / 91)`.

### Unsupported Slick2D methods

`Graphics.drawOval`, `drawArc`, `fillOval`, `fillArc`, round-rect drawing, image shearing, and warped drawing throw unsupported exceptions in the TS port.

Ms. Pac-Man source search did not find these methods in game code, so they are not direct blockers.

## Direct Relative Matches

The following Java Slick2D files have direct relative/path-name matches in `slick2d-ts`:

- `appgamecontainer.java`
- `basicgame.java`
- `color.java`
- `controlledinputreciever.java`
- `controllerlistener.java`
- `font.java`
- `game.java`
- `gamecontainer.java`
- `graphics.java`
- `image.java`
- `input.java`
- `inputlistener.java`
- `keylistener.java`
- `mouselistener.java`
- `music.java`
- `musiclistener.java`
- `openal\soundstore.java`
- `opengl\cursorloader.java`
- `opengl\imagedata.java`
- `opengl\imageioimagedata.java`
- `opengl\internaltextureloader.java`
- `opengl\loadableimagedata.java`
- `opengl\renderer\renderer.java`
- `opengl\renderer\sgl.java`
- `opengl\slickcallable.java`
- `opengl\tgaimagedata.java`
- `packedspritesheet.java`
- `renderable.java`
- `scalablegame.java`
- `slickexception.java`
- `sound.java`
- `spritesheet.java`
- `util\fasttrig.java`
- `util\log.java`
- `util\resourceloader.java`
- `xmlpackedsheet.java`

## Missing Java Slick2D Classes

These Java Slick2D production classes are not present as direct TS counterparts.

Root package:

- `angelcodefont`
- `animation`
- `appletgamecontainer`
- `bigimage`
- `cachedrender`
- `canvasgamecontainer`
- `imagebuffer`
- `savedstate`
- `shapefill`
- `spritesheetfont`
- `truetypefont`
- `unicodefont`

`command`:

- `basiccommand`
- `command`
- `control`
- `controllerbuttoncontrol`
- `controllercontrol`
- `controllerdirectioncontrol`
- `inputprovider`
- `inputproviderlistener`
- `keycontrol`
- `mousebuttoncontrol`

`fills`:

- `gradientfill`

`font`:

- `glyph`
- `glyphpage`
- `hierosettings`

`font/effects`:

- `coloreffect`
- `configurableeffect`
- `effect`
- `effectutil`
- `filtereffect`
- `gradienteffect`
- `outlineeffect`
- `outlinewobbleeffect`
- `outlinezigzageffect`
- `shadoweffect`

`geom`:

- `basictriangulator`
- `circle`
- `curve`
- `ellipse`
- `geomutil`
- `geomutillistener`
- `line`
- `manntriangulator`
- `morphshape`
- `neattriangulator`
- `overtriangulator`
- `path`
- `point`
- `polygon`
- `rectangle`
- `roundedrectangle`
- `shape`
- `shaperenderer`
- `texcoordgenerator`
- `transform`
- `triangulator`
- `vector2f`

`gui`:

- `abstractcomponent`
- `basiccomponent`
- `componentlistener`
- `guicontext`
- `mouseoverarea`
- `textfield`

`imageout`:

- `imageiowriter`
- `imageout`
- `imagewriter`
- `imagewriterfactory`
- `tgawriter`

`loading`:

- `deferredresource`
- `loadinglist`

`muffin`:

- `filemuffin`
- `muffin`
- `webstartmuffin`

`openal`:

- `aiffdata`
- `audio`
- `audioimpl`
- `audioinputstream`
- `audioloader`
- `deferredsound`
- `modsound`
- `nullaudio`
- `oggdata`
- `oggdecoder`
- `ogginputstream`
- `openalstreamplayer`
- `streamsound`
- `wavedata`

`opengl`:

- `compositeimagedata`
- `compositeioexception`
- `deferredtexture`
- `emptyimagedata`
- `glutils`
- `imagedatafactory`
- `pngdecoder`
- `pngimagedata`
- `texture`
- `textureimpl`
- `textureloader`

`opengl/pbuffer`:

- `fbographics`
- `graphicsfactory`
- `pbuffergraphics`
- `pbufferuniquegraphics`

`opengl/renderer`:

- `defaultlinestriprenderer`
- `immediatemodeoglrenderer`
- `linestriprenderer`
- `quadbasedlinestriprenderer`
- `vaoglrenderer`

`particles`:

- `configurableemitter`
- `configurableemitterfactory`
- `particle`
- `particleemitter`
- `particleio`
- `particlesystem`

`particles/effects`:

- `fireemitter`

`state`:

- `basicgamestate`
- `gamestate`
- `statebasedgame`

`state/transition`:

- `blobbytransition`
- `combinedtransition`
- `crossstatetransition`
- `emptytransition`
- `fadeintransition`
- `fadeouttransition`
- `horizontalsplittransition`
- `rotatetransition`
- `selecttransition`
- `transition`
- `verticalsplittransition`

`svg`:

- `diagram`
- `figure`
- `gradient`
- `inkscapeloader`
- `lineargradientfill`
- `loader`
- `nongeometricdata`
- `parsingexception`
- `radialgradientfill`
- `simplediagramrenderer`
- `svgmorph`

`svg/inkscape`:

- `defsprocessor`
- `elementprocessor`
- `ellipseprocessor`
- `groupprocessor`
- `inkscapenongeometricdata`
- `lineprocessor`
- `pathprocessor`
- `polygonprocessor`
- `rectprocessor`
- `useprocessor`
- `util`

`tiled`:

- `layer`
- `tiledmap`
- `tileset`

`util`:

- `bootstrap`
- `bufferedimageutil`
- `classpathlocation`
- `defaultlogsystem`
- `filesystemlocation`
- `fontutils`
- `inputadapter`
- `locatedimage`
- `logsystem`
- `maskutil`
- `operationnotsupportedexception`
- `resourcelocation`

`util/pathfinding`:

- `astarheuristic`
- `astarpathfinder`
- `mover`
- `path`
- `pathfinder`
- `pathfindingcontext`
- `tilebasedmap`

`util/pathfinding/heuristics`:

- `closestheuristic`
- `closestsquaredheuristic`
- `manhattanheuristic`

`util/pathfinding/navmesh`:

- `link`
- `navmesh`
- `navmeshbuilder`
- `navpath`
- `space`

`util/xml`:

- `objecttreeparser`
- `slickxmlexception`
- `xmlelement`
- `xmlelementlist`
- `xmlparser`

## Remediation Order For Ms. Pac-Man

1. Fix `PackedSpriteSheet.ts` parsing and add real-atlas regression tests.
2. Add or wrap retrying resource loads with version query support.
3. Ensure all Java resource bytes are preloaded/registered before `Main.init`.
4. Ensure Web Audio context creation/resume happens only from the Start button gesture.
5. Add loading failure propagation rather than silent resource/audio failures.
6. Verify Java integer timing behavior against `Sys`.
7. Test fullscreen/cursor behavior in desktop browsers.
8. Only after those items are green should the game class conversion begin.

