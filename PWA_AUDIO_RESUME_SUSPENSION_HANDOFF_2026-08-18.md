# Ms. Pac-Man PWA Audio Resume/Suspension Handoff

Date: 2026-08-18

## Context

Stickvania exposed a browser-only audio lifecycle bug during the ending credits: after opening the live PWA menu or losing focus, resuming the game could leave music silent even though the game state and Slick2D-ts `Music.playing()` state still said a track was active.

This happens because Slick2D-ts implements `GameContainer.setMusicOn(false)` by globally suspending the current Web Audio source while keeping Java-style `Music.playing()` logically true. If the browser source does not resume cleanly, game code that relies only on `Music.playing()` can believe music is still active and never call `play()`/`loop()` again.

Ms. Pac-Man does not use a custom `Song` intro/loop wrapper like Stickvania/Jackal, so the risk is lower. It still uses the same browser suspension pattern and should be hardened.

## Relevant Code

- `pwa/src/app/main.ts`
  - `showLiveMenuOverlay()` calls `game.setBrowserSuspended(true)` before `saveCurrentGameState()`.
  - `suspendCurrentGame()` calls `game.setBrowserSuspended(true)` before `saveCurrentGameState()`.
  - `returnToMenu()` fallback also suspends before saving.
  - `syncCurrentGameLifecycleState()` resumes with `game.setBrowserSuspended(false)` and `container?.setLoopSuspended(false)`.

- `pwa/src/mspacman/Main.ts`
  - `setBrowserSuspended(true)` stops sound effects and calls `appGameContainer?.setMusicOn(false)`.
  - `setBrowserSuspended(false)` calls `appGameContainer?.setMusicOn(!this.paused)` and resets timing.
  - It does not explicitly call `currentMusic?.resume()`.
  - `currentMusic` is managed by `playMusic()`, `loopMusic()`, `stopMusic()`, and `fadeMusic()`.

- `pwa/src/mspacman/persistence/MsPacManGameStateSerializer.ts`
  - `captureMusic()` stores `currentMusic`, `music.playing()`, private `paused`, `looped`, `playbackRate`, position, and volume.
  - `restoreMusic()` restarts/restores active music and eventually calls `gc.setMusicOn(!main.paused)`.
  - `MAIN_FIELDS` does not include `browserSuspended`; there is no separate `AudioStateSnapshot`.

## Findings

### 1. Save Order Should Match Stickvania's Fix

Current PWA shell code saves after browser suspension has already muted music:

```ts
game.setBrowserSuspended(true);
container?.stopSoundEffects();
container?.setLoopSuspended(true);
saveCurrentGameState();
```

Stickvania changed this to save before `setBrowserSuspended(true)`, so the snapshot captures the active audio state before the browser-only mute/suspend layer changes `SoundStore`.

Ms. Pac-Man should do the same in:

- `showLiveMenuOverlay()`
- `suspendCurrentGame()`
- `returnToMenu()` fallback path, if it saves a state there

Recommended shape:

```ts
saveCurrentGameState();
game.setBrowserSuspended(true);
container?.stopSoundEffects();
container?.setLoopSuspended(true);
```

This should not change gameplay behavior. It only changes when the PWA shell snapshots state relative to the browser audio mute.

### 2. Add Explicit Current-Music Resume On Browser Resume

`Main.setBrowserSuspended(false)` currently relies entirely on `appGameContainer.setMusicOn(!this.paused)` to resume the active Web Audio handle.

That normally works if Slick2D-ts still has a tracked handle. The weak case is a browser/source/handle mismatch where `Music.playing()` remains true but no audible source resumes. A low-risk hardening is to call `currentMusic.resume()` after restoring music-on state.

Recommended shape:

```ts
public setBrowserSuspended(suspended: boolean): void {
    if (this.browserSuspended === suspended) {
        return;
    }

    this.browserSuspended = suspended;
    if (suspended) {
        this.stopAllSoundEffects();
        this.appGameContainer?.setMusicOn(false);
    } else {
        this.appGameContainer?.setMusicOn(!this.paused);
        this.resumeBrowserAudio();
        this.resetNextFrameTime();
    }
}

private resumeBrowserAudio(): void {
    if (this.paused || this.appGameContainer === null || !this.appGameContainer.isMusicOn()) {
        return;
    }
    this.currentMusic?.resume();
}
```

`Music.resume()` is safe here because Slick2D-ts only acts when the music is paused or globally suspended. It should not restart naturally finished one-shot tracks.

### 3. Cold Restore Is Probably Less Exposed Than Stickvania

`restoreMusic()` already restarts a captured active `Music` by calling `play()`/`loop()` with `gc.setMusicOn(false)`, seeks once ready, then calls `gc.setMusicOn(!main.paused)`. That means cold-start Continue is probably okay for active music.

Still, saving before suspension is cleaner because it avoids relying on browser-suspended `Music.playing()` semantics during capture.

## Suggested Validation

After patching:

1. Run `npm.cmd run typecheck`.
2. Run `npm.cmd run lint`.
3. Run `npm.cmd run build:pwa`.
4. Browser-test:
   - Start gameplay while music is playing.
   - Open the live PWA menu, then Continue.
   - Alt-tab or blur the browser, then focus it again.
   - Repeat while the in-game pause state is active; music should remain off until unpaused.
   - Test at least one cutscene/act/ending music section if easy to reach.

## Expected Risk

Low. The proposed change is PWA lifecycle hardening only. It should not affect Java parity mechanics, movement, scoring, timers, or rendering.

