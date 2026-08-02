# Slick2D TS Re-Audit 7 for the Ms. Pac-Man Browser Port

Date: 2026-08-02

Scope: Re-audited the current `C:\js-projects\slick2d-ts` TypeScript source against Java Slick2D in `C:\java-projects\slick2d\Slick\src\org\newdawn\slick` and the Ms. Pac-Man call surface in `C:\NetBeansProjects\SlickMsPacMan\src\mspacman`. This pass ignores intentional desktop/applet-only Java omissions unless the difference can change the desktop browser PWA behavior of this game.

## Current Status

The previous re-audit 6 items are mostly repaired in the current TypeScript source:

- `AppGameContainer` now defaults to visible-only updates: `C:\js-projects\slick2d-ts\src\slick\AppGameContainer.ts:79`.
- `AppGameContainer.destroy()` now calls `AL.destroy()`: `C:\js-projects\slick2d-ts\src\slick\AppGameContainer.ts:325`; `AL.destroy()` calls `SoundStore.get().destroy()`: `C:\js-projects\slick2d-ts\src\lwjgl\openal\AL.ts:19`.
- `SoundStore.setSoundsOn(...)` and `setMusicOn(...)` now no-op before `soundWorksFlag` is true: `C:\js-projects\slick2d-ts\src\slick\openal\SoundStore.ts:100-105`, `148-153`.
- `Sound` now tracks one current handle instead of every handle: `C:\js-projects\slick2d-ts\src\slick\Sound.ts:60-70`, `82-88`, `92-105`.
- Sound-effect gain now applies Slick global sound volume in `Sound` and again in `SoundStore`, matching the checked Java double-application path: `C:\js-projects\slick2d-ts\src\slick\Sound.ts:61`, `83`; `C:\js-projects\slick2d-ts\src\slick\openal\SoundStore.ts:345`.

I found two remaining game-relevant parity problems.

## Finding 1: Failed `Sound.play()` / `loop()` does not clear the remembered source

Severity: medium for this game. It only appears when a play request is dropped, but dropped sound requests are now possible because the TS port has a finite source pool and because the game can toggle sounds through the container.

### Java behavior

Java `Sound` delegates to an `Audio` instance:

- `Sound.play(float, float)` calls `sound.playAsSoundEffect(...)`: `C:\java-projects\slick2d\Slick\src\org\newdawn\slick\Sound.java:116-118`.
- `Sound.loop(float, float)` does the same with `loop=true`: `Sound.java:156-158`.
- `Sound.playing()` returns `sound.isPlaying()`: `Sound.java:165-167`.
- `Sound.stop()` calls `sound.stop()`: `Sound.java:172-174`.

For non-streamed sounds, `AudioImpl` stores exactly one source index:

- `AudioImpl.playAsSoundEffect(...)` overwrites `index` with the result from `SoundStore.playAsSound(...)`: `C:\java-projects\slick2d\Slick\src\org\newdawn\slick\openal\AudioImpl.java:83-86`.
- The location overload does the same with `SoundStore.playAsSoundAt(...)`: `AudioImpl.java:92-94`.
- `AudioImpl.isPlaying()` returns false when `index == -1`: `AudioImpl.java:72-78`.
- `AudioImpl.stop()` only stops when `index != -1`, then sets `index = -1`: `AudioImpl.java:62-67`.

`SoundStore.playAsSoundAt(...)` returns `-1` when sound effects are disabled or no free effect source exists:

- It only enters playback when `soundWorks` and `sounds` are true: `C:\java-projects\slick2d\Slick\src\org\newdawn\slick\openal\SoundStore.java:394-405`.
- `findFreeSource()` returns `-1` when there is no free source: `SoundStore.java:447-456`.

Therefore, in Java, every play/loop attempt replaces the remembered source index. If the new attempt is dropped, the remembered source becomes `-1`; `Sound.playing()` immediately reports false and `Sound.stop()` no longer stops the older source that may still be playing.

### Current TypeScript behavior

`Sound.play(...)` and `Sound.loop(...)` call `SoundStore.playSound(...)`, but if the store returns `null`, they simply return:

- `Sound.play(...)`: `C:\js-projects\slick2d-ts\src\slick\Sound.ts:60-70`.
- `Sound.loop(...)`: `C:\js-projects\slick2d-ts\src\slick\Sound.ts:82-88`.

The old `this.active` handle is not cleared in either `if (!handle)` branch. That is not Java-equivalent. A failed play request should become the latest remembered result, which means "no source".

### Why this matters for Ms. Pac-Man

The game owns one shared `Sound` object per effect:

- Sound fields are loaded once in `Main.loadSoundEffects()`: `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Main.java:524-537`.
- `Main.playSound(Sound sound)` calls `sound.play()`: `Main.java:439-441`.
- `Main.stopAllSoundEffects()` stops the shared sound fields individually: `Main.java:447-458`.
- `PlayingMode` starts and later stops the shared `blueGhostsSound`: `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\PlayingMode.java:266-284`, `510`.

Concrete failure path:

1. A shared `Sound` instance successfully plays, so `this.active` points at a handle.
2. A later `play()` or `loop()` for that same `Sound` is dropped because `SoundStore.playSound(...)` returns `null` while sound effects are disabled or the source pool is full: `C:\js-projects\slick2d-ts\src\slick\openal\SoundStore.ts:292-304`.
3. Java would set the remembered source to `-1`.
4. TS keeps the previous handle in `this.active`.
5. A later `sound.stop()` or `sound.playing()` observes/stops the old source in TS, while Java would treat that `Sound` as having no remembered source.

This can change cleanup behavior during death, mode transitions, energizer expiration, and any high-overlap audio moment.

### Required repair

Make failed `Sound.play(...)`, `playAt(...)`, and `loop(...)` overwrite the remembered source just like Java:

- If `SoundStore.playSound(...)` returns `null`, set `this.active = null` before returning.
- Keep the existing on-ended callback guard for successful non-looping plays.
- Add a regression test where a `Sound` has an older active looping handle, `SoundStore` then rejects a new play, and `sound.playing()` becomes false while the older handle itself is still playing until global cleanup or natural end.
- Add the same test for the no-free-source path, not only the `setSoundsOn(false)` path.

## Finding 2: The source-pool fix still allows one extra simultaneous sound effect

Severity: low-to-medium for this game. It only matters under high audio overlap, but exact parity requires the same drop threshold as Java.

### Java behavior

Java `SoundStore` treats source `0` as the music source and searches only a strict subset of the remaining generated sources for sound effects:

- Default `maxSources` is `64`: `C:\java-projects\slick2d\Slick\src\org\newdawn\slick\openal\SoundStore.java:73`.
- `init()` allocates sources into `sources`, increments `sourceCount`, and breaks when `sourceCount > maxSources - 1`, so a full Web/OpenAL-success path gives `sourceCount == maxSources`: `SoundStore.java:312-324`.
- Sound effects search `for (int i=1;i<sourceCount-1;i++)`: `SoundStore.java:447-456`.

That loop means:

- `source 0` is not available to sound effects.
- `source sourceCount - 1` is also not available to sound effects.
- With the default `sourceCount == 64`, Java exposes effect slots `1..62`, or 62 simultaneous sound effects.
- With `sourceCount == 3`, Java exposes only effect slot `1`, so the second simultaneous effect should already fail.

This may be an odd Slick2D quirk, but it is the behavior in the checked Java source.

### Current TypeScript behavior

The TS source-pool implementation uses `maxSources` as the logical source count, but `findFreeSoundSource()` searches:

- `for (let index = 1; index < this.maxSources; index++)`: `C:\js-projects\slick2d-ts\src\slick\openal\SoundStore.ts:387-395`.

So with `maxSources == 64`, TS exposes effect slots `1..63`, or 63 simultaneous sound effects. With `setMaxSources(3)`, TS exposes two effect slots, not one.

The current test suite encodes the TS behavior, not the Java behavior:

- `test\sound-store-parity.test.mjs:120-130` sets `maxSources` to `3`, starts `first`, `second`, and `third`, and expects `first` and `second` to be non-null while `third` is null.
- Under the checked Java loop bound, `first` should be non-null and `second` should already be null for `sourceCount == 3`.
- The later same-file tests at `test\sound-store-parity.test.mjs:141-172` also rely on `setMaxSources(3)` allowing two concurrent effects.

### Why this matters for Ms. Pac-Man

Ms. Pac-Man can fire repeated, overlapping sound effects:

- Pellet effects can be requested frequently: `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\MsPacMan.java:111`.
- Energizer and blue-ghost sounds can be requested close together: `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\PlayingMode.java:266-284`.
- Mode transitions and death/start paths stop shared sounds, but do not globally prevent overlap before that cleanup: `PlayingMode.java:223`, `Main.java:447-458`.

The difference is one extra overlapping sound effect at the pool limit. It will not affect normal low-overlap play most of the time, but it is still not a 1-to-1 conversion of Slick2D's source-allocation behavior.

### Required repair

Make the TS logical source search match Java's `i < sourceCount - 1` rule:

- If `maxSources` represents Java `sourceCount`, change `findFreeSoundSource()` to search `index = 1; index < this.maxSources - 1; index++`.
- Review `setMaxSources(...)` and `resetSoundSources()` so the last logical source remains unavailable for sound effects. If dynamic resizing is kept as a TS helper, do not preserve a playing handle in the new last slot as an active effect slot.
- Update `test\sound-store-parity.test.mjs`:
  - With `setMaxSources(3)`, only one sound effect should start; the second should be `null`.
  - To test two simultaneous effects, use `setMaxSources(4)`.
  - Update the "Sound.stop and Sound.playing track only the latest source" test to use `setMaxSources(4)` if it still needs two concurrent effect handles.

## Validation

- First `npm.cmd test` inside the managed sandbox failed because the test script rebuilds `C:\js-projects\slick2d-ts\dist`, which is outside this task's writable workspace.
- Re-ran `npm.cmd test` with approved escalation from `C:\js-projects\slick2d-ts`; it passed all 12 tests.
- The passing suite does not clear Finding 2, because the current tests assert the off-by-one TS behavior described above.

## Non-Findings Checked In This Pass

- I am not re-listing Java desktop display/applet behavior that is intentionally browser-specific.
- The remaining explicit unsupported graphics overloads in `Graphics` and `Image` are still not used by the desktop `AppGameContainer` path of this game.
- `SoundStore.stopSoundEffect(int)` is still a no-op in TS (`C:\js-projects\slick2d-ts\src\slick\openal\SoundStore.ts:198-200`), while Java calls `AL10.alSourceStop(id)` (`C:\java-projects\slick2d\Slick\src\org\newdawn\slick\openal\SoundStore.java:961-962`). I am not listing it as a Ms. Pac-Man blocker because the checked game code does not call `SoundStore.stopSoundEffect(...)` directly, and current TS `Sound.stop()` works through its stored handle rather than this integer-id API.
- `SoundStore.clear()` parity remains broader than this game's PWA path: Java replaces the singleton store, while TS clears buffers/handles. The checked PWA-relevant teardown now goes through `AL.destroy()` / `SoundStore.destroy()`, so I am not listing `clear()` as a new game blocker here.
