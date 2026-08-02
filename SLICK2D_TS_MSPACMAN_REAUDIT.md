# Slick2D TS Ms. Pac-Man Re-Audit

Date: 2026-08-02

Scope: re-audit `C:\js-projects\slick2d-ts` against `C:\java-projects\slick2d` for issues relevant to porting `C:\NetBeansProjects\SlickMsPacMan` as a desktop-browser PWA SPA. This is not a full Slick2D class-completeness audit. Java-only desktop/applet features are not treated as mandatory unless the Ms. Pac-Man port depends on the observable behavior.

## High-Level Result

Several earlier graphics blockers appear to have been fixed well enough for this game:

- `PackedSpriteSheet` now defaults to nearest filtering and parses the `.def` structure much closer to Java. Java default filter is `Image.FILTER_NEAREST` in `PackedSpriteSheet.java:27`; TS uses `Image.FILTER_NEAREST` in `src/slick/PackedSpriteSheet.ts:37-39`.
- `PackedSpriteSheet.getSpriteSheet()` now returns a real `SpriteSheet` view (`src/slick/PackedSpriteSheet.ts:66-74`), which matches Java `PackedSpriteSheet.java:116`.
- `Image` now tracks vertical flip/inversion, alpha, subimages, and flipped copies in ways that fit this game's actual calls (`src/slick/Image.ts:128-148`, `369-390`, `443-450`, `548-555`). Java equivalents are `Image.java:929-930`, `1230-1235`, `1244-1255`.
- Textured rendering now applies image alpha and per-corner color data (`src/slick/rendering/WebGLRenderer.ts:197-240`), which is important for the game's fade overlays and sprite alpha.
- The game's direct GL transform usage is likely covered for its current calls: `GL11.glPushMatrix`, `glPopMatrix`, `glTranslatef`, `glScalef`, `glRotatef` route to the renderer, and `ScalableGame2` has the same broad transform wrapper shape as the Java copy.

The remaining relevant problems are concentrated in audio lifecycle/loading, browser resource-loading contracts, keyboard defaults, and async fullscreen sizing.

## Findings To Fix

### 1. `Music` construction no longer blocks or decodes, so `LoadingMode` can finish before music is actually ready

Severity: critical for game parity.

Java behavior:

- `LoadingMode.update()` creates one `Music` per load step (`SlickMsPacMan/src/mspacman/LoadingMode.java:26-59`).
- In Java Slick2D, the `Music(String ref, boolean streamingHint)` constructor initializes `SoundStore` and synchronously loads the audio through `SoundStore.getOgg(ref)`, `getWAV(ref)`, etc. (`Slick/src/org/newdawn/slick/Music.java:155-177`).
- A failed load throws `SlickException` from the constructor (`Music.java:174-177`).

Current TS behavior:

- The string constructor only queues a byte fetch and swallows the local catch: `void ResourceLoader.loadResource(this.ref).catch(() => undefined);` (`slick2d-ts/src/slick/Music.ts:47-50`).
- Actual decode happens later in `loadBuffer()` through `SoundStore.get().loadAudioBuffer(this.ref)` (`Music.ts:252-257`).
- `start()` catches and drops any load/decode/play failure (`Music.ts:187-233`).
- `AppGameContainer.start()` waits for resources only once after `game.init()` (`AppGameContainer.ts:129-131`). Ms. Pac-Man creates its music after init, inside `LoadingMode.update()`, so this wait does not protect the loading-mode music steps.

Game impact:

- The loading bar can advance from load indices 12 down to 0 without the music files being fetched or decoded.
- Intro/cutscene timers can begin while music is still loading. For example, `IntroMode` starts `introMusic.play()` at fade completion (`IntroMode.java:49-53`), and cutscene modes poll `music.playing()` before calling `play()` (`Act1Mode.java:240-242`, `Act2Mode.java:207-208`, `Act6Mode.java:153-154`).
- Audio errors will not reliably reach the PWA loading error UI.

Suggested fix:

- Add an explicit, waitable audio readiness path to Slick2D TS, not an app-only convention. Options:
  - Eagerly fetch and decode `Music` during construction after the user gesture has created/resumed the `AudioContext`, and track that promise through `ResourceLoader.track()`.
  - Or expose `music.ready(): Promise<void>` / `music.load(): Promise<void>` and make the ported `LoadingMode` await each step before decrementing `loadIndex`.
- Do not swallow decode/load errors. Propagate them so the splash/loading screen can show a real error.
- Ensure this works with the required PWA start button/user gesture. The menu's Start handler should create/resume Web Audio before audio preload begins.

### 2. `Sound` construction fetches bytes but does not decode, so first play has latency and failures are delayed

Severity: high for game feel and error handling.

Java behavior:

- `new Sound("soundfx/...ogg")` synchronously loads/decodes the sound in the constructor (`Slick/src/org/newdawn/slick/Sound.java:82-100`).
- `Sound.play()` plays the already-loaded `Audio` immediately (`Sound.java:103-118`).

Current TS behavior:

- The TS `Sound` constructor only queues `ResourceLoader.loadResource(this.ref)` (`slick2d-ts/src/slick/Sound.ts:21-24`).
- Decode happens on first playback inside `SoundStore.playSound()`: `this.loadAudioBuffer(ref).then(...)` (`openal/SoundStore.ts:223-246`).
- Playback decode errors are swallowed by `playSound()`'s catch (`SoundStore.ts:246-250`).

Game impact:

- `Main.loadSoundEffects()` constructs every sound effect up front (`Main.java:524-537`), and Java guarantees those sound effects are ready afterward.
- In TS, the first pellet, energizer, fruit, extra-life, or cutscene sound can be late because decode starts only on first play.
- If a sound is corrupt/missing, the app may continue past loading and silently skip the sound later.

Suggested fix:

- Mirror the `Music` fix for `Sound`: add an eager decode/ready path after audio unlock and track it through the loading pipeline.
- Treat decode failures as loading failures for assets required by this game.
- Keep `Sound.play()` non-async for call-site parity, but make readiness guaranteed by the time the game leaves loading.

### 3. TS `Music` does not enforce Java Slick2D's single current music channel

Severity: high for cutscenes and mode transitions.

Java behavior:

- `Music` has a static `currentMusic` field (`Music.java:20-21`).
- `startMusic()` stops the previous music and fires swap notifications before starting the new track (`Music.java:259-272`).
- `playing()` is true only when `currentMusic == this` and the instance's `playing` flag is true (`Music.java:307-309`).

Current TS behavior:

- TS stores a static `active` set, not a single `currentMusic` (`slick2d-ts/src/slick/Music.ts:19-35`).
- `start()` only stops this instance's existing source; it does not stop a different `Music` instance (`Music.ts:178-233`).
- `playing()` returns `this.source !== null` (`Music.ts:130-133`).

Game impact:

- Ms. Pac-Man often uses `Main.playMusic()` / `Main.loopMusic()`, but some modes call `Music.play()` directly. Examples: `IntroMode.java:52`, `Act1Mode.java:241`, `Act2Mode.java:208`, `Act3Mode.java:168`, `Act6Mode.java:154`.
- Those direct calls rely on Java Slick2D's global music-channel behavior. Without it, old tracks can overlap new tracks.

Suggested fix:

- Reintroduce Java-compatible `Music.currentMusic` semantics in TS.
- Starting any `Music` should stop/swap the previous current music before starting this one.
- `playing()` should report Java semantics, not merely the presence of an internal Web Audio source.
- Preserve listener behavior for `musicEnded()` and `musicSwapped()` even if this game does not currently attach listeners.

### 4. `Music.stop()` and pending async starts can race; stopped music can start later

Severity: high.

Current TS behavior:

- `start()` increments `startToken` and checks it after `loadBuffer()` resolves (`Music.ts:186-190`).
- `stop()` does not increment or invalidate `startToken` (`Music.ts:114-121`).
- If `stop()` is called while `loadBuffer()` is pending, the pending `.then()` can still create and start a source after the mode has changed (`Music.ts:187-233`).

Game impact:

- `Main.stopMusic()` is called during mode transitions (`Main.java:491-497`, `499-520`).
- A track requested by a cutscene or intro can begin late after the game already stopped or switched modes.

Suggested fix:

- Increment `startToken` or otherwise cancel pending starts in `stop()` and `pause()`.
- Clear `source`, `gain`, and tracked handles predictably after stop.
- Do not catch and ignore load/decode errors; cancellation should be separate from failure swallowing.

### 5. `GameContainer.setMusicOn(false)` / `SoundStore.setMusicOn(false)` does not pause active music

Severity: high for pause behavior.

Java behavior:

- `SoundStore.setMusicOn(false)` calls `pauseLoop()`; `setMusicOn(true)` calls `restartLoop()` and reapplies the music volume (`Slick/src/org/newdawn/slick/openal/SoundStore.java:119-127`).

Current TS behavior:

- `SoundStore.setMusicOn()` only changes a boolean (`slick2d-ts/src/slick/openal/SoundStore.ts:67-70`).
- `GameContainer.setMusicOn()` directly delegates to `SoundStore` (`slick2d-ts/src/slick/GameContainer.ts:271-274`).

Game impact:

- `Main.update()` pauses/resumes music through `gc.setMusicOn(false)` and `gc.setMusicOn(true)` (`Main.java:168-174`).
- In TS, active music continues playing under the pause overlay.

Suggested fix:

- Track the current music handle/source and pause it when music is turned off.
- Resume from the same position when music is turned back on.
- Keep this distinct from muting volume: Java's behavior is pause/resume, not merely gain = 0.

### 6. `PackedSpriteSheet` still requires `.def` files to be preloaded synchronously before `Main.loadGraphics()`

Severity: high unless the PWA loader already registers these resources before game init.

Java behavior:

- Java `PackedSpriteSheet.loadDefinition()` reads the definition file through `ResourceLoader.getResourceAsStream(def)` during construction (`PackedSpriteSheet.java:128`).
- Ms. Pac-Man constructs both packed sheets inside `Main.loadGraphics()` (`Main.java:543-547`).

Current TS behavior:

- TS `PackedSpriteSheet` calls `ResourceLoader.getResourceAsStream(def)` and throws if the bytes are not already present (`slick2d-ts/src/slick/PackedSpriteSheet.ts:37-43`).
- TS `ResourceLoader.getResourceAsStream()` explicitly never performs a synchronous fetch; it returns only already-loaded bytes (`slick2d-ts/src/slick/util/ResourceLoader.ts:72-83`).
- `AppGameContainer.start()` waits after `game.init()` (`AppGameContainer.ts:129-131`), which is too late for synchronous `.def` consumers inside `Main.init()`.

Game impact:

- If the web port directly calls `AppGameContainer.start()` and relies on image construction to fetch files, `new PackedSpriteSheet("images/pack_1.def", ...)` will fail immediately.

Suggested fix:

- Before `game.init()`, preload and `ResourceLoader.registerResource()` at least:
  - `images/pack_1.def`
  - `images/pack_2.def`
- If stage/demo loading is ported through `ResourceLoader`, preload those binary files too before the Java-equivalent synchronous reads.
- Document this as a hard browser contract in slick2d-ts or provide an async-safe loader wrapper for Java-style ports.

### 7. Resource fetching has no retry/cache-version hook, which conflicts with the PWA port requirements

Severity: medium to high for deployability.

Current TS behavior:

- `ResourceLoader.loadResource()` performs a single `fetch(url)` with no retry (`slick2d-ts/src/slick/util/ResourceLoader.ts:116-146`).
- `ResourceLoader.getResource()` constructs URLs without a global version/timestamp query parameter (`ResourceLoader.ts:58-70`).

Game/PWA impact:

- The port requirements call for loading retries and user-visible loading errors.
- The port requirements also call for timestamp/version query parameters on referenced resources to help clear caches.
- Any asset loaded through Slick (`Image`, `Sound`, `Music`, `PackedSpriteSheet` image refs) bypasses that requirement unless an outer manifest preloads bytes and registers them by Java ref.

Suggested fix:

- Either add `ResourceLoader.setCacheBust(value)` / URL transform support and retry options, or ensure the PWA loader owns all fetches and feeds Slick only registered bytes.
- If implemented in `ResourceLoader`, preserve Java-style refs as cache keys while adding the query only to the network URL.
- Loading failures should surface to the splash screen rather than being swallowed locally.

### 8. Browser keyboard defaults are not prevented for game keys

Severity: medium for desktop-browser playability.

Java behavior:

- LWJGL owns keyboard input; arrow keys and Space do not scroll the page or activate DOM controls.
- `Input.isKeyPressed()` consumes the press record (`Slick/src/org/newdawn/slick/Input.java:667-674`), and `clearKeyPressedRecord()` clears all key press records (`Input.java:734-736`).

Current TS behavior:

- TS binds keydown/keyup listeners to `window` (`slick2d-ts/src/slick/Input.ts:131-140`, `AppGameContainer.ts:119-121`).
- `handleKeyDown()` maps and records keys but never calls `event.preventDefault()` (`Input.ts:480-497`).
- The game uses arrows, WASD, IJKL, top-row 2/4/6/8, Enter, Space, Escape, and P (`HumanInput.java:17-49`). TS maps those keys (`Input.ts:23-78`, `620-675`).

Game impact:

- Arrow keys and Space can scroll the page or interact with focused controls.
- Escape can interact with browser fullscreen state independently of the game's fullscreen toggle.
- This is especially important because the PWA must include a menu with a Start button and volume slider; focus may remain on DOM controls unless explicitly managed.

Suggested fix:

- When the game canvas is active, call `preventDefault()` for mapped game-control keys.
- Do not block normal keyboard behavior while the menu screen or volume slider has focus.
- On Start, focus the canvas or route input only after the menu yields to the game.

### 9. Fullscreen/display-mode changes are async in TS but the Java game assumes synchronous sizing

Severity: medium.

Java behavior:

- `AppGameContainer.setDisplayMode()` updates width/height and calls LWJGL display changes synchronously (`Slick/src/org/newdawn/slick/AppGameContainer.java:109-153`).
- Ms. Pac-Man immediately calls `scalableGame.containerSizeChanged(gc)` after toggling display mode (`Main.java:202-203`, `210-211`).

Current TS behavior:

- `AppGameContainer.setFullscreen()` returns a `Promise` from `requestFullscreen()` / `exitFullscreen()` (`slick2d-ts/src/slick/AppGameContainer.ts:83-94`).
- A direct 1-to-1 port of `Main.fullScreenToggleCheck()` would call `containerSizeChanged()` before the browser fullscreen transition and layout update have completed.

Game impact:

- Render scale, clip offsets, and input transforms can be calculated from stale canvas/display sizes.
- `ScalableGame2.containerSizeChanged()` sets input scale/offset, so stale values can make the player controls and mouse coordinates wrong after fullscreen toggles.

Suggested fix:

- For the browser port, wrap fullscreen toggles in an async adapter: await the display-mode/fullscreen promise, update canvas dimensions, then call `containerSizeChanged()`.
- Also listen to `fullscreenchange` and resize events and recalculate `ScalableGame2` dimensions there.
- This is a browser adaptation, but it is required for the Java call pattern to behave correctly.

## Verify Intent, But Do Not Treat As Mandatory Java Parity

These are relevant observations, but may be intentionally different for the desktop-browser PWA:

- Native cursor hiding: Java hides the cursor by installing an empty 32x32 `Cursor` (`Main.java:274-279`). TS `Mouse.setNativeCursor(cursor)` currently sets CSS cursor to `"default"` for any non-null cursor (`src/lwjgl/input/Mouse.ts:39-50`). If the port keeps the browser cursor visible for the hamburger/menu workflow, this can be intentional. If exact fullscreen behavior is desired, TS needs a CSS `cursor: none` or transparent cursor path.
- Applet-specific `AppletGameContainer2` behavior should not be recreated for the PWA unless the port deliberately depends on one of its non-applet helper methods.
- Full class-for-class Slick2D coverage is still far from complete by file count, but this re-audit did not re-list missing Java-only classes that Ms. Pac-Man does not use.

## Suggested Regression Tests For The Other AI

Add focused tests or browser harness checks before considering slick2d-ts ready for this game:

1. Construct each Ms. Pac-Man `Music` resource through the loading path and assert the loading step does not complete until bytes are fetched and decoded.
2. Start `Music A`, then start `Music B`; assert `A.playing()` becomes false, `B.playing()` becomes true, and no overlap reaches the music bus.
3. Call `music.play()`, stop it before `loadBuffer()` resolves, then resolve the mocked decode; assert no source starts.
4. Start looping music, call `GameContainer.setMusicOn(false)`, assert playback pauses; call `setMusicOn(true)`, assert playback resumes from the saved position.
5. Construct every `Sound` from `Main.loadSoundEffects()` and assert decode is complete before gameplay begins; corrupt one asset and assert the loading UI receives an error.
6. Run `PackedSpriteSheet("images/pack_1.def", Image.FILTER_NEAREST)` without pre-registering the `.def`; assert the failure is explicit. Then pre-register `.def` and image bytes and assert all sprites used by `Main.loadGraphics()` resolve.
7. In a browser test, press Arrow keys and Space while the game canvas is focused and assert `event.defaultPrevented === true`; repeat with the menu volume slider focused and assert slider behavior still works.
8. Toggle fullscreen and assert `ScalableGame2` render offsets and input transforms are recalculated after the browser fullscreen transition, not before.

