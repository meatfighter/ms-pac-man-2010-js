# Slick2D TS Re-Audit 5 for the Ms. Pac-Man Browser Port

Date: 2026-08-02

Scope: This pass re-audited the current `C:\js-projects\slick2d-ts` TypeScript source against the Java Slick2D code in `C:\java-projects\slick2d\Slick\src\org\newdawn\slick` and the Ms. Pac-Man call surface in `C:\NetBeansProjects\SlickMsPacMan\src\mspacman`. It assumes this is a desktop browser PWA SPA port, so Java desktop-only and applet-only platform details are not listed unless they can change this game's browser behavior.

Validation run:

- `npm.cmd run typecheck` in `C:\js-projects\slick2d-ts`: passed.

Current fixes verified and not re-listed:

- `AppGameContainer` now calls a resize-aware `containerSizeChanged(container)` hook after canvas/fullscreen/browser size changes.
- Fullscreen failure paths now reject as `SlickException` and restore the previous display snapshot.
- `AppGameContainer.destroy()` now calls `AL.destroy()`, and `AL.destroy()` clears `SoundStore`.
- Transparent native cursors now become CSS `cursor: none`.
- Input focus loss and paused input clearing fixes are present.

## Finding 1: Browser-initiated fullscreen exit and destroy-while-fullscreen still leave Slick display state wrong

Severity: high for the PWA desktop browser port.

This is not the same issue as the previous async fullscreen rejection/resize-notification bug. The fixed path covers deliberate calls such as `setDisplayMode(800, 600, false)`. The still-broken path is when the browser leaves fullscreen independently of the Java game logic, or when the host destroys the container while the canvas is the fullscreen element.

### Java behavior that must be preserved

In `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Main.java`:

- `fullScreenToggleCheck(...)` treats Space as enter/toggle fullscreen and Escape as exit fullscreen only.
- When the game is fullscreen and Space or Escape is pressed, Java calls `showMouseCursor()`, then `appGameContainer.setDisplayMode(800, 600, false)`, then `scalableGame.containerSizeChanged(gc)` (`Main.java:194-211`).
- Entering fullscreen calls `hideMouseCursor()`, then `appGameContainer.setDisplayMode(maxWidth, maxHeight, true)`, then `scalableGame.containerSizeChanged(gc)` (`Main.java:205-211`).
- `hideMouseCursor()` saves the previous native cursor and installs a blank cursor (`Main.java:274-279`); `showMouseCursor()` restores it (`Main.java:266-271`).

In Java Slick2D `C:\java-projects\slick2d\Slick\src\org\newdawn\slick\AppGameContainer.java`:

- `setDisplayMode(int, int, boolean)` synchronously sets `this.width`, `this.height`, `Display.setDisplayMode(targetDisplayMode)`, and `Display.setFullscreen(fullscreen)`, then reinitializes GL if the display exists (`AppGameContainer.java:109-168`).
- `setFullscreen(false)` synchronously calls `Display.setFullscreen(false)` when leaving fullscreen (`AppGameContainer.java:186-200`).
- `destroy()` tears down both `Display` and `AL` (`AppGameContainer.java:490-492`).

In `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\ScalableGame2.java`:

- `containerSizeChanged(container)` recalculates `targetWidth`, `targetHeight`, input scale, and input offset from the container's current `getWidth()` / `getHeight()` (`ScalableGame2.java:170-211`).

### Current TypeScript behavior

In `C:\js-projects\slick2d-ts\src\slick\AppGameContainer.ts`:

- `isFullscreen()` reports the live browser state by checking `document.fullscreenElement === this.canvas` (`AppGameContainer.ts:115-120`).
- `setFullscreen(fullscreen)` sets the protected `this.fullscreen` flag before requesting browser fullscreen or exit (`AppGameContainer.ts:122-144`).
- Fullscreen entry uses `applyBrowserDisplaySize()`, which sets the canvas backing size to `window.innerWidth` / `window.innerHeight` and CSS size to `100vw` / `100vh` (`AppGameContainer.ts:449-463`).
- The shared `fullscreenchange` / `resize` handler does this when the browser is no longer fullscreen:
  - `this.setDimensions(this.canvas.width, this.canvas.height)`;
  - `Renderer.getBackend().initDisplay(this.canvas.width, this.canvas.height)`;
  - `Display.markResized(this.canvas.width, this.canvas.height)`;
  - `this.notifyContainerSizeChanged()`;
  - it does not restore the last windowed mode, does not clear `100vw` / `100vh`, and does not set `this.fullscreen = false` (`AppGameContainer.ts:374-386`).
- `destroy()` removes the `fullscreenchange` listener, disposes the renderer, destroys AL, destroys Display, and unregisters the active container, but never calls `document.exitFullscreen()` if the canvas is currently fullscreen (`AppGameContainer.ts:269-292`).

In `C:\js-projects\slick2d-ts\src\lwjgl\opengl\Display.ts`:

- `Display.setFullscreen(fullscreen)` stores the static fullscreen flag and delegates to the active container (`Display.ts:177-180`).
- `Display.isFullscreen()` falls back to that static flag when no active container exists (`Display.ts:183-186`).
- `Display.destroy()` clears `created` and `closeRequested`, but does not clear the static fullscreen flag (`Display.ts:79-83`).

### Concrete failure path

1. The game starts windowed at `800x600`.
2. The player presses Space. `Main.fullScreenToggleCheck(...)` hides the cursor, calls `setDisplayMode(maxWidth, maxHeight, true)`, and the TS container enters browser fullscreen.
3. `applyBrowserDisplaySize()` changes the canvas backing size to the browser viewport and sets CSS to `100vw` / `100vh`.
4. The player exits fullscreen through browser/system behavior instead of through the Java game path. Examples: browser Escape handling, browser fullscreen UI, or the PWA host returning to the menu while the canvas is fullscreen.
5. `fullscreenchange` fires. Since `document.fullscreenElement !== canvas`, `isFullscreen()` is false, so the TS handler takes the non-fullscreen branch.
6. That branch preserves the already-fullscreen canvas dimensions instead of restoring `800x600`, leaves CSS at the fullscreen sizing if it was previously set, and recalculates `ScalableGame2` against the wrong size.

Visible consequences for this game:

- The canvas can remain at the fullscreen viewport size even though the browser is no longer fullscreen.
- `ScalableGame2.targetWidth`, `targetHeight`, input scale, and input offset can be recalculated for the stale fullscreen canvas instead of the Java windowed `800x600` state.
- The cursor can remain hidden because the browser exit bypasses `Main.showMouseCursor()`.
- If the hamburger return-to-menu path destroys the container while the canvas is fullscreen, the browser can remain fullscreen on the dead canvas. A DOM menu outside the fullscreen element may not be visible, which directly conflicts with the required PWA menu flow.
- `Display.isFullscreen()` can report stale fullscreen state after destroy because `Display.destroy()` does not clear the static fullscreen flag once the active container has been removed.

### Required repair

Fix this at the Slick2D TS container/display layer, not in the game port only.

1. Track the last non-fullscreen display/canvas mode separately from the requested fullscreen mode.
   - Initialize it from the constructor/default windowed size.
   - Update it whenever `setDisplayMode(width, height, false)` succeeds.
   - Do not overwrite it when `setDisplayMode(maxWidth, maxHeight, true)` requests fullscreen.

2. Split browser fullscreen state handling from plain resize handling.
   - On `fullscreenchange` to active fullscreen, set `this.fullscreen = true`, call `applyBrowserDisplaySize()`, mark `Display.wasResized()`, and notify `containerSizeChanged(...)`.
   - On `fullscreenchange` to non-fullscreen without a completed `setDisplayMode(..., false)` restore, set `this.fullscreen = false`, restore/apply the last non-fullscreen canvas size, clear fullscreen CSS (`100vw` / `100vh`), mark `Display.wasResized()`, and notify `containerSizeChanged(...)`.
   - Avoid double notifications when the deliberate `setDisplayMode(800, 600, false)` path already restored the same size.

3. Make teardown exit browser fullscreen.
   - In `AppGameContainer.destroy()`, if `document.fullscreenElement === this.canvas` and `document.exitFullscreen` exists, request `document.exitFullscreen()`.
   - Because `destroy()` is Java-style synchronous, this can be a deliberately fire-and-forget browser promise, but the object state should still be set to non-fullscreen immediately.
   - Do not remove or rely on the `fullscreenchange` listener in a way that leaves CSS/canvas state stale during host menu return.

4. Clear static display fullscreen state during destroy/unregister.
   - `Display.destroy()` and/or `Display.setActiveContainer(null)` should reset `Display.fullscreen = false`.
   - This keeps `Display.isFullscreen()` honest between PWA game sessions.

5. Cursor restoration needs an explicit decision.
   - Java game exit calls `showMouseCursor()` before leaving fullscreen.
   - Browser-initiated fullscreen exit bypasses that game method.
   - Either the Ms. Pac-Man port must listen for forced fullscreen exit and restore the saved cursor, or `AppGameContainer` / `Mouse` should provide a generic "restore cursor on forced fullscreen exit" mechanism. Do not leave a forced windowed state with the blank fullscreen cursor active.

### Regression tests to add

- Start at `800x600`, enter fullscreen, simulate `fullscreenchange` with `document.fullscreenElement = null` without calling `setDisplayMode(800, 600, false)`. Assert:
  - `container.isFullscreen()` is false;
  - `Display.isFullscreen()` is false;
  - `container.getWidth()` / `getHeight()` are back to `800x600`;
  - canvas backing size and CSS size are back to `800px` / `600px`;
  - `ScalableGame2.containerSizeChanged(...)` was called with the restored size.

- Enter fullscreen, then call `container.destroy()`. Assert:
  - `document.exitFullscreen()` was requested when the canvas was the fullscreen element;
  - `Display.isCreated()` is false;
  - `Display.isFullscreen()` is false after active container removal;
  - audio teardown still happens through `AL.destroy()`;
  - no stale RAF, input listener, fullscreen listener, or fullscreen canvas traps the host menu.

- Browser Escape integration test in a real desktop browser:
  - enter fullscreen through Space;
  - press browser Escape or otherwise force browser fullscreen exit;
  - verify the game is windowed at `800x600`, input scale is back to `1,1`, offsets are `0,0`, and the cursor is visible over the game canvas.

## Non-blockers checked in this pass

- The explicit unsupported TS methods (`Graphics.drawOval`, `fillOval`, arcs, round rects, `Image.drawSheared`, `Image.drawWarped`, `Graphics.fillRect(..., ShapeFill)`) are not called by the desktop AppGameContainer path of this game.
- The game's actual rendering surface uses image draws, sub-images, flips, alpha, GL push/pop/translate/scale/rotate, `Graphics.setClip`, `clearClip`, `drawRect`, `fillRect`, and custom bitmap text. These APIs are present in the current TS source.
- Input keys used by `HumanInput` and `EnterInitialsMode` are mapped in TS: arrows, WASD, IJKL, top-row 2/4/6/8, Enter, Space, Escape, and P.
- The Java game uses its own `Main.paused` flag and does not call `GameContainer.pause()` in the checked sources, so the broader Slick paused-update semantic difference is not listed as a Ms. Pac-Man blocker here.
