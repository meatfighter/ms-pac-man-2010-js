# Ms. Pac-Man 2010 PWA Loop Suspension Integration

Date: 2026-08-12

## Verdict

Yes. `C:\js-projects\ms-pac-man-2010-js` should integrate the new `slick2d-ts` browser loop suspension feature.

This is a PWA/browser lifecycle improvement, not a Java gameplay parity change. The game already has a browser-suspended flag that stops its own update/timing path on focus loss. The remaining problem is that the `AppGameContainer` RAF loop can keep scheduling frames, polling browser-facing subsystems, clearing the canvas, and submitting draw work while the game is browser-suspended.

## Relevant Engine Feature

The shared `slick2d-ts` dependency now exposes these `AppGameContainer` methods:

```ts
setLoopSuspended(suspended: boolean): void;
isLoopSuspended(): boolean;
suspendLoop(): void;
resumeLoop(): void;
```

Confirmed in this project through the local dependency junction:

- `C:\js-projects\ms-pac-man-2010-js\package.json` depends on `slick2d-ts` as `file:../slick2d-ts`.
- `C:\js-projects\ms-pac-man-2010-js\node_modules\slick2d-ts` is a junction to `C:\js-projects\slick2d-ts`.
- `node_modules\slick2d-ts\dist\slick\AppGameContainer.d.ts` contains `setLoopSuspended`, `isLoopSuspended`, `suspendLoop`, and `resumeLoop`.

The engine semantics are the correct shape for this PWA feature:

- `setLoopSuspended(true)` cancels any scheduled RAF and clears stored delta.
- While suspended, the container RAF callback returns before `loopFrame`.
- `loopFrame` also checks suspension after update before render.
- `setLoopSuspended(false)` resets frame timing and schedules one new RAF.
- It does not change Java Slick2D pause semantics, game pause state, fullscreen state, resource state, textures, audio buffers, or `alwaysRender`.

## Current Ms. Pac-Man Behavior

Project shell:

- `pwa/src/app/main.ts:10-23` defines a local `RuntimeContainer` type for the dynamically imported `AppGameContainer` instance.
- That type currently includes `setAlwaysRender(...)`, `setClearEachFrame(...)`, `setMusicVolume(...)`, `setSoundVolume(...)`, and other container methods, but it does not include `setLoopSuspended(...)`.
- `pwa/src/app/main.ts:175-181` constructs the container, stores it in `container`, stores the game in `game`, and assigns `mainGame.appGameContainer = appContainer`.
- `pwa/src/app/main.ts:198` calls `container.setAlwaysRender(true)`.
- `pwa/src/app/main.ts:303-309` suspends the game on lifecycle events by calling `game?.setBrowserSuspended(true)` and saving state.
- `pwa/src/app/main.ts:311-315` resumes the game by calling `game?.setBrowserSuspended(false)` when the page is visible and focused.
- `pwa/src/app/main.ts:317-327` has a synchronization path that sets browser suspension based on `document.visibilityState` and `document.hasFocus()`.
- `pwa/src/app/main.ts:551-567` wires `pagehide`, `blur`, `focus`, and `visibilitychange` to those suspend/resume helpers.

Game class:

- `pwa/src/mspacman/Main.ts:183-187` returns early from `update(...)` while `browserSuspended` is true and resets the next-frame time.
- `pwa/src/mspacman/Main.ts:397-410` toggles `browserSuspended`, stops sound effects on suspend, disables container music while suspended, restores music according to pause state on resume, and resets timing on resume.
- `pwa/src/mspacman/Main.ts:223-232` renders the current mode and the pause overlay. It does not have a browser-suspended render guard, which is fine; the PWA shell should stop the container loop instead of adding browser conditionals to Java-parity game classes.

Loading/resource behavior:

- `pwa/src/app/main.ts:99-111` preloads resources before mounting the game if `runtimeResourcesLoaded` is false.
- `pwa/src/app/main.ts:215-225` uses `ResourceLoader.clearFailures()`, cache busting, retry options, and sequential resource loading with progress callbacks.
- `pwa/src/app/main.ts:303-305` already avoids lifecycle suspension while the internal loading screen is active.
- `pwa/src/app/main.ts:433-445` uses a separate RAF only while the hamburger is hidden because the game is still loading.

## Why This Project Benefits

The existing `browserSuspended` game flag is necessary but not sufficient.

When focus is lost while the document is still visible, `document.visibilityState` remains `visible`. In that case, the engine's hidden-tab guard does not apply. Since the shell has set `alwaysRender` to true, `AppGameContainer.loopFrame(...)` can still render even when the browser window is not focused.

When the tab is actually hidden, the engine's `updateOnlyWhenVisible` path avoids update/render work, but it still schedules follow-up RAF callbacks. Browsers usually throttle hidden RAFs, but the scheduling source is not intentionally stopped.

Using `container.setLoopSuspended(true)` during lifecycle suspension closes both gaps:

- No new RAF is scheduled while suspended.
- No input polling happens while suspended.
- No music or sound polling happens while suspended.
- No `game.update(...)` call happens while suspended.
- No `game.render(...)` call happens while suspended.
- No clear/beginFrame/endFrame work reaches the renderer while suspended.
- No accumulated delta is delivered on resume.

A brace-level scan of `pwa/src/mspacman` found no confirmed render-time field mutation in methods whose names contain `render`. That means this project does not appear to have Jackal's exact rotor-style visible animation bug. The integration is still worthwhile because it stops unnecessary CPU/GPU/audio/input work in a desktop browser PWA.

## Required Implementation

Only edit the PWA shell unless testing reveals a separate game-specific issue. Do not edit Java-parity gameplay classes for this feature.

1. Update `pwa/src/app/main.ts` `RuntimeContainer`.

Add the method exposed by `slick2d-ts`:

```ts
setLoopSuspended(suspended: boolean): void;
```

No import change is needed for this type because it is a local structural type. This keeps the dynamic import pattern intact.

2. Update lifecycle suspend paths in `pwa/src/app/main.ts`.

In `suspendCurrentGame()`:

- Keep the existing `game?.isLoadingScreenActive()` guard.
- Keep `game?.setBrowserSuspended(true)`.
- Add `container?.setLoopSuspended(true)` immediately after the game browser-suspended call.
- Keep `saveCurrentGameState()`.

In `syncCurrentGameLifecycleState()`:

- In the visible-and-focused branch, call `container?.setLoopSuspended(false)` together with `game.setBrowserSuspended(false)`.
- In the suspended branch, call `container?.setLoopSuspended(true)` together with `game.setBrowserSuspended(true)` before saving.

In `resumeCurrentGame()`:

- Keep the existing `document.visibilityState === "visible" && document.hasFocus()` check.
- Keep `game?.setBrowserSuspended(false)`.
- Add `container?.setLoopSuspended(false)` in the same branch.

3. Preserve loading-screen behavior.

Do not suspend the container while `game?.isLoadingScreenActive()` is true. This project has a distinct preload shell before the game is mounted and an internal loading mode after the container starts. Freezing the container during internal loading could prevent progress/error presentation and delay the transition to a playable state.

4. Do not connect this to ordinary in-game pause.

Do not call `setLoopSuspended(...)` from `handleGamePauseStateChanged(paused)`.

Reason: ordinary gameplay pause is a Java/Slick2D game state. The pause overlay and cursor behavior still need to render and respond while the browser remains focused. Loop suspension is only for browser lifecycle suspension: page hidden, pagehide, or focus loss to another application/window.

5. Do not change `setAlwaysRender(true)`.

The PWA uses responsive sizing, fullscreen behavior, menu return affordances, and browser-hosted presentation. `alwaysRender` can remain true for active/focused play. The new lifecycle API is the explicit off switch when the app should be dormant.

6. Destroy/menu path.

`renderMenu()` already calls `destroyGame()` at `pwa/src/app/main.ts:52-53`, and `destroyGame()` destroys the container at `pwa/src/app/main.ts:276-282`. No separate loop-resume call is required before destruction. If a suspended container is destroyed, `AppGameContainer.destroy()` cancels scheduled frames and clears engine state.

## Verification Plan

Run after implementation:

```text
npm.cmd run build:pwa
npm.cmd run lint
```

Manual browser checks:

- Start a new game, wait until the game is past visible loading, then Alt-Tab/click another desktop application while the browser remains visible.
- Confirm the game visually freezes while unfocused.
- Confirm CPU/GPU activity drops compared with the old always-render loop.
- Return focus to the browser and confirm gameplay resumes without a catch-up jump.
- Confirm music resumes according to the existing pause state.
- Confirm sound effects do not continue while suspended.
- Confirm the loading screen still progresses and can display retry/error UI.
- Confirm ordinary in-game pause still displays the pause overlay and does not suspend the whole RAF loop.

## Concerns / Things Not To Change Casually

- This is not a Java Slick2D parity correction. It is a browser PWA lifecycle hook around the Java-parity game.
- Do not move update logic into render or render logic into update.
- Do not alter `Main.setBrowserSuspended(...)` unless a separate input/audio bug is confirmed.
- Do not remove `setAlwaysRender(true)` as a substitute. That would alter active-window rendering behavior and still would not intentionally cancel the RAF scheduling source.
- If stale key-pressed state is later observed after focus restore, audit that separately. Stickvania clears input pressed records on browser resume; Ms. Pac-Man currently clears pressed records on mode changes/restores, not in `setBrowserSuspended(...)`. That is outside the minimum loop-suspension integration and should be parity-tested before changing.
