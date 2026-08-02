# Slick2D TS Ms. Pac-Man Re-Audit 3

Date: 2026-08-02

Scope: another audit of `C:\js-projects\slick2d-ts` against Java Slick2D in `C:\java-projects\slick2d\Slick`, focused on issues that can still affect the desktop-browser PWA SPA port of `C:\NetBeansProjects\SlickMsPacMan`.

This pass intentionally does not re-list Java desktop/applet omissions unless they can change this game's browser behavior. It also does not re-list the earlier close-request, stale close flag, async resource error hook, pause clearing, and DOM-control key acceptance bugs because the current TS source appears to have fixes for those.

## Audit Snapshot

- Java Slick2D files under `Slick\src\org\newdawn\slick`: 302 `.java` files, 222 excluding `tests`.
- TypeScript files under `C:\js-projects\slick2d-ts\src`: 66 `.ts` files.
- TypeScript files under `src\slick` plus `src\lwjgl`: 65 `.ts` files.
- `npm.cmd run typecheck` in `C:\js-projects\slick2d-ts` passes with `tsc -p tsconfig.json --noEmit`.

## Current Fixes Verified From Earlier Reports

- `AppGameContainer` now checks `Display.isCloseRequested()` before calling `game.closeRequested()` (`C:\js-projects\slick2d-ts\src\slick\AppGameContainer.ts:319-322`).
- `Display.create()`, `Display.destroy()`, and `Display.setActiveContainer(non-null)` reset `closeRequested` (`C:\js-projects\slick2d-ts\src\lwjgl\opengl\Display.ts:39-46`, `63-75`).
- `AppGameContainer` has an error handler path and calls it from RAF/resource failures (`C:\js-projects\slick2d-ts\src\slick\AppGameContainer.ts:62-64`, `409-436`).
- `Input.pause()` and paused `poll()` now clear pressed records (`C:\js-projects\slick2d-ts\src\slick\Input.ts:447-456`, `479-487`).
- Key events from focused interactive DOM controls are now rejected by `shouldAcceptGameKey()` (`C:\js-projects\slick2d-ts\src\slick\Input.ts:679-695`).

## Findings To Fix

### 1. Focus loss can leave movement keys stuck down

Severity: high for desktop-browser gameplay.

Java behavior:

- Java `Input.poll()` clears key, mouse, and controller pressed records whenever `Display.isActive()` is false (`C:\java-projects\slick2d\Slick\src\org\newdawn\slick\Input.java:1128-1143`).
- Java `Input.isKeyDown(int)` reads LWJGL's current keyboard state (`Input.java:753-755`), so when the native display loses focus, stale browser-style event state is not retained.
- Java `AppGameContainer.hasFocus()` delegates to `Display.isActive()` (`C:\java-projects\slick2d\Slick\src\org\newdawn\slick\AppGameContainer.java:468-470`).

Current TS behavior:

- `Input.bindToElement()` registers `keydown`, `keyup`, pointer, and wheel listeners only. There is no `window.blur`, `document.visibilitychange`, or equivalent lost-focus cleanup (`C:\js-projects\slick2d-ts\src\slick\Input.ts:132-142`).
- `Input.poll()` updates height, clears pressed records only when explicitly paused, then polls controllers. It does not check `Display.isActive()` and does not clear `downKeys` or `downMouse` on browser focus loss (`Input.ts:447-457`).
- `AppGameContainer.hasFocus()` returns true if `document.hasFocus()` is true or if the canvas is still `document.activeElement` (`C:\js-projects\slick2d-ts\src\slick\AppGameContainer.ts:212-215`). In browsers, `document.activeElement` can remain the canvas after tab/window blur, so the canvas clause can mask actual window focus loss.

Why this matters for Ms. Pac-Man:

- The player's movement is driven by held-key state, not only one-shot key presses:
  - `HumanInput.isUp()` checks `input.isKeyDown(Input.KEY_UP)` and alternates (`C:\NetBeansProjects\SlickMsPacMan\src\mspacman\HumanInput.java:16-19`).
  - `isDown()`, `isLeft()`, and `isRight()` do the same for movement directions (`HumanInput.java:21-34`).
- If the player holds a direction key and the browser loses focus before `keyup` is delivered, TS can keep that key in `downKeys`. On refocus, Ms. Pac-Man can continue moving as if the key is still held.
- This is especially relevant for a PWA with a DOM menu, Start button, volume slider, and in-game hamburger. Focus will move between browser UI and the game canvas more often than in the original LWJGL window.

Suggested fix:

- Add an input-level lost-focus cleanup path. On `window.blur` and `document.visibilitychange` to hidden, clear:
  - `downKeys`;
  - `downMouse`;
  - `pressedKeys`;
  - `pressedMouse`;
  - `controlPressed`.
- Also clear transient pressed records from `Input.poll()` when `Display.isActive()` is false, matching Java.
- Consider clearing browser-held state there too. Java can rely on LWJGL's live keyboard state; TS cannot rely on receiving a missed `keyup`.
- Fix `AppGameContainer.hasFocus()` so a stale `document.activeElement === canvas` cannot override `document.hasFocus() === false`.
- Add a browser regression test:
  - focus the canvas;
  - dispatch `keydown` for `ArrowRight`;
  - dispatch `blur` or hide the document without a `keyup`;
  - assert `input.isKeyDown(Input.KEY_RIGHT)` is false after cleanup.

### 2. Global `setMusicOn(false)` semantics still do not match Java

Severity: medium-high for menu/pause integration and any mode that checks `Music.playing()`.

Java behavior:

- `Music.startMusic(...)` always sets `currentMusic = this`, calls `sound.playAsMusic(...)`, sets `playing = true`, and applies volume. It does not early-return when global music is disabled (`C:\java-projects\slick2d\Slick\src\org\newdawn\slick\Music.java:259-277`).
- `SoundStore.playAsMusic(...)` records the OpenAL music source, then either starts it or pauses it depending on the global `music` flag (`C:\java-projects\slick2d\Slick\src\org\newdawn\slick\openal\SoundStore.java:467-489`).
- `SoundStore.setMusicOn(false)` calls `pauseLoop()`; `setMusicOn(true)` calls `restartLoop()` (`SoundStore.java:119-127`, `516-530`).
- `Music.playing()` returns `(currentMusic == this) && playing` (`Music.java:307-309`). A global music-off pause does not call `Music.pause()` and does not set `playing = false`.

Current TS behavior:

- `Music.start(...)` immediately returns if `SoundStore.get().musicOn()` is false (`C:\js-projects\slick2d-ts\src\slick\Music.ts:210-213`). That means a `play()` or `loop()` request made while global music is off is discarded instead of becoming the paused current music.
- `SoundStore.setMusicOn(false)` calls `handle.pause?.()` on tracked music handles (`C:\js-projects\slick2d-ts\src\slick\openal\SoundStore.ts:75-83`).
- The `Music` handle's `pause` method is `Music.pause()`, which sets `playingFlag = false`, marks the instance paused, and removes it from `Music.active` (`Music.ts:128-139`).
- `Music.playing()` returns `Music.currentMusic === this && this.playingFlag` (`Music.ts:162-165`), so global music-off state can make `playing()` false in TS where Java would still report true for the current track.

Why this matters for Ms. Pac-Man:

- The Java game uses `gc.setMusicOn(false)` and `gc.setMusicOn(true)` for pause/resume (`C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Main.java:165-175`).
- Multiple modes gate track starts on `!music.playing()`, for example:
  - `Act1Mode.java:240-241`;
  - `Act2Mode.java:188`, `207-208`;
  - `Act3Mode.java:167-168`;
  - `Act4Mode.java:143-144`;
  - `Act6Mode.java:153-154`.
- The original Java pause path returns before mode update, so this may not trigger during the built-in `P` pause. It can still trigger in the requested PWA menu/hamburger flow if the app mutes/pauses music globally while the Slick game remains mounted or resumes through a menu transition.

Suggested fix:

- Separate "global music enabled" from "this `Music` instance was manually paused."
- Do not implement `SoundStore.setMusicOn(false)` by calling the public `Music.pause()` semantics.
- Add a music-handle operation that suspends/resumes the Web Audio source for global music-off while preserving:
  - `Music.currentMusic`;
  - the instance `playingFlag`;
  - loop flag, pitch, volume, and resume position.
- Remove the early return in `Music.start(...)` or replace it with Java-equivalent behavior: register this track as current and prepare it, but do not audibly start until global music is enabled.
- Add tests:
  - start a track, call `setMusicOn(false)`, assert `music.playing()` still matches Java semantics but no audio is heard;
  - call `music.play()` while global music is off, assert it becomes the current paused track and starts when `setMusicOn(true)` is called;
  - verify `Music.pause()` still makes `playing()` false, because that is a different Java API.

### 3. `AppGameContainer.start()` leaves the container half-started if init or initial preload fails

Severity: high for the required splash/loading error and retry experience.

Java behavior:

- Java `AppGameContainer.setup()` wraps `game.init(this)` in a `try/catch`; on `SlickException`, it logs and sets `running = false` (`C:\java-projects\slick2d\Slick\src\org\newdawn\slick\AppGameContainer.java:392-397`).
- Java `gameLoop()` also catches `SlickException`, logs it, sets `running = false`, and returns (`AppGameContainer.java:410-416`).

Current TS behavior:

- `AppGameContainer.start()` sets `this.started = true`, binds input, registers display state, installs resize/fullscreen listeners, initializes the renderer/audio, then awaits `this.game.init(this)` and `ResourceLoader.waitForAll()` (`C:\js-projects\slick2d-ts\src\slick\AppGameContainer.ts:120-155`).
- There is no `try/catch` around `game.init()` or the initial `ResourceLoader.waitForAll()`.
- If either await rejects, `started` remains true, `destroyed` remains false, listeners remain installed, and no RAF is necessarily running.
- The current `reportError()` cleanup path exists, but it is only used after the loop starts or from `waitForQueuedResources()` (`AppGameContainer.ts:409-436`), not from the initial `start()` awaits.

Why this matters for Ms. Pac-Man:

- `Main.init()` constructs packed sheets immediately (`C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Main.java:543-548`), and later loading steps construct music tracks (`C:\NetBeansProjects\SlickMsPacMan\src\mspacman\LoadingMode.java:26-59`).
- The PWA requirements include a splash/loading screen with retries and user-visible errors. If a first start attempt fails due to a missing `.def`, image, stage/demo binary, or audio file, the user should be able to retry cleanly.
- With the current TS lifecycle, a Retry button that calls `container.start()` again can no-op because `started` is already true.

Suggested fix:

- Wrap the initial `game.init()` and `ResourceLoader.waitForAll()` in `try/catch`.
- On failure:
  - call the same cleanup used by `destroy()` or `reportError()`;
  - reset `started` to false;
  - unbind input and remove listeners;
  - dispose renderer state and reset `Display`.
- Deliver the error through `setErrorHandler()` if present, or reject `start()` after cleanup. Do not leave both an error callback and an unhandled rejection unless documented.
- Add a regression test where `game.init()` throws and a second `start()` on the same container can proceed.
- Add another regression test where a resource queued during `game.init()` rejects during the initial `waitForAll()`, and the container is retryable.

### 4. `ResourceLoader` resource locations do not behave like Java and can fail under PWA asset paths

Severity: medium-high for deployable PWA asset loading.

Java behavior:

- Java `ResourceLoader` keeps an ordered list of `ResourceLocation` instances (`C:\java-projects\slick2d\Slick\src\org\newdawn\slick\util\ResourceLoader.java:16-22`).
- `removeAllResourceLocations()` clears the list completely (`ResourceLoader.java:42-48`).
- `getResourceAsStream(ref)` tries each location until one returns a non-null stream (`ResourceLoader.java:56-72`).
- `getResource(ref)` tries each location until one returns a non-null URL, and throws if none is found (`ResourceLoader.java:101-118`).

Current TS behavior:

- `locations` starts as `[""]` (`C:\js-projects\slick2d-ts\src\slick\util\ResourceLoader.ts:26`).
- `addResourceLocation(location)` appends `String(location)` (`ResourceLoader.ts:38-39`), but `getResource(ref)` returns the first syntactically valid URL. The default `""` location is almost always syntactically valid, so later locations are never tried (`ResourceLoader.ts:86-97`).
- `loadResource(ref)` fetches only that one URL and retries only that URL (`ResourceLoader.ts:144-170`, `255-277`).
- `removeAllResourceLocations()` resets locations to `[""]` instead of clearing them (`ResourceLoader.ts:53-59`).
- `trimSlashes()` strips leading slashes (`ResourceLoader.ts:15-16`), so a browser root path such as `/assets` becomes `assets` before URL construction (`ResourceLoader.ts:90-92`).

Why this matters for Ms. Pac-Man:

- The port has many required resources:
  - packed sheet definitions and images;
  - stage/demo binary files read from Java resource paths;
  - sound effects and music.
- A PWA may be served from a route such as `/ms-pac-man/`, while assets may be served from `/assets/`, `/ms-pac-man/assets/`, a Vite base path, or a versioned CDN path.
- If the app uses `ResourceLoader.addResourceLocation("/assets")`, TS can still fetch the default relative `images/pack_1.def` first and fail without trying `/assets/images/pack_1.def`.
- Because version/cache-bust query parameters are now centralized in `ResourceLoader`, the location fallback needs to work there rather than forcing the application to bypass Slick for every asset.

Suggested fix:

- Preserve Java search semantics for browser locations:
  - generate all candidate URLs from the ordered location list;
  - fetch candidates in order;
  - retry each candidate according to the configured retry policy;
  - only fail after all candidates fail.
- Keep `getResource(ref)` if needed as a best-effort syntactic URL helper, but do not let it define load success by itself.
- Make `removeAllResourceLocations()` match Java by clearing the list. If the browser wants a default relative location, add an explicit `resetDefaultResourceLocations()` helper rather than changing Java semantics.
- Stop stripping leading slashes from browser locations. Treat `/assets` as origin-root absolute, `assets` as relative, and absolute `https://...` URLs as absolute.
- Add tests with a fake `fetch`:
  - default relative URL returns 404, second location returns 200;
  - `/assets` resolves to origin-root `/assets/...`;
  - `removeAllResourceLocations(); addResourceLocation("/assets")` does not try the default relative location;
  - cache-bust query parameter is applied to every attempted candidate while the Java ref remains the cache key.

## Not Re-Listed As Required Fixes

- Native cursor hiding is still a browser-specific adaptation. The Java game uses an empty cursor to hide the pointer during fullscreen (`C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Main.java:274-279`), while TS `Mouse.setNativeCursor(non-null)` currently sets CSS cursor to `default` (`C:\js-projects\slick2d-ts\src\lwjgl\input\Mouse.ts:39-50`). This was already documented previously and may be intentional for the PWA menu/hamburger UX. If exact fullscreen cursor parity is required later, implement CSS `cursor: none` or a real transparent cursor path.
- The synchronous `getResourceAsStream()` browser contract for already-loaded bytes remains important, but I am not re-listing it as a Slick bug by itself. The port can satisfy it with a preloader as long as `ResourceLoader` location fallback and startup failure cleanup are fixed.
- Broad missing Java Slick2D packages remain out of scope for this pass because this file is only for Ms. Pac-Man-relevant conversion blockers.

## Suggested Regression Checklist For The Fixing AI

1. Browser focus-loss test: held `ArrowRight` is cleared after `window.blur` without `keyup`.
2. `Display.isActive()` / `AppGameContainer.hasFocus()` test: stale canvas `activeElement` must not report active when `document.hasFocus()` is false.
3. Global music-off test: `Music.playing()` behavior matches Java after `GameContainer.setMusicOn(false)`.
4. Music-start-while-off test: a `play()` request made while music is disabled becomes the current paused music and resumes when music is enabled.
5. Start failure test: `game.init()` throws, container cleans up, error is reported, and `start()` can be attempted again.
6. Initial preload rejection test: resource queued during `game.init()` rejects during the first `ResourceLoader.waitForAll()`, and the same cleanup/retry contract holds.
7. Resource location fallback test: first candidate 404s, second candidate succeeds, and all attempts include the configured cache-bust query.
8. PWA base-path test: `/assets` remains origin-root absolute, while `assets` remains relative to the deployed page URL.
