# slick2d-ts Full Parity Audit And Fix Handoff

Date: 2026-08-02

Audience: another AI or engineer fixing `C:\js-projects\slick2d-ts`.

Scope: audit `C:\java-projects\slick2d` against `C:\js-projects\slick2d-ts` as a Slick2D library port, not only for `C:\NetBeansProjects\SlickMsPacMan`.

This document is intentionally strict. The current TypeScript project is a useful browser compatibility subset, but it is not a full Slick2D port. Treat it as a phase-one shim that must be corrected and expanded before claiming full Java Slick2D parity.

## Projects Audited

- Java source: `C:\java-projects\slick2d\Slick\src\org\newdawn\slick`
- TypeScript source: `C:\js-projects\slick2d-ts\src`
- TypeScript Slick package: `C:\js-projects\slick2d-ts\src\slick`
- TypeScript LWJGL shims: `C:\js-projects\slick2d-ts\src\lwjgl`
- TypeScript docs inspected:
  - `C:\js-projects\slick2d-ts\docs\IMPLEMENTATION-AUDIT.md`
  - `C:\js-projects\slick2d-ts\docs\SLICK2D-PARITY-API.md`
  - `C:\js-projects\slick2d-ts\docs\RESOURCE-MANAGEMENT-SYSTEM.md`

## Current Coverage Snapshot

Raw source counts from filesystem inspection:

| Area | Count |
| --- | ---: |
| Java `.java` files under `org.newdawn.slick`, including tests | 302 |
| Java production `.java` files, excluding `tests` | 222 |
| TypeScript `.ts` files under `src/slick` | 55 |
| Direct production class-name matches between Java Slick and `src/slick` | 36 |
| Java production classes missing by direct class name | 186 |
| Java test/demo files not ported | 80 |

The TypeScript repository also includes 10 LWJGL shim files under `src/lwjgl`. These are not direct ports from `C:\java-projects\slick2d` because the Java project depends on external LWJGL classes.

The existing TypeScript documentation repeatedly frames the project as a phase-one subset for three games. For example, the docs mention phase-one unsupported methods and a planned `ResourceManager` or `ResourceScope` model. The current source does not implement the full documented resource management design. Do not treat the existing docs as proof of full parity.

Java package file counts:

| Java package | Production files |
| --- | ---: |
| root `org.newdawn.slick` | 37 |
| `command` | 10 |
| `fills` | 1 |
| `font` | 13 |
| `geom` | 22 |
| `gui` | 6 |
| `imageout` | 5 |
| `loading` | 2 |
| `muffin` | 3 |
| `openal` | 15 |
| `opengl` | 29 |
| `particles` | 7 |
| `state` | 14 |
| `svg` | 22 |
| `tiled` | 3 |
| `util` | 35 |
| `tests` | 80 |

Current TypeScript Slick package file counts:

| TS package | Files |
| --- | ---: |
| root `src/slick` | 25 |
| `openal` | 1 |
| `opengl` | 9 |
| `rendering` | 6 |
| `support` | 11 |
| `util` | 3 |

## Non-Negotiable Fixing Rules

- Preserve Java behavior first. Browser adaptations are allowed only when synchronous Java behavior is impossible in the browser, and each adaptation must be explicit, tested, and documented.
- Keep Java class boundaries. If Java has a class, the TypeScript port should have a corresponding file unless there is a deliberate browser-specific substitute with a written rationale.
- Keep Java constants, constructor overloads, method names, exception behavior, and return values as close as TypeScript allows.
- Preserve Java quirks when game code can observe them. Examples: `Color.hashCode()`, `Color.add()` not clamping, `PackedSpriteSheet` default nearest filter.
- Any fix must add parity tests. For rendering and audio, use deterministic unit tests where possible and browser tests for observable behavior.
- Do not silently swallow resource, decode, or audio failures. Java often throws `SlickException`; browser code must surface equivalent failures through the preload barrier or rejected startup.

## Highest Priority Bugs In Already-Ported Classes

### 1. `PackedSpriteSheet` parser skips the Java block structure incorrectly

Files:

- Java: `C:\java-projects\slick2d\Slick\src\org\newdawn\slick\PackedSpriteSheet.java`
- TS: `C:\js-projects\slick2d-ts\src\slick\PackedSpriteSheet.ts`

Java behavior:

- Reads the first line as the packed image filename.
- For each block, reads one opening line, constructs `Section` from 7 data lines plus 2 ignored lines, then reads one closing line.
- Default `filter` field is `Image.FILTER_NEAREST`.
- Unknown sprite throws `RuntimeException("Unknown sprite from packed sheet: " + name)`.

Current TS behavior:

- Reads first line correctly.
- In `parse(lines)`, it increments once for an opening line, reads the 7 data fields, skips 2 ignored lines, but does not consume the closing `}` line before starting the next section.
- That causes the next loop to treat the closing line as the next opening line, then parse the next opening line as a sprite name.
- The default constructor path uses `Image.FILTER_LINEAR`, not Java's `Image.FILTER_NEAREST`.
- Unknown sprite throws `SlickException`, not Java's `RuntimeException`. TypeScript may reasonably use `SlickException`, but this should be deliberate and documented.

Observed impact:

- Real Ms. Pac-Man `pack_1.def`: Java parser structure finds 93 sections. Current TS loop pattern only finds 24.
- Real Ms. Pac-Man `pack_2.def`: Java parser structure finds 744 sections. Current TS loop pattern only finds 107.
- The bug is not game-specific. Any ImagePacker `.def` with multiple blocks can lose most sprites.

Suggested fix:

- Rewrite `parse` to match Java exactly:
  - skip optional blank lines only if Java input tolerates them in practice,
  - read and discard opening line,
  - require name, x, y, width, height, tilesx, tilesy, ignored line 1, ignored line 2,
  - read and discard closing line,
  - fail with a `SlickException` on malformed numbers or missing lines instead of silently breaking.
- Change default constructor filter to `Image.FILTER_NEAREST`.
- Add tests:
  - tiny two-section fixture proves both sections are present,
  - real `.def` count fixture proves the parser count matches Java,
  - default filter test proves no-arg `PackedSpriteSheet(def)` creates nearest-filter backing image,
  - malformed block test proves errors are visible.

### 2. `Image` treats Java load-flipped as horizontal flip

Files:

- Java: `C:\java-projects\slick2d\Slick\src\org\newdawn\slick\Image.java`
- TS: `C:\js-projects\slick2d-ts\src\slick\Image.ts`

Java behavior:

- `Image(String ref, boolean flipped)` means the image should be flipped on the y-axis when loaded.
- Java uses texture-coordinate orientation and texture dimensions separately from logical image dimensions.

Current TS behavior:

- In the string constructor path, `this.flipHorizontal = typeof b === "boolean" ? b : false;`.
- That maps the Java `flipped` constructor argument to horizontal flipping, which is wrong.

Suggested fix:

- Rename the constructor handling variable mentally to `loadFlipped`.
- Apply it to vertical orientation or texture coordinate inversion, not horizontal orientation.
- Add a fixture image with distinct top/bottom and left/right pixels. Load with `flipped=true`; assert vertical inversion only.

### 3. `Image` ignores transparent color constructor behavior

Files:

- Java: `Image.java`
- TS: `Image.ts`, `ImageIOImageData.ts`, `TGAImageData.ts`, `WebGLTextureResource.ts`

Java behavior:

- Constructors such as `Image(ref, flipped, filter, transparent)` pass the transparent color to texture loading.
- Pixels matching the transparent RGB key become alpha 0.

Current TS behavior:

- The string constructor accepts `transparent` by overload shape but never applies it to `WebGLTextureResource`.
- `ImageIOImageData.imageToByteBuffer` has transparent-key support, but `Image` string loading does not route through it with the provided color.
- `TGAImageData` supports a transparent array when called directly, but the high-level `Image` path does not pass it.

Suggested fix:

- Extend the texture resource path to carry decode options: `flipped`, `filter`, `transparentColor`, maybe `forceAlpha`.
- Ensure every constructor overload that accepts `Color trans` reaches the decode/staging code.
- Add a tiny PNG/TGA fixture with a known key color and assert `getColor` or framebuffer output has alpha 0 for matching pixels.

### 4. `Image` stream/blob constructors do not use the supplied bytes

Files:

- Java: `Image.java`
- TS: `Image.ts`

Java behavior:

- `Image(InputStream in, String ref, boolean flipped)` loads image data from the supplied stream and uses `ref` as the symbolic/cache name.

Current TS behavior:

- The `ArrayBuffer | Blob` constructor path creates `new WebGLTextureResource(ref, filter)`.
- For `ArrayBuffer`, it does not register the supplied bytes in `Image.ts`.
- For `Blob`, it also does not register bytes or pass the blob to decode.
- The texture resource later fetches by `ref`, so the supplied binary input is lost.

Suggested fix:

- Add `WebGLTextureResource` support for `ArrayBuffer`, `Blob`, `ImageBitmap`, or a registered resource handle.
- Use `ref` only as identity/cache key.
- For `Blob`, call `arrayBuffer()` during preload and decode through the same image pipeline.
- Add a test that constructs an image from bytes with a fake `ref` that cannot be fetched. It must still render.

### 5. `Image.getScaledCopy` changes the source rectangle instead of only display size

Files:

- Java: `Image.java`
- TS: `Image.ts`

Java behavior:

- An image has logical display width and height separate from its texture coordinate rectangle.
- `getScaledCopy(width, height)` returns an image that displays at the new size but samples the same original source pixels.

Current TS behavior:

- `sourceWidth` and `sourceHeight` are used for both logical dimensions and texture source sampling.
- `getScaledCopy` mutates `copy.sourceWidth` and `copy.sourceHeight`.
- Drawing the scaled copy can sample a different part of the texture instead of scaling the same image.

Suggested fix:

- Split image state into at least:
  - `sourceX`, `sourceY`, `sourceWidth`, `sourceHeight`,
  - `width`, `height` or `displayWidth`, `displayHeight`,
  - `textureWidth`, `textureHeight` from resource.
- Keep `getWidth()` and `getHeight()` returning logical dimensions.
- Keep draw source defaults sampling the original source rectangle.
- Add tests with a subimage scaled larger than its source. Assert the rendered pixels match a scaled version of the subimage, not neighboring atlas pixels.

### 6. `Image.ensureInverted()` is not idempotent

Files:

- Java: `Image.java`
- TS: `Image.ts`

Java behavior:

- `ensureInverted()` only inverts when the texture coordinate height indicates the image has not already been inverted. Repeated calls do not toggle back and forth.

Current TS behavior:

- `ensureInverted()` does `this.flipVertical = !this.flipVertical;`.
- Every call toggles orientation.

Suggested fix:

- Track an explicit inverted state or match Java's coordinate-height sign behavior.
- Add a test that calls `ensureInverted()` twice and verifies the second call does not change rendering.

### 7. `Image.getColor(x, y)` reads the framebuffer, not the image texture

Files:

- Java: `Image.java`
- TS: `Image.ts`, `WebGLRenderer.ts`

Java behavior:

- Reads pixel data for this image.

Current TS behavior:

- Calls `Renderer.getBackend().readPixels(this.sourceX + x, this.sourceY + y, 1, 1, bytes)`.
- `readPixels` reads the currently bound framebuffer. It does not read the image's texture data.
- If the image is not currently rendered at that framebuffer coordinate, the result is unrelated.

Suggested fix:

- Keep CPU-side decoded pixel data when `InternalTextureLoader.setHoldTextureData(true)` or when `getColor` may be needed.
- Or attach the texture to a temporary framebuffer and read from that texture, accounting for source offsets and orientation.
- Add tests for `getColor` before any render and for subimages.

### 8. `Image.setImageColor` and per-corner `setColor` are stored but not rendered

Files:

- Java: `Image.java`
- TS: `Image.ts`, `WebGLRenderer.ts`

Java behavior:

- Per-corner colors affect textured quad vertex colors.

Current TS behavior:

- `Image` stores `cornerColors`, but `drawInternal` passes only one `tint` color or `null` to the renderer.
- `WebGLRenderer` texture shader has one uniform color. It cannot render corner gradients.

Suggested fix:

- Add per-vertex color attributes to textured and solid drawing paths.
- Combine global alpha, image alpha, optional draw tint, and per-corner color according to Java behavior.
- Add a pixel test rendering a white texture with four corner colors and sampling each corner.

### 9. `Image.bind()` does not bind the image texture

Files:

- Java: `Image.java`
- TS: `Image.ts`, `WebGLRenderer.ts`

Java behavior:

- `Image.bind()` binds the image texture to the active GL texture target.

Current TS behavior:

- `Image.bind()` only calls `Color.white.bind()`.
- `WebGLRenderer.glBindTexture(target, id)` ignores the texture id and binds `null` for any nonzero id.

Suggested fix:

- Implement a texture identity registry in `WebGLTextureResource` and `WebGLRenderer`.
- Make `Image.bind()` ensure and bind its WebGL texture.
- Make `SGL.glBindTexture` bind the registered texture for nonzero ids.
- Add tests for code paths that use manual `Renderer.get().glBegin`, `glTexCoord2f`, and `Image.bind()`.

### 10. `Image.startUse()` and `Image.endUse()` do not enforce Java embedded-rendering state

Files:

- Java: `Image.java`
- TS: `Image.ts`, `SpriteSheet.ts`

Java behavior:

- `startUse()` begins embedded drawing for one texture.
- `drawEmbedded` is valid only between `startUse()` and `endUse()`.
- `endUse()` enforces that the image is currently in use.

Current TS behavior:

- `Image.startUse()` and `Image.endUse()` only flush.
- `SpriteSheet` has its own `inUse` guard, but image-level embedded drawing state is not modeled.

Suggested fix:

- Add image-level current-use tracking.
- Ensure `drawEmbedded` validates current use and uses the already-bound texture path.
- Keep `SpriteSheet.renderInUse` semantics aligned with Java.

### 11. `SpriteSheet` does not extend `Image`

Files:

- Java: `SpriteSheet.java`
- TS: `SpriteSheet.ts`

Java behavior:

- `public class SpriteSheet extends Image`.
- A `SpriteSheet` is usable anywhere an `Image` is expected.
- It inherits `draw`, `copy`, `setTexture`, image state, and resource reference behavior.

Current TS behavior:

- `export class SpriteSheet` is a standalone wrapper with a private `image`.
- Code expecting `sheet instanceof Image` behavior, inherited draw methods, or `setTexture` will fail.

Suggested fix:

- Port `SpriteSheet` as `extends Image`.
- Preserve `target` behavior from Java for sheets backed by another `Image`.
- Implement `initImpl`, cached `subImages`, and `setTexture`.
- Add a TypeScript compile test that passes a `SpriteSheet` where an `Image` is required.

### 12. `SpriteSheet` constructors and defaults differ from Java

Files:

- Java: `SpriteSheet.java`
- TS: `SpriteSheet.ts`

Java behavior:

- Supports constructors from `URL`, `Image`, `String`, transparent `Color`, spacing, margin, and `InputStream`.
- `SpriteSheet(String ref, ...)` loads with `FILTER_NEAREST` by default.
- Bounds are checked and `RuntimeException("SubImage out of sheet bounds: x,y")` is thrown.

Current TS behavior:

- Missing `URL`, transparent color, and input stream/blob constructor equivalents.
- String constructor uses `new Image(ref)`, which defaults to linear.
- Does not cache subimages like Java.
- Bounds checking is not explicit.

Suggested fix:

- Add overloads matching Java.
- Route transparent color into the fixed `Image` loader.
- Use nearest filtering by default for string-backed sheets.
- Cache `subImages` using Java count calculation, including the extra vertical row behavior.
- Add out-of-bounds tests.

### 13. `XMLPackedSheet` silently accepts malformed XML and does not cache images

Files:

- Java: `XMLPackedSheet.java`
- TS: `XMLPackedSheet.ts`

Java behavior:

- Parses XML with DOM.
- Creates and stores subimage `Image` objects in a map during construction.
- Catches resource/parse errors and throws `SlickException("Failed to parse sprite sheet XML", e)`.
- Missing sprite returns `null`.

Current TS behavior:

- Stores raw rectangles and calls `getSubImage` each time.
- Uses fallback numeric values such as 0 when attributes are absent or non-numeric.
- Needs explicit DOMParser error checking. Browser DOMParser can return a document with a parsererror element instead of throwing.

Suggested fix:

- Validate the XML parse result and every required attribute.
- Store subimages in the map to match Java object identity/caching.
- Keep missing sprite return as `null`.
- Add malformed XML tests and repeated `getSprite` identity tests.

### 14. `Color` constants and methods are not Java-exact

Files:

- Java: `Color.java`
- TS: `Color.ts`

Java behavior:

- `darkGray = new Color(0.3f, 0.3f, 0.3f, 1.0f)`.
- `lightGray = new Color(0.7f, 0.7f, 0.7f, 1.0f)`.
- `pink = new Color(255, 175, 175, 255)`.
- `orange = new Color(255, 200, 0, 255)`.
- `add(Color)` and `scale(float)` mutate without clamping.
- `darker()` calls `darker(0.5f)`.
- `darker(float scale)` converts to `1 - scale` and multiplies RGB.
- `brighter()` calls `brighter(0.2f)`.
- `brighter(float scale)` converts to `scale + 1` and multiplies RGB.
- Constructor `Color(float,float,float,float)` caps only upper bound with `Math.min(value, 1)`, not lower bound.
- `hashCode()` is `((int) (r+g+b+a)*255)`, which preserves Java's odd cast-before-multiply behavior.
- Includes `decode`, channel getters, byte getters, `addToCopy`, and `scaleCopy`.

Current TS behavior:

- Uses `darkGray = 0.25`, `lightGray = 0.75`, approximate `pink = 0.68`, approximate `orange = 0.78`.
- `add` and `scale` clamp to `0..1`.
- `brighter` and `darker` use a Java AWT-like factor of `0.7`, not Slick2D's methods.
- Missing `decode`, `getRed`, `getGreen`, `getBlue`, `getAlpha`, `getRedByte`, `getGreenByte`, `getBlueByte`, `getAlphaByte`, `addToCopy`, and `scaleCopy`.
- `hashCode` returns packed color, not Java Slick's value.

Suggested fix:

- Port `Color.java` literally unless a Java number model difference requires a TypeScript-specific note.
- Keep integer constructor behavior for `0xAARRGGBB` and alpha 0 becoming 255.
- Add golden tests for all constructors, constants, methods, `equals`, `toString`, and `hashCode`.

### 15. `Graphics` has explicit unsupported methods and silent wrong methods

Files:

- Java: `Graphics.java`
- TS: `Graphics.ts`

Current explicit unsupported methods:

- `fillRect(..., ShapeFill)` throws.
- `drawOval` throws.
- `drawArc` throws.
- `fillOval` throws.
- `fillArc` throws.
- `drawRoundRect` throws.
- `fillRoundRect` throws.

Current silent or partial behavior:

- `clearAlphaMap()` is empty.
- `setDrawMode(mode)` only stores the mode. Java draw modes change blend functions and color masks.
- `drawGradientLine(...)` ignores both endpoint colors and draws a normal single-color line.
- `copyArea(target, x, y)` reads bytes but never writes them into `target`.
- `getArea(x, y, width, height)` without a target returns a new blank `Image(width,height)` rather than an image containing the framebuffer region.
- Default font `drawString` is a no-op, so `Graphics.drawString` renders nothing unless a real font is injected.
- `setAntiAlias` only stores a flag; it does not affect shape/line rendering.
- `resetTransform` calls `glLoadIdentity`; verify Java stack semantics before relying on this.
- `setWorldClip` converts the transformed bounds to a scissor rectangle. Java uses clipping planes; rotated clips may not match.

Suggested fix:

- Port `geom` and renderer line strip classes before completing shape overloads.
- Implement Java draw modes:
  - `MODE_NORMAL`
  - `MODE_ALPHA_MAP`
  - `MODE_ALPHA_BLEND`
  - `MODE_COLOR_MULTIPLY`
  - `MODE_ADD`
  - `MODE_SCREEN`
- Implement alpha map clear using the Java sequence or a browser-equivalent framebuffer path.
- Implement `copyArea` and `getArea` with real framebuffer-to-texture transfer.
- Add browser pixel tests for each draw mode, gradient line, copy area, world clip, and default string rendering.

### 16. `WebGLRenderer` and `SGL` expose names but do not implement full fixed-function behavior

Files:

- Java renderer package: `C:\java-projects\slick2d\Slick\src\org\newdawn\slick\opengl\renderer`
- TS: `C:\js-projects\slick2d-ts\src\slick\rendering\WebGLRenderer.ts`
- TS: `C:\js-projects\slick2d-ts\src\slick\opengl\renderer\SGL.ts`
- TS: `C:\js-projects\slick2d-ts\src\slick\opengl\renderer\Renderer.ts`

Current issues:

- `glBindTexture(target, id)` binds `null` for nonzero ids.
- `glGetTexImage(...)` fills the supplied buffer with zeros.
- `glDeleteTextures(...)` is empty.
- `glGenTextures(...)` fills ids with zero.
- Display lists store arrays of callbacks, but immediate commands are not recorded into those arrays in the inspected implementation.
- `glTexEnvi`, `glClipPlane`, `glPointSize`, secondary color, mirror clamp, and other fixed-function calls are no-ops or hardcoded false.
- Texture shader uses a single uniform color, so per-vertex color and secondary color effects cannot match Java.
- `Renderer.setRenderer(number)` always chooses `WebGLRenderer`, ignoring the Java renderer type distinction.
- `Renderer.setLineStripRenderer` stores an unknown value but there are no TypeScript ports of the line strip renderer implementations.

Suggested fix:

- Decide whether full `SGL` parity is required. If yes, implement a texture id registry and state machine that maps Slick's fixed-function calls to WebGL.
- Implement real immediate-mode batching for `GL_QUADS`, `GL_TRIANGLES`, and `GL_LINES`, including texture coordinates and colors.
- Implement display list recording or remove the facade from parity claims.
- Port renderer classes:
  - `DefaultLineStripRenderer`
  - `ImmediateModeOGLRenderer`
  - `LineStripRenderer`
  - `QuadBasedLineStripRenderer`
  - `VAOGLRenderer`
- Add tests for copied Java code that calls `Renderer.get()` directly.

### 17. `SlickCallable` is missing Java's abstract call workflow and full safe-state restoration

Files:

- Java: `C:\java-projects\slick2d\Slick\src\org\newdawn\slick\opengl\SlickCallable.java`
- TS: `C:\js-projects\slick2d-ts\src\slick\opengl\SlickCallable.ts`

Java behavior:

- `SlickCallable` is abstract.
- Users subclass it and implement `performGLOperations()`.
- `call()` enters a safe block, invokes `performGLOperations()`, then leaves the safe block.
- `enterSafeBlock()` is guarded by a boolean `inSafe`, saves last bound texture, binds none, pushes GL attributes, client attributes, modelview matrix, and projection matrix.
- `leaveSafeBlock()` restores projection, modelview, client attributes, attributes, and last bound texture.

Current TS behavior:

- Only static `enterSafeBlock()` and `leaveSafeBlock()` exist.
- No abstract `performGLOperations()` or instance `call()` exists.
- Uses a `depth` counter rather than Java's single `inSafe` guard.
- Only flushes and pushes/pops the renderer transform. It does not save texture binding, blend state, color mask, clip/scissor state, shader state, or projection-equivalent state.

Suggested fix:

- Recreate the abstract class shape in TypeScript.
- Add `call()` with `try/finally` so `leaveSafeBlock()` always runs after user operations.
- Implement renderer state snapshots for every Slick/WebGL state that direct GL calls can modify.
- Restore the last texture binding.
- Add tests for subclass `call()`, nested `enterSafeBlock()`, texture restoration, transform restoration, and exceptions thrown from `performGLOperations()`.

### 18. `Input` is a subset and some existing methods are wrong

Files:

- Java: `Input.java`
- TS: `Input.ts`

Current gaps and bugs:

- Key constants are only a subset. Java `Input` exposes many LWJGL key codes not present in TS.
- `consumeEvent()` is empty. Java uses a consumed flag to stop propagation for the current event.
- `considerDoubleClick(...)` is empty. Java emits a second click count when timing and movement are within thresholds.
- `enableKeyRepeat(initial, interval)` stores timing values but the TS event path relies on browser repeated `keydown` events. Java uses repeat timing in the Slick input loop.
- Wheel delta is delivered to listeners but no `getMouseWheelDelta` style state is tracked.
- Controller support is approximate. Java handles buttons, axes, POV, direction presses, and one-based controller button callbacks. TS uses Gamepad axes for directions and marks buttons only when pressed; release events are missing.
- `isButtonPressed(index, controller)` currently reads current pressed state from the Gamepad API, not a one-shot pressed record equivalent to Java.
- Event ordering and primary listener consumption semantics need to be matched.
- Browser pointer events use DOM button numbering. Confirm mapping to Slick left/right/middle constants for every browser.

Suggested fix:

- Port all Java constants exactly.
- Implement the Java listener dispatch model, including consumed events.
- Add state for one-frame pressed records for keyboard, mouse, and controller buttons.
- Implement double-click detection using Java's delay and movement tolerance.
- Implement key repeat using time deltas in `poll`, not browser repeat only.
- Implement controller release callbacks and POV directional pressed/released behavior.
- Add synthetic DOM and fake Gamepad tests for every callback and one-shot state method.

### 19. `ResourceLoader` is syntactic URL resolution, not Java resource location parity

Files:

- Java util package:
  - `ResourceLoader.java`
  - `ResourceLocation.java`
  - `ClasspathLocation.java`
  - `FileSystemLocation.java`
  - `Log.java`
- TS: `ResourceLoader.ts`
- Docs: `RESOURCE-MANAGEMENT-SYSTEM.md`, `SLICK2D-PARITY-API.md`

Java behavior:

- `ResourceLoader` manages `ResourceLocation` objects.
- `getResource` and `getResourceAsStream` search actual locations.
- Resource locations can be classpath or filesystem backed.

Current TS behavior:

- `addResourceLocation(location: unknown)` stores `String(location)`.
- `getResource(ref)` returns the first syntactically valid URL without checking existence.
- `getResourceAsStream(ref)` only returns bytes already registered or loaded; it never performs actual synchronous loading.
- `resourceExists(ref)` only checks the current in-memory record.
- `loadResource(ref)` performs a single `fetch` with no retry, timeout, version query support, cache strategy, progress, or abort.
- `clearCache()` clears all records and tracked promises globally, even if resources are in use.
- The docs describe `ResourceManager`, `ResourceScope`, ownership, failure aggregation, and handler-specific loading, but those classes are not implemented in current source.

Suggested fix:

- Either implement the documented `ResourceManager` and `ResourceScope` design or revise the docs to match a simpler final design. The better route is to implement it.
- Add TypeScript equivalents of `ResourceLocation`, `ClasspathLocation`, and `FileSystemLocation` adapted to browser URL roots and packaged manifests.
- Keep a preload barrier so Java-style synchronous constructors can read already loaded bytes.
- Add retries, timeout, cache-busting/version query support, progress events, and failure aggregation at the resource manager layer.
- Add tests for multiple resource locations, missing resources, failed fetches, retries, registered bytes, and preload scopes.

### 20. `InternalTextureLoader` is mostly a flag holder

Files:

- Java: `InternalTextureLoader.java`
- TS: `InternalTextureLoader.ts`

Java behavior:

- Manages texture cache, texture ids, reload, deferred textures, 16-bit mode, hold texture data, and multiple `getTexture` overloads.

Current TS behavior:

- Stores `holdTextureData`, `deferredLoading`, and `sixteenBit`.
- `clear()` and `clear(name)` are empty.
- `reload()` is empty.
- Missing `createTextureID`, `getTexture`, and `createTexture` equivalents.
- `set16BitMode()` records a flag but does not affect decode/upload format.

Suggested fix:

- Move texture cache ownership here or make it delegate to a real `TextureLoader`.
- Implement clear-by-name and clear-all.
- Implement reload by re-uploading retained source data or re-fetching resources.
- Implement deferred texture resources and ensure they integrate with `LoadingList`.
- Add tests around texture cache identity, clear, reload, and 16-bit/deferred flags.

### 21. Texture and image data subsystem is incomplete

Files:

- Java missing package: `opengl`
- TS present files include `ImageData.ts`, `ImageIOImageData.ts`, `InternalTextureLoader.ts`, `LoadableImageData.ts`, `SlickCallable.ts`, `TGAImageData.ts`.

Missing Java classes:

- `CompositeImageData`
- `CompositeIOException`
- `DeferredTexture`
- `EmptyImageData`
- `GLUtils`
- `ImageDataFactory`
- `PNGDecoder`
- `PNGImageData`
- `Texture`
- `TextureImpl`
- `TextureLoader`

Current issues:

- `ImageIOImageData.loadImage(...)` always throws because browser image decoding is async.
- `TGAImageData` supports only uncompressed true-color TGA files and rejects compressed, color-mapped, or unsupported-depth data. That is documented as phase-one, but not full Slick2D parity.
- There is no full `Texture` or `TextureImpl` abstraction matching Java. `WebGLTextureResource` is an internal browser replacement.
- Texture dimensions, image dimensions, source coordinates, alpha, cache, reload, and held data are spread across `Image` and `WebGLTextureResource`, which makes Java parity hard.

Suggested fix:

- Port `Texture`, `TextureImpl`, `TextureLoader`, `ImageDataFactory`, `PNGImageData`, and related classes as public API surfaces.
- Use async preload internally but expose Java-style constructors only after resources are ready.
- Keep CPU-side image buffers when Java APIs require pixel reads or reload.
- Add PNG, TGA, transparent color, power-of-two texture dimension, and texture cache tests.

### 22. `Music` does not enforce Java's single-current-music model

Files:

- Java: `Music.java`
- TS: `Music.ts`
- TS: `SoundStore.ts`

Java behavior:

- Only one `Music` can play at a time.
- Static `currentMusic` is the sole music being polled.
- Starting new music stops old music and calls old listeners' `musicSwapped(old, newMusic)`.
- `playing()` is true only when `currentMusic == this` and the music is marked playing.
- Constructor validates extension and throws for unsupported formats.

Current TS behavior:

- Tracks `active` as a set, allowing multiple music instances.
- `musicSwapped` is never fired.
- `playing()` returns `this.source !== null`, not Java current-music state.
- Constructor queues load but swallows failures with `.catch(() => undefined)`.
- Extension validation is missing.
- `ArrayBuffer | Blob` constructor registers only `ArrayBuffer`; `Blob` is not registered.
- Streaming hint is accepted but not honored as Java OGG streaming.

Suggested fix:

- Implement static `currentMusic`.
- Stop and notify old music when a new music starts.
- Make `Music.poll(delta)` update only `currentMusic` and fire `musicEnded` through the Java rules.
- Validate `.ogg`, `.wav`, `.xm`, `.mod`, `.aif`, and `.aiff` behavior. If MOD/XM cannot be supported through Web Audio decode, add decoders or throw the same `SlickException` during preload with a clear unsupported browser adaptation note.
- Add fake WebAudio tests for play, loop, pause, resume, stop, fade, swap, end callbacks, and `playing()`.

### 23. `Sound` lacks overloads, validation, and full positional behavior

Files:

- Java: `Sound.java`
- TS: `Sound.ts`

Java behavior:

- Constructors validate supported sound types.
- Supports string, URL, and stream input.
- Supports `playAt(x, y, z)` and `playAt(pitch, volume, x, y, z)`.
- `playAt` uses positional audio in OpenAL.

Current TS behavior:

- Constructor validates no extension.
- `ArrayBuffer` is registered; `Blob` is not.
- Only `playAt(pitch, volume, x, y, z)` exists.
- `playAt` ignores position and delegates to normal play.
- Load failures are swallowed by constructor preload.

Suggested fix:

- Add missing overloads.
- Register `Blob` data.
- Implement positional audio with `PannerNode` where feasible.
- Validate extensions and fail visibly.
- Add tests for all overloads and failure paths.

### 24. `SoundStore` is not full OpenAL/Slick audio parity

Files:

- Java package: `openal`
- TS: `SoundStore.ts`

Missing Java audio classes:

- `AiffData`
- `Audio`
- `AudioImpl`
- `AudioInputStream`
- `AudioLoader`
- `DeferredSound`
- `MODSound`
- `NullAudio`
- `OggData`
- `OggDecoder`
- `OggInputStream`
- `OpenALStreamPlayer`
- `StreamSound`
- `WaveData`

Current issues:

- `setDeferredLoading` stores a flag but no deferred sound resource behavior exists.
- `poll(delta)` is empty.
- `isMusicPlaying()` checks all active handles, including sound effects, not only current music.
- `stopSoundEffect(id)` is empty.
- Source count is active handle count, not OpenAL source pool size.
- Missing `getCurrentMusicVolume`, `setCurrentMusicVolume`, `setMaxSources`, `getSource`, `setMusicPitch`, `pauseLoop`, `restartLoop`, `getOgg`, `getOggStream`, `getWAV`, `getAIF`, and `getMOD`.
- No source/channel limit or source reuse model.

Suggested fix:

- Decide whether to expose Java `Audio` objects directly. For full parity, do it.
- Split music and sound effect tracking.
- Implement a browser source pool with ids if copied Java code depends on ids.
- Implement or explicitly reject streaming and MOD/XM support at construction/preload time.
- Add tests for global volumes, music current volume, source counts, stopped effects, deferred loading, and active music detection.

### 25. `GameContainer`, `AppGameContainer`, `Display`, and `Mouse` are browser shims, not full Java containers

Files:

- Java: `GameContainer.java`, `AppGameContainer.java`, `CanvasGameContainer.java`, `AppletGameContainer.java`
- TS: `GameContainer.ts`, `AppGameContainer.ts`, `Display.ts`, `Mouse.ts`

Current issues:

- Missing Java `CanvasGameContainer` and `AppletGameContainer`.
- `GameContainer.sleep(milliseconds)` only records `lastSleep`; it does not block, which is reasonable in browser but must not be presented as exact behavior.
- `AppGameContainer.start()` creates/resumes Web Audio through `SoundStore.get().init()` during start. Browsers usually require a user gesture. Applications need an explicit audio unlock path.
- `targetFrameRate` and `Display.sync(frameRate)` record the requested frame rate but RAF still runs at browser cadence. Java frame pacing is not reproduced.
- `setUpdateOnlyWhenVisible` affects update but rendering still needs careful Java comparison.
- `Display.setIcon(ByteBuffer[])` is empty.
- `Display.getAvailableDisplayModes()` returns a tiny synthetic list, not true Java display modes.
- `Display.destroy()` only flips a flag and does not destroy the active container.
- `Mouse.setNativeCursor(Cursor)` stores the cursor but sets CSS to `"default"`; it does not create a real cursor from the buffer.
- Pointer lock/fullscreen are async and user-gesture constrained. Java methods are synchronous.

Suggested fix:

- Document browser-specific async APIs separately from Java-compatible methods.
- Provide app-level audio unlock support and avoid hidden AudioContext creation before user gesture where possible.
- Implement frame-rate limiting on top of RAF when `setTargetFrameRate` is set.
- Implement cursor image creation from `Cursor` buffer.
- Add lifecycle tests for start, destroy, pause, resume, visibility, close requests, fullscreen failure, and pointer lock failure.

### 26. Fonts are mostly absent

Files:

- Java root missing:
  - `AngelCodeFont`
  - `SpriteSheetFont`
  - `TrueTypeFont`
  - `UnicodeFont`
- Java font package missing:
  - `Glyph`
  - `GlyphPage`
  - `HieroSettings`
- Java font effects package missing:
  - `ColorEffect`
  - `ConfigurableEffect`
  - `Effect`
  - `EffectUtil`
  - `FilterEffect`
  - `GradientEffect`
  - `OutlineEffect`
  - `OutlineWobbleEffect`
  - `OutlineZigzagEffect`
  - `ShadowEffect`
- TS support files include `BitmapText`, but core Java font classes are not ported.

Current issues:

- Default font drawing is a no-op.
- `Graphics.drawString` cannot match Java unless a game uses a custom browser font implementation.
- AngelCode BMFont parsing, glyph pages, Unicode font rasterization, and effects are absent.

Suggested fix:

- Port `AngelCodeFont` first because Slick games commonly use bitmap fonts.
- Port `SpriteSheetFont` next.
- For `TrueTypeFont` and `UnicodeFont`, decide between browser canvas text rasterization and a deterministic glyph atlas. Document differences.
- Add text metrics tests and browser screenshot tests.

## Missing Java Production Classes By Package

This inventory compares Java production classes under `org.newdawn.slick` to TypeScript classes under `src/slick` by direct class name. It excludes Java `tests`.

| Package | Missing classes |
| --- | --- |
| root | `AngelCodeFont`, `Animation`, `AppletGameContainer`, `BigImage`, `CachedRender`, `CanvasGameContainer`, `ImageBuffer`, `SavedState`, `ShapeFill`, `SpriteSheetFont`, `TrueTypeFont`, `UnicodeFont` |
| `command` | `BasicCommand`, `Command`, `Control`, `ControllerButtonControl`, `ControllerControl`, `ControllerDirectionControl`, `InputProvider`, `InputProviderListener`, `KeyControl`, `MouseButtonControl` |
| `fills` | `GradientFill` |
| `font` | `Glyph`, `GlyphPage`, `HieroSettings` |
| `font/effects` | `ColorEffect`, `ConfigurableEffect`, `Effect`, `EffectUtil`, `FilterEffect`, `GradientEffect`, `OutlineEffect`, `OutlineWobbleEffect`, `OutlineZigzagEffect`, `ShadowEffect` |
| `geom` | `BasicTriangulator`, `Circle`, `Curve`, `Ellipse`, `GeomUtil`, `GeomUtilListener`, `Line`, `MannTriangulator`, `MorphShape`, `NeatTriangulator`, `OverTriangulator`, `Path`, `Point`, `Polygon`, `Rectangle`, `RoundedRectangle`, `Shape`, `ShapeRenderer`, `TexCoordGenerator`, `Transform`, `Triangulator`, `Vector2f` |
| `gui` | `AbstractComponent`, `BasicComponent`, `ComponentListener`, `GUIContext`, `MouseOverArea`, `TextField` |
| `imageout` | `ImageIOWriter`, `ImageOut`, `ImageWriter`, `ImageWriterFactory`, `TGAWriter` |
| `loading` | `DeferredResource`, `LoadingList` |
| `muffin` | `FileMuffin`, `Muffin`, `WebstartMuffin` |
| `openal` | `AiffData`, `Audio`, `AudioImpl`, `AudioInputStream`, `AudioLoader`, `DeferredSound`, `MODSound`, `NullAudio`, `OggData`, `OggDecoder`, `OggInputStream`, `OpenALStreamPlayer`, `StreamSound`, `WaveData` |
| `opengl` | `CompositeImageData`, `CompositeIOException`, `DeferredTexture`, `EmptyImageData`, `GLUtils`, `ImageDataFactory`, `PNGDecoder`, `PNGImageData`, `Texture`, `TextureImpl`, `TextureLoader` |
| `opengl/pbuffer` | `FBOGraphics`, `GraphicsFactory`, `PBufferGraphics`, `PBufferUniqueGraphics` |
| `opengl/renderer` | `DefaultLineStripRenderer`, `ImmediateModeOGLRenderer`, `LineStripRenderer`, `QuadBasedLineStripRenderer`, `VAOGLRenderer` |
| `particles` | `ConfigurableEmitter`, `ConfigurableEmitterFactory`, `Particle`, `ParticleEmitter`, `ParticleIO`, `ParticleSystem` |
| `particles/effects` | `FireEmitter` |
| `state` | `BasicGameState`, `GameState`, `StateBasedGame` |
| `state/transition` | `BlobbyTransition`, `CombinedTransition`, `CrossStateTransition`, `EmptyTransition`, `FadeInTransition`, `FadeOutTransition`, `HorizontalSplitTransition`, `RotateTransition`, `SelectTransition`, `Transition`, `VerticalSplitTransition` |
| `svg` | `Diagram`, `Figure`, `Gradient`, `InkscapeLoader`, `LinearGradientFill`, `Loader`, `NonGeometricData`, `ParsingException`, `RadialGradientFill`, `SimpleDiagramRenderer`, `SVGMorph` |
| `svg/inkscape` | `DefsProcessor`, `ElementProcessor`, `EllipseProcessor`, `GroupProcessor`, `InkscapeNonGeometricData`, `LineProcessor`, `PathProcessor`, `PolygonProcessor`, `RectProcessor`, `UseProcessor`, `Util` |
| `tiled` | `Layer`, `TiledMap`, `TileSet` |
| `util` | `Bootstrap`, `BufferedImageUtil`, `ClasspathLocation`, `DefaultLogSystem`, `FileSystemLocation`, `FontUtils`, `InputAdapter`, `LocatedImage`, `LogSystem`, `MaskUtil`, `OperationNotSupportedException`, `ResourceLocation` |
| `util/pathfinding` | `AStarHeuristic`, `AStarPathFinder`, `Mover`, `Path`, `PathFinder`, `PathFindingContext`, `TileBasedMap` |
| `util/pathfinding/heuristics` | `ClosestHeuristic`, `ClosestSquaredHeuristic`, `ManhattanHeuristic` |
| `util/pathfinding/navmesh` | `Link`, `NavMesh`, `NavMeshBuilder`, `NavPath`, `Space` |
| `util/xml` | `ObjectTreeParser`, `SlickXMLException`, `XMLElement`, `XMLElementList`, `XMLParser` |

## Missing Feature Groups And Suggested Port Strategy

### Core animation

Missing: `Animation`.

Why it matters:

- Slick2D games commonly rely on frame duration, auto-update, ping-pong, looping, stop-at, restart, and image array/sprite sheet constructors.

Suggested fix:

- Port `Animation.java` class-for-class.
- Use Java's delta-based update logic.
- Add tests for frame transitions, loop stop, manual frame set, speed changes, and draw overloads.

### Big images and cached rendering

Missing: `BigImage`, `CachedRender`, `ImageBuffer`, `SavedState`.

Why it matters:

- Large map backgrounds and render-to-texture workflows can depend on these.
- `ImageBuffer` is also useful for deterministic pixel tests.

Suggested fix:

- Implement `ImageBuffer` as CPU pixel storage that can create an `Image`.
- Implement `BigImage` with tiled texture backing if WebGL max texture size is exceeded.
- Implement `CachedRender` with framebuffer-backed `Image` or retained command buffer, depending on Java behavior.
- Implement `SavedState` with browser storage if Java file state cannot map exactly.

### Geometry and shape rendering

Missing: the full `geom` package.

Why it matters:

- `Graphics.draw(Shape)`, `Graphics.fill(Shape)`, collision/intersection code, shape transforms, and path utilities rely on it.

Suggested fix:

- Port value classes first: `Vector2f`, `Transform`, `Shape`, `Point`, `Line`, `Circle`, `Ellipse`, `Rectangle`, `RoundedRectangle`, `Polygon`.
- Port triangulators and `ShapeRenderer` after shapes compile.
- Add numerical tests for bounds, contains, intersects, transform results, and triangulation output.

### GUI components

Missing: `AbstractComponent`, `BasicComponent`, `ComponentListener`, `GUIContext`, `MouseOverArea`, `TextField`.

Why it matters:

- Slick games may use built-in mouse areas and text input controls.

Suggested fix:

- Port these after `Input`, `Font`, and `Graphics` behavior is stable.
- `GUIContext` can map to `GameContainer`.
- Add tests for mouse enter/exit, click, focus, text entry, cursor position, and listener callbacks.

### Command input abstraction

Missing: `command` package.

Why it matters:

- Games can map keys, mouse buttons, and controller directions through command abstractions instead of direct `Input` calls.

Suggested fix:

- Port after `Input` parity is fixed.
- Preserve pressed/down semantics exactly.
- Add tests that simulate key, mouse, and controller events through `InputProvider`.

### Particles

Missing: `particles` and `particles/effects`.

Why it matters:

- Particle XML and emitters are part of Slick2D's public feature set.

Suggested fix:

- Port `Particle`, `ParticleEmitter`, `ConfigurableEmitter`, `ParticleSystem`, `ParticleIO`, and `FireEmitter`.
- Depends on `Image`, `Color`, XML parsing, and `Graphics`.
- Add deterministic update tests with fixed deltas and render smoke tests.

### Game states and transitions

Missing: `state` and `state/transition`.

Why it matters:

- Many Slick games use `StateBasedGame` instead of `BasicGame`.

Suggested fix:

- Port `GameState`, `BasicGameState`, and `StateBasedGame`.
- Then port transitions one by one.
- Add tests for init order, enter/leave callbacks, update/render delegation, state ids, and transition timing.

### Tiled maps

Missing: `tiled` package.

Why it matters:

- Slick includes TMX map loading and rendering.

Suggested fix:

- Port `TiledMap`, `Layer`, and `TileSet`.
- Depends on XML, `SpriteSheet`, `Image`, and `Color`.
- Add TMX fixture tests for orthogonal maps, tileset spacing/margins, object layers if supported by Java version, and tile properties.

### SVG and Inkscape

Missing: `svg` and `svg/inkscape` packages.

Why it matters:

- Some Slick games use SVG diagrams, gradients, and Inkscape-specific processors.

Suggested fix:

- Port XML parser wrappers first.
- Port figure/diagram data model, gradient fills, and processors.
- Rendering should use the fixed geometry and shape renderer pipeline.
- Add fixture SVGs from Java tests and compare parsed figures plus rendered output.

### Pathfinding

Missing: `util/pathfinding`, `util/pathfinding/heuristics`, and `util/pathfinding/navmesh`.

Why it matters:

- These are pure logic classes and can be ported with high confidence.

Suggested fix:

- Port these early because they do not depend heavily on browser APIs.
- Add Java golden tests for paths and heuristic values.
- Keep Java collection ordering behavior where it affects tie-breaks.

### Image output

Missing: `imageout` package.

Why it matters:

- Java can write PNG/TGA images. Browser equivalent needs downloads or blobs.

Suggested fix:

- Implement `ImageWriter` abstractions using canvas encode APIs where possible.
- Implement `TGAWriter` in pure TypeScript.
- Add output byte tests for TGA and blob type tests for browser image output.

### Muffin saved data

Missing: `muffin` package.

Why it matters:

- Slick's saved data API is public.

Suggested fix:

- Map `FileMuffin` and `WebstartMuffin` to browser storage with explicit limitations.
- Provide import/export or IndexedDB for larger data.
- Add persistence tests with isolated storage.

### Loading

Missing: `DeferredResource`, `LoadingList`.

Why it matters:

- Java deferred loading coordinates with texture/audio deferred behavior.

Suggested fix:

- Implement after `ResourceManager`, `TextureLoader`, and `SoundStore` deferred flags.
- Add tests for resource count, load order, failed resources, and progress.

### Logging and resource locations

Missing: `DefaultLogSystem`, `LogSystem`, `ClasspathLocation`, `FileSystemLocation`, `ResourceLocation`, `OperationNotSupportedException`, `InputAdapter`, `FontUtils`, `MaskUtil`, `LocatedImage`, `BufferedImageUtil`, `Bootstrap`.

Suggested fix:

- Port `LogSystem` and `DefaultLogSystem` so Java logging hooks work.
- Port `InputAdapter` as a no-op listener convenience class.
- Port `FontUtils` after fonts.
- Port resource location classes as browser-adapted URL/package sources.
- Only port `Bootstrap` if browser packaging needs it; otherwise provide a documented no-op or unsupported exception.

## TypeScript-Only Or Browser-Adapted Files To Review

The TS project has helper files that do not correspond directly to Java Slick2D classes:

- `src/slick/ApplicationGameContainer.ts`
- `src/slick/ScalableGame2.ts`
- `src/slick/rendering/*`
- `src/slick/support/*`
- `src/lwjgl/*`

These are not wrong by themselves, but they must not hide missing Java behavior. For every helper, decide whether it is:

- an internal implementation detail behind a Java-compatible public API,
- a browser-specific convenience API outside Java parity,
- or a temporary substitute that must be replaced by a class-for-class port.

Document that decision in the code or docs.

## Documentation Gaps

Current docs are helpful but can mislead a future porter:

- `IMPLEMENTATION-AUDIT.md` says the library covers direct Slick2D/LWJGL calls observed in selected games, not full Slick2D.
- `SLICK2D-PARITY-API.md` contains explicit phase-one unsupported choices. Those choices are not acceptable for full parity.
- `RESOURCE-MANAGEMENT-SYSTEM.md` describes a ResourceManager/ResourceScope architecture that is not present in current source.

Suggested fix:

- Add a generated parity manifest that lists every Java class, constructor, method, field, and constant, with status:
  - `ported_exact`
  - `ported_browser_adapted`
  - `ported_incorrect`
  - `stub`
  - `missing`
  - `not_applicable_with_reason`
- Keep the manifest checked in and update it on every fix.
- Make docs clearly distinguish current implementation status from desired design.

## Verification Plan For The Fixing AI

### 1. Create automated API parity extraction

Build a script that parses Java and TS source and emits a machine-readable manifest:

- Java package and class name.
- Java superclass and interfaces.
- Public/protected constants and fields.
- Constructors and overloads.
- Public/protected methods and overloads.
- Declared exceptions where relevant.
- TS corresponding file path.
- TS exported class/interface/function names.
- Missing and extra members.

Do not rely only on regex long term. Use JavaParser or `javac` reflection for Java if possible, and the TypeScript compiler API for TS.

### 2. Add golden behavior tests

Use small Java programs or existing Java test/demo classes to generate golden outputs for pure logic:

- `Color`
- geometry
- pathfinding
- animation frame progression
- tiled map parsing
- packed sheet parsing
- XML helper classes

Then assert TypeScript output matches.

### 3. Add browser rendering tests

Use Playwright or equivalent:

- render tiny fixtures to a canvas,
- sample pixels,
- compare against expected colors and alpha,
- test image flips, subimages, scaling, copy area, draw modes, shape fills, gradients, fonts, and clipping.

### 4. Add fake WebAudio tests

Mock enough Web Audio API to test:

- decode failure and success,
- sound play/loop/stop,
- music singleton swapping,
- listener callbacks,
- fade timing,
- global and per-music volumes,
- source cleanup.

### 5. Add resource manager tests

Use a fake `fetch`:

- registered byte reads,
- multiple resource locations,
- missing resource handling,
- retries and failure aggregation,
- version/cache-busting query behavior,
- scope ownership and cleanup.

## Suggested Fix Order

1. Generate the parity manifest so progress cannot drift.
2. Fix `Color`, `PackedSpriteSheet`, `ResourceLoader`, and `Image` constructor/data bugs. These affect many games and are concrete.
3. Fix `SpriteSheet` inheritance/defaults/caching and `XMLPackedSheet` validation/caching.
4. Fix image texture identity, `Image.bind`, `getColor`, `getScaledCopy`, `ensureInverted`, transparent color, and stream/blob construction.
5. Fix `Input` constants and event semantics.
6. Fix `Music`, `Sound`, and `SoundStore` singleton/current-music behavior and visible failure paths.
7. Implement font rendering, starting with `AngelCodeFont` and `SpriteSheetFont`.
8. Port `Animation`.
9. Port geometry and shape rendering, then complete `Graphics`.
10. Port state, tiled, particles, command, GUI, SVG, pathfinding, imageout, muffin, loading, and remaining util classes.
11. Re-run the manifest and keep fixing until every Java production class and public/protected member is accounted for.

## Definition Of Done

Do not call `slick2d-ts` a full Slick2D port until all of these are true:

- Every Java production class under `org.newdawn.slick` has a TypeScript counterpart or a documented browser-specific exclusion.
- Every public/protected Java constructor, method, field, and constant is represented in TypeScript or listed with a specific reason.
- Every implemented class has behavior tests against Java outputs where possible.
- Rendering behavior has pixel tests for texture, color, alpha, clipping, transforms, shapes, text, and framebuffer operations.
- Audio behavior has WebAudio tests and visible load/playback failure reporting.
- Resource loading has preload, retry, failure aggregation, and cache/version tests.
- Existing docs no longer describe unimplemented systems as if they already exist.
- The package can be used by ports other than Ms. Pac-Man without hitting phase-one stubs for normal Slick2D APIs.
