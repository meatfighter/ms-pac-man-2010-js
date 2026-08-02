# Slick2D TS Ms. Pac-Man Re-Audit 2

Date: 2026-08-02

Scope: third pass over `C:\js-projects\slick2d-ts` against the Java Slick2D source in `C:\java-projects\slick2d`, focused only on behavior relevant to porting `C:\NetBeansProjects\SlickMsPacMan` to a desktop-browser PWA SPA. I did not re-list Java desktop/applet-only omissions unless the omission can change this game's browser behavior.

## Current Status

The previous audio/resource items were partly fixed:

- `Music` now has a static `currentMusic`, `ready()` / `load()`, constructor-queued decode, cancellation tokens, swap handling, and Java-style `playing()` semantics (`slick2d-ts/src/slick/Music.ts:20-24`, `75-95`, `141-165`, `210-282`).
- `Sound` now has `ready()` / `load()` and constructor-queued decode (`slick2d-ts/src/slick/Sound.ts:9-54`).
- `SoundStore.setMusicOn()` now attempts pause/resume on tracked music handles (`slick2d-ts/src/slick/openal/SoundStore.ts:74-84`).
- `ResourceLoader` now has cache bust and retry configuration (`slick2d-ts/src/slick/util/ResourceLoader.ts:29-31`, `61-79`, `248-277`).
- `Input` now prevents default browser behavior for game keys when the canvas is the active game surface (`slick2d-ts/src/slick/Input.ts:104-147`, `493-495`, `635-650`, `723-744`).
- `AppGameContainer` now waits for resources queued during later frames (`slick2d-ts/src/slick/AppGameContainer.ts:287-310`, `393-409`). This helps Java-style `LoadingMode` steps because music created during `update()` can block the next frame.

I still found game-relevant problems.

## Findings To Fix

### 1. `AppGameContainer` calls `game.closeRequested()` every frame

Severity: critical.

Java behavior:

- Java `AppGameContainer.gameLoop()` calls `game.closeRequested()` only after LWJGL reports a close request:
  - `Display.update();`
  - `if (Display.isCloseRequested()) { if (game.closeRequested()) running = false; }`
  - Source: `C:\java-projects\slick2d\Slick\src\org\newdawn\slick\AppGameContainer.java:419-427`.

Current TS behavior:

- TS evaluates `this.game.closeRequested()` first on every animation frame:
  - `if (this.game.closeRequested() && Display.isCloseRequested()) { ... }`
  - Source: `C:\js-projects\slick2d-ts\src\slick\AppGameContainer.ts:302-305`.

Why this breaks Ms. Pac-Man:

- The game overrides `Main.closeRequested()` and stops all audio before returning:
  - `stopAllSounds(); return super.closeRequested();`
  - Source: `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Main.java:794-798`.
- The port uses `ScalableGame2`, whose `closeRequested()` delegates to the held game, matching Java (`C:\NetBeansProjects\SlickMsPacMan\src\mspacman\ScalableGame2.java:157-160`; TS equivalent `slick2d-ts/src/slick/ScalableGame.ts:135-138`).
- Result: every TS frame calls `Main.closeRequested()`, so `Main.stopAllSounds()` runs continuously. Music and sound effects will be stopped even when the user never requested close.

Suggested fix:

- Reverse the condition to match Java:
  - check `Display.isCloseRequested()` first;
  - call `game.closeRequested()` only inside that branch.
- Add a regression test with a `Game.closeRequested()` spy that asserts it is not called during ordinary RAF ticks.
- Add a Ms. Pac-Man-specific regression: a fake `Main.closeRequested()` that increments `stopAllSounds` must not run until `Display.requestClose()` is set.

### 2. Display close state is static and not reset on destroy/restart

Severity: high for a PWA with a menu/restart flow.

Current TS behavior:

- `Display.requestClose()` sets static `closeRequested = true` (`slick2d-ts/src/lwjgl/opengl/Display.ts:187-195`).
- `Display.destroy()` only sets `created = false`; it does not clear `closeRequested` (`Display.ts:69-72`).
- `Display.setActiveContainer(null)` does not reset close state (`Display.ts:38-46`).
- `AppGameContainer.destroy()` unbinds and disposes renderer state, then calls `Display.setActiveContainer(null)`, but not `Display.destroy()` or any close-state reset (`slick2d-ts/src/slick/AppGameContainer.ts:221-240`).

Why this matters for the browser port:

- The requested PWA has a menu and an in-game hamburger return-to-menu path.
- If the port uses Slick's `GameContainer.exit()` / `Display.requestClose()` to leave the game, the static close flag can survive into the next game start.
- After finding 1 is fixed, a stale `Display.isCloseRequested()` would still make the next container immediately call `game.closeRequested()` and destroy itself.

Suggested fix:

- Clear `closeRequested` during `Display.create()`, `Display.destroy()`, or `Display.setActiveContainer(container)` when a new non-null container is registered.
- Prefer also calling `Display.destroy()` from `AppGameContainer.destroy()` so `Display.isCreated()` matches the container lifecycle.
- Add a regression test: `Display.requestClose(); app.destroy(); start new app; Display.isCloseRequested()` must be false before the first frame.

### 3. Queued resource failures after `start()` are thrown from RAF instead of being delivered to the PWA loading UI

Severity: high for the required splash/loading error experience.

Current TS behavior:

- `AppGameContainer.loop()` checks `this.resourceError`; if set, it destroys and throws from the RAF callback (`slick2d-ts/src/slick/AppGameContainer.ts:265-270`).
- `waitForQueuedResources()` catches `ResourceLoader.waitForAll()` failures, stores `this.resourceError`, and schedules another RAF (`AppGameContainer.ts:393-409`).
- The original `app.start()` promise has already resolved by this point for resources queued from Java-style later loading steps.

Why this matters for Ms. Pac-Man:

- `LoadingMode.update()` creates the twelve `Music` tracks after `Main.init()` (`C:\NetBeansProjects\SlickMsPacMan\src\mspacman\LoadingMode.java:26-59`).
- TS now queues and waits for those resources during later frames. That is good, but if `music/stage_*.ogg` or another later resource fails, the failure happens inside RAF, not as a rejection from the original Start button's awaited `app.start()` flow.
- The port requirements say loading problems must be presented to the user. A thrown RAF error requires a global `error`/`unhandledrejection` catch, which is fragile and not a clean Slick API.

Suggested fix:

- Add an `AppGameContainer` error hook or promise that reports async frame/resource errors to the embedding PWA.
- Example API shapes:
  - `container.setErrorHandler((error) => ...)`;
  - `container.onError = ...`;
  - or an exposed lifecycle promise for queued resource failures.
- Do not rely only on throwing from RAF for recoverable loading-screen failures.
- Add a browser harness test that makes one `Music.ready()` reject during `LoadingMode` and asserts the app-level loading error UI receives the error without a raw uncaught RAF exception.

### 4. `Input.pause()` does not clear key/mouse/control pressed records like Java

Severity: medium, possibly high if the PWA uses container pause while showing the menu.

Java behavior:

- `Input.pause()` clears key, mouse, and controller pressed records:
  - `clearKeyPressedRecord(); clearMousePressedRecord(); clearControlPressedRecord();`
  - Source: `C:\java-projects\slick2d\Slick\src\org\newdawn\slick\Input.java:1497-1504`.
- `Input.poll()` also clears those pressed records when input is paused (`Input.java:1128-1136`).

Current TS behavior:

- `Input.pause()` only clears held-down key and mouse sets:
  - `this.downKeys.clear(); this.downMouse.clear();`
  - Source: `C:\js-projects\slick2d-ts\src\slick\Input.ts:473-478`.
- It leaves:
  - `pressedKeys`;
  - `pressedMouse`;
  - `controlPressed`.
- `Input.poll()` only updates height and polls controllers; it does not clear records when paused (`Input.ts:447-451`).

Why this matters for this port:

- Ms. Pac-Man consumes one-shot keys for pause/fullscreen/mode transitions through `isKeyPressed()` and clears records on mode changes (`Main.java:154-185`, `258-264`; `HumanInput.java:37-53`).
- The PWA has a menu screen and an in-game hamburger return-to-menu path. If that path pauses the Slick container while showing DOM UI, stale Space/Enter/Escape/P records can fire immediately when returning to the game.

Suggested fix:

- Make `Input.pause()` call `clearKeyPressedRecord()`, `clearMousePressedRecord()`, and `clearControlPressedRecord()`.
- Make `Input.poll()` clear pressed records and return while paused, matching Java.
- Add a test: press Space, call `input.pause()`, call `input.resume()`, then assert `isKeyPressed(Input.KEY_SPACE)` is false.

### 5. Game input is still recorded while DOM controls are focused

Severity: medium for the required menu and volume slider.

Current TS behavior:

- `shouldPreventDefault()` returns false for interactive elements (`INPUT`, `TEXTAREA`, `SELECT`, `BUTTON`, contenteditable) (`slick2d-ts/src/slick/Input.ts:635-659`).
- But `handleKeyDown()` only uses that decision to skip `preventDefault()`. It still records the mapped key in `downKeys` / `pressedKeys` and notifies key listeners (`Input.ts:485-506`).
- `handleKeyUp()` similarly still releases mapped keys (`Input.ts:508-519`).

Why this matters:

- The required PWA menu has a Start button and volume slider.
- Pressing Space or Enter on a focused button/range input can still enqueue `KEY_SPACE` / `KEY_ENTER` in Slick input if the game container remains mounted.
- When returning from the menu to the game, that stale one-shot key can toggle fullscreen, unpause, or advance modes depending on where the game is.

Suggested fix:

- Split "should prevent default" from "should accept as game input."
- When `document.activeElement` is an interactive DOM control outside the canvas, ignore the key for Slick state entirely.
- Keep canvas-focused keys working and keep menu controls usable.
- Add a test with a focused `<input type="range">`: pressing ArrowLeft/ArrowRight should move the slider and must not make `input.isKeyPressed(Input.KEY_LEFT/RIGHT)` true.

## Verified As Not New Blockers In This Pass

- `npm.cmd run typecheck` in `C:\js-projects\slick2d-ts` passes with `tsc -p tsconfig.json --noEmit`.
- `npm.cmd run build` could not be used in this sandbox because it writes to `C:\js-projects\slick2d-ts\dist`, which is outside this task's writable root. The failure was EPERM write denial, not TypeScript diagnostics.
- Packed sheet parsing, nearest filtering, image alpha/subimage/flipped drawing, and the game-used GL transforms still look adequate for the current Ms. Pac-Man call surface.
- Fullscreen sizing appears improved: `AppGameContainer.setDisplayMode()` updates dimensions and applies browser fullscreen sizing asynchronously, and resize/fullscreenchange handlers reinitialize display size (`slick2d-ts/src/slick/AppGameContainer.ts:65-81`, `90-104`, `314-320`, `368-391`). I did not find a new concrete fullscreen parity bug for this game in this pass.

