# Slick2D TS Ms. Pac-Man Re-Audit 4

Date: 2026-08-02

Scope: another audit of `C:\js-projects\slick2d-ts` against Java Slick2D in `C:\java-projects\slick2d\Slick`, focused on issues that can still affect a 1-to-1 desktop-browser PWA SPA port of `C:\NetBeansProjects\SlickMsPacMan`.

This pass intentionally does not re-list Java desktop/applet omissions unless they can change this game's browser behavior. It also does not re-list the four required fixes from `SLICK2D_TS_MSPACMAN_REAUDIT_3.md` because the current TypeScript source now appears to contain those fixes.

## Audit Snapshot

- Java Slick2D files under `Slick\src\org\newdawn\slick`: 302 `.java` files.
- Java Slick2D production files excluding `tests`: 222 `.java` files.
- TypeScript files under `C:\js-projects\slick2d-ts\src`: 66 `.ts` files.
- TypeScript files under `src\slick` plus `src\lwjgl`: 65 `.ts` files.
- `npm.cmd run typecheck` in `C:\js-projects\slick2d-ts` passes with `tsc -p tsconfig.json --noEmit`.

## Current Fixes Verified From Re-Audit 3

- Focus loss cleanup now exists in `Input`: `bindToElement()` registers `blur` and `visibilitychange`, `poll()` clears state when browser focus is gone, and `AppGameContainer.hasFocus()` no longer treats stale canvas focus as active focus (`C:\js-projects\slick2d-ts\src\slick\Input.ts:132-147`, `459-471`, `603-623`, `694-699`; `C:\js-projects\slick2d-ts\src\slick\AppGameContainer.ts:221-224`).
- Global music-off semantics were repaired: `Music.start()` records current music even when global music is off, `SoundStore.setMusicOn(false)` uses `suspend()` when available, and `Music.playing()` remains Java-style current-track state (`C:\js-projects\slick2d-ts\src\slick\Music.ts:215-242`, `361-388`; `C:\js-projects\slick2d-ts\src\slick\openal\SoundStore.ts:76-90`, `152-155`).
- Initial start failure cleanup was added: `AppGameContainer.start()` now wraps setup, `game.init()`, and initial `ResourceLoader.waitForAll()` in `try/catch`, calls `destroy()`, and reports through `setErrorHandler()` when present (`C:\js-projects\slick2d-ts\src\slick\AppGameContainer.ts:120-165`).
- Resource location fallback was repaired: `removeAllResourceLocations()` really clears locations, `loadResource()` fetches all candidates in order, leading slashes on locations are preserved, and retries/cache-bust apply to fetched candidates (`C:\js-projects\slick2d-ts\src\slick\util\ResourceLoader.ts:48-56`, `131-158`, `242-277`).
- Close-request order and stale close state from older reports are still fixed: `AppGameContainer` checks `Display.isCloseRequested()` before `game.closeRequested()`, and `Display.create()`, `Display.destroy()`, and `Display.setActiveContainer(non-null)` reset `closeRequested` (`C:\js-projects\slick2d-ts\src\slick\AppGameContainer.ts:330`; `C:\js-projects\slick2d-ts\src\lwjgl\opengl\Display.ts:39-46`, `63-75`).

## Findings To Fix

### 1. Browser fullscreen/display-mode changes still do not safely support the game's Java-style synchronous resize path

Severity: high for desktop-browser parity.

Java behavior:

- Java `AppGameContainer.setDisplayMode(int, int, boolean)` updates `width` and `height`, calls `Display.setDisplayMode(...)` and `Display.setFullscreen(...)`, and throws `SlickException` on failure (`C:\java-projects\slick2d\Slick\src\org\newdawn\slick\AppGameContainer.java:109-153`).
- Java `AppGameContainer.setFullscreen(boolean)` also throws `SlickException` on failure (`C:\java-projects\slick2d\Slick\src\org\newdawn\slick\AppGameContainer.java:186-198`).
- `Main.fullScreenToggleCheck(...)` depends on that synchronous contract: it calls `appGameContainer.setDisplayMode(...)` and immediately calls `scalableGame.containerSizeChanged(gc)` (`C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Main.java:194-211`).
- `ScalableGame2.containerSizeChanged(...)` is where render target size and input transform are recalculated. It sets `targetWidth`, `targetHeight`, `Input.setScale(...)`, and `Input.setOffset(...)` (`C:\NetBeansProjects\SlickMsPacMan\src\mspacman\ScalableGame2.java:170-211`).

Current TypeScript behavior:

- `AppGameContainer.setDisplayMode(...)` sets container dimensions and applies the requested canvas size before it knows whether browser fullscreen has succeeded (`C:\js-projects\slick2d-ts\src\slick\AppGameContainer.ts:73-85`).
- `setFullscreen(true)` calls `canvas.requestFullscreen()` and catches failure with `.catch(() => undefined)` instead of surfacing an error equivalent to Java's `SlickException` (`C:\js-projects\slick2d-ts\src\slick\AppGameContainer.ts:98-109`).
- `fullscreenchange` and `resize` handlers later call `applyBrowserDisplaySize()` when fullscreen is active (`C:\js-projects\slick2d-ts\src\slick\AppGameContainer.ts:143-144`, `340-342`).
- `applyBrowserDisplaySize()` changes `width`, `height`, canvas backing size, CSS size, and renderer display size, but it does not notify `ScalableGame2.containerSizeChanged(...)` or any equivalent resize observer (`C:\js-projects\slick2d-ts\src\slick\AppGameContainer.ts:405-416`).
- `ScalableGame2.ts` keeps the same Java model: `targetWidth`, `targetHeight`, input scale, and input offset are updated only in `containerSizeChanged(...)`; render recomputes offsets from the current container dimensions but still uses stale `targetWidth` and `targetHeight` if `containerSizeChanged(...)` is not called after a later browser size change (`C:\js-projects\slick2d-ts\src\slick\ScalableGame2.ts:44-82`, `87-110`).

Why this matters for Ms. Pac-Man:

- A direct 1-to-1 TypeScript conversion of `Main.fullScreenToggleCheck(...)` will call `containerSizeChanged(gc)` immediately after `setDisplayMode(...)`, just like Java.
- That immediate call can be correct only for the requested size. The browser may then apply a different final fullscreen viewport through `fullscreenchange` or `resize`, and the TS container will update its own dimensions without recalculating the scaler's input transform.
- If browser fullscreen is rejected, TS currently hides the error and can leave the canvas resized to the requested fullscreen dimensions while `document.fullscreenElement !== canvas`. Java would throw. The game may have already called `hideMouseCursor()` and recalculated scaling for a fullscreen size.
- The visible failure modes are wrong letterboxing, stale clip dimensions, wrong mouse coordinates through `Input.setScale(...)` / `setOffset(...)`, and a huge non-fullscreen canvas after a denied fullscreen request.

Suggested fix:

- Do not swallow `requestFullscreen()` / `exitFullscreen()` failures. Convert them into a `SlickException`, reject the returned promise, and report through the container error handler if the failure happens out of band.
- If fullscreen fails, restore the previous container/canvas dimensions instead of leaving the requested fullscreen size applied.
- After any final browser-applied display size change, notify resize-aware games. For this port, the practical compatibility hook is:
  - detect whether `this.game` has a callable `containerSizeChanged(container: GameContainer)` method;
  - call it after `applyBrowserDisplaySize()` changes dimensions;
  - also call it after successful async fullscreen entry/exit if dimensions changed.
- Alternatively expose a display-resize listener on `AppGameContainer` and have the PWA wrapper call `scalableGame.containerSizeChanged(container)` there. That is less transparent for a 1-to-1 port than an automatic compatibility hook.
- Mark `Display.wasResized()` state when browser fullscreen/resize changes the active container. This is not enough for this game by itself because `Main.java` does not poll `Display.wasResized()`, but it keeps the LWJGL shim honest.
- Add browser regression tests:
  - mock `requestFullscreen()` success with final `window.innerWidth/innerHeight` different from the requested display mode and assert `ScalableGame2.containerSizeChanged(...)` runs after the final size is applied;
  - mock `requestFullscreen()` rejection and assert the container returns/reports an error and reverts dimensions;
  - assert `Input` scale/offset match the final canvas size after fullscreen and after a fullscreen resize.

### 2. `AppGameContainer.destroy()` does not clear Web Audio, unlike Java `AppGameContainer.destroy()`

Severity: high for the PWA menu, retry, and error lifecycle.

Java behavior:

- Java `AppGameContainer.destroy()` calls both `Display.destroy()` and `AL.destroy()` (`C:\java-projects\slick2d\Slick\src\org\newdawn\slick\AppGameContainer.java:490-492`).
- In the TypeScript shim, `AL.destroy()` already exists and calls `SoundStore.get().clear()` before marking AL not created (`C:\js-projects\slick2d-ts\src\lwjgl\openal\AL.ts:17-20`).

Current TypeScript behavior:

- `AppGameContainer.start()` initializes audio through `SoundStore.get().init()` (`C:\js-projects\slick2d-ts\src\slick\AppGameContainer.ts:150`).
- `AppGameContainer.destroy()` cancels RAF, unbinds input, removes browser listeners, disposes the renderer, and calls `Display.destroy()`, but it does not call `AL.destroy()` or `SoundStore.get().clear()` (`C:\js-projects\slick2d-ts\src\slick\AppGameContainer.ts:237-256`).
- `SoundStore.clear()` is the method that stops tracked handles, clears active/music handle sets, and clears decoded buffers (`C:\js-projects\slick2d-ts\src\slick\openal\SoundStore.ts:49-56`).

Why this matters for Ms. Pac-Man:

- Normal Java close through the game callback does call `Main.closeRequested()`, which calls `stopAllSounds()` (`C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Main.java:795-797`).
- The requested PWA has additional lifecycle paths that are not the original Java window close: splash loading failure, retry, and the in-game hamburger return-to-menu flow.
- If any host/UI path calls `container.destroy()` directly, or if `AppGameContainer.reportError(...)` destroys the container after a runtime/resource error, `Main.closeRequested()` is bypassed and active Web Audio can continue.
- This game creates many tracked sounds and music objects: sound effects in `Main.loadSoundEffects()` (`C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Main.java:523-537`) and music tracks during `LoadingMode.update()` (`C:\NetBeansProjects\SlickMsPacMan\src\mspacman\LoadingMode.java:26-59`).
- Result: a failed load, retry, or menu return can leave music or looping/long sound effects audible after the canvas and renderer are gone.

Suggested fix:

- Make `AppGameContainer.destroy()` mirror Java lifecycle by calling `AL.destroy()` or directly calling `SoundStore.get().clear()` during teardown.
- Keep it idempotent. `destroy()` is already used from startup failure, RAF error handling, close request, and explicit host calls.
- Decide whether browser `AL.destroy()` should only stop/clear handles or also close/suspend the `AudioContext`. Stopping/clearing handles is the minimum parity fix. Closing the context may be closer to Java, but then `SoundStore.init()` must recreate a fresh context on restart.
- Add regression tests:
  - start a looping music handle, call `container.destroy()`, assert `SoundStore.get().isMusicPlaying()` is false and no active handles remain;
  - start a sound effect whose decode resolves after `destroy()`, assert it does not begin playing after teardown;
  - start, destroy, and start a second container, assert no audio from the first session survives.

### 3. Conditional parity item: transparent native cursor data is still ignored

Severity: medium if exact fullscreen cursor behavior is required; otherwise confirm as intentional PWA UX.

Java behavior:

- `Main.hideMouseCursor()` creates an empty 32x32 cursor buffer and installs it with `Mouse.setNativeCursor(cursor)` (`C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Main.java:274-279`).
- `Main.showMouseCursor()` restores the saved native cursor (`C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Main.java:266-269`).

Current TypeScript behavior:

- `CursorLoader.getCursor(Uint8Array, ...)` preserves cursor dimensions and pixel data in a `Cursor` object (`C:\js-projects\slick2d-ts\src\slick\opengl\CursorLoader.ts:20-34`; `C:\js-projects\slick2d-ts\src\lwjgl\input\Cursor.ts:18-24`).
- `Mouse.setNativeCursor(cursor)` ignores the cursor's image data. For any non-null cursor it sets CSS `cursor` to `"default"` (`C:\js-projects\slick2d-ts\src\lwjgl\input\Mouse.ts:39-49`).

Why this matters for Ms. Pac-Man:

- A direct port of `hideMouseCursor()` will not hide the pointer. In fullscreen gameplay, Java hides it.
- The requested PWA also needs an in-game hamburger that can return to the menu, so keeping the pointer visible may be intentional. If so, document this as a deliberate UX divergence in the game port rather than silently letting Slick2D report a native cursor that is not reflected in CSS.

Suggested fix if exact cursor parity is desired:

- In `Mouse.setNativeCursor(cursor)`, detect transparent or all-zero cursor pixel data and set `element.style.cursor = "none"`.
- For non-transparent cursor data, generate a CSS cursor data URL from the `Cursor` pixels and hotspot.
- Preserve/restore the previous CSS cursor when `Mouse.setNativeCursor(null)` or the saved native cursor is restored.
- If the PWA wants the hamburger to remain usable, make the hamburger a DOM overlay with its own visible cursor style, or make cursor hiding apply only to the canvas surface.

## Verified As Not New Blockers In This Pass

- `npm.cmd run typecheck` passes in `C:\js-projects\slick2d-ts`.
- Packed sprite definitions now parse correctly for this game. A source-level validation found:
  - `images/pack_1.def`: 93 parsed entries;
  - `images/pack_2.def`: 744 parsed entries;
  - direct `Main.java` calls to `pack1.getSprite("...")` / `pack2.getSprite("...")`: 103;
  - missing direct sprite names: 0.
- `PackedSpriteSheet` still requires `.def` bytes to be registered before construction because `getResourceAsStream()` is synchronous in the browser port. I am not treating that as a new Slick2D bug in this pass; it remains a documented browser preloading contract for the PWA startup path.
- The game does not construct standalone file-backed `Image` objects outside packed sheets, so path-created `Image` width/height being zero until decode completes is not a new Ms. Pac-Man blocker here. Packed sections carry explicit width/height from the `.def` file.
- Game-used key constants and browser mappings match the Java constants for arrows, WASD, IJKL, 2/4/6/8, Enter, Space, Escape, and P (`C:\js-projects\slick2d-ts\src\slick\Input.ts:23-78`, `759-840`; `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\HumanInput.java:16-49`).
- `Input.isKeyPressed()` still consumes one-shot pressed state like Java (`C:\js-projects\slick2d-ts\src\slick\Input.ts:293-306`; Java `C:\java-projects\slick2d\Slick\src\org\newdawn\slick\Input.java:667-755`).
- `Sound` and `Music` constructors now queue Web Audio decode through the preload barrier (`C:\js-projects\slick2d-ts\src\slick\Sound.ts:22-46`; `C:\js-projects\slick2d-ts\src\slick\Music.ts:52-73`). This addresses the earlier delayed-decode findings for this game.
- `ResourceLoader` now has retry/cache-bust/candidate fallback machinery, and `loadResource()` no longer stops after the first syntactically valid URL (`C:\js-projects\slick2d-ts\src\slick\util\ResourceLoader.ts:61-79`, `131-158`, `242-277`).
- `ScalableGame2` clipping and transform order still matches the Java copy for the game-used render path: set clip, translate, scale, push matrix, render held game, pop matrix, clear clip (`C:\NetBeansProjects\SlickMsPacMan\src\mspacman\ScalableGame2.java:122-144`; `C:\js-projects\slick2d-ts\src\slick\ScalableGame2.ts:87-99`).
- Broad missing Java Slick2D packages remain outside this Ms. Pac-Man-focused pass. They matter only if the game port starts using APIs outside the current Java game's Slick/LWJGL call surface.

## Regression Checklist For The Fixing AI

1. Fullscreen success with a final browser size different from the requested display mode must trigger scaler/input recalculation after the final size is known.
2. Fullscreen rejection must reject/report a Slick-style error and must not leave the canvas/container stuck at the requested fullscreen dimensions.
3. `Display.wasResized()` should report browser-driven fullscreen/resize changes if the shim claims LWJGL parity there.
4. `AppGameContainer.destroy()` must stop active music and sound handles even when `game.closeRequested()` was never called.
5. Audio whose decode resolves after `destroy()` must not start playback.
6. Restarting from the PWA menu after destroy must not carry over sound handles, music handles, close state, or stale renderer/input listeners.
7. If cursor hiding is required, `CursorLoader.getCursor(emptyBuffer, ...)` plus `Mouse.setNativeCursor(cursor)` must make the canvas cursor invisible; if it is intentionally not required, document the product decision in the game port.
