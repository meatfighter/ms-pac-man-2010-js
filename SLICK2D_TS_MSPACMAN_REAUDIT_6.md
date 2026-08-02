# Slick2D TS Re-Audit 6 for the Ms. Pac-Man Browser Port

Date: 2026-08-02

Scope: This pass re-audited the current `C:\js-projects\slick2d-ts` TypeScript source against Java Slick2D in `C:\java-projects\slick2d\Slick\src\org\newdawn\slick` and the Ms. Pac-Man call surface in `C:\NetBeansProjects\SlickMsPacMan\src\mspacman`. It treats Java-only desktop and applet mechanics as intentional browser differences unless the mismatch can change this game's PWA behavior.

Validation run:

- `npm.cmd run typecheck` in `C:\js-projects\slick2d-ts`: passed.

Fixes from re-audit 5 verified and not re-listed:

- `AppGameContainer.destroy()` now exits browser fullscreen fire-and-forget, restores the last windowed canvas size without notification, restores transparent fullscreen cursors, calls `AL.destroy()`, and unregisters `Display`.
- `Display.destroy()` / `Display.setActiveContainer(null)` now clear stale fullscreen state.
- Browser `fullscreenchange` now restores the last windowed display mode when fullscreen is exited outside the Java game path.
- Transparent native cursors now become CSS `cursor: none`, and forced fullscreen exit can restore the visible cursor saved before the transparent cursor was installed.

## Finding 1: `AppGameContainer` updates while hidden by default, unlike Java

Severity: medium-high for the PWA browser port.

This is not the already-discussed `GameContainer.pause()` semantic difference. This is the default visibility policy of `AppGameContainer`.

### Java behavior

In Java Slick2D:

- `AppGameContainer` defaults `updateOnlyOnVisible` to `true` (`C:\java-projects\slick2d\Slick\src\org\newdawn\slick\AppGameContainer.java:52`).
- Its game loop skips `updateAndRender(delta)` when the display is not visible and that flag is still true (`AppGameContainer.java:407-409`).
- `Main.main(...)` does not call `setUpdateOnlyWhenVisible(false)` (`C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Main.java:804-813`), so the original desktop path keeps the Java default.

### Current TypeScript behavior

In `C:\js-projects\slick2d-ts`:

- `GameContainer` initializes `protected updateOnlyWhenVisible = false` (`src\slick\GameContainer.ts:75`).
- `AppGameContainer.loopFrame(...)` updates whenever `!this.updateOnlyWhenVisible || visible` (`src\slick\AppGameContainer.ts:373-374`).
- Since the default is false, the game attempts to keep updating when `document.visibilityState === "hidden"`.

### Why this matters for this game

Ms. Pac-Man's game update ignores Slick's `delta` for simulation and advances using its own `Sys.getTime()` loop:

- `while(nextFrameTime < Sys.getTime()) { ... nextFrameTime += Sys.getTimerResolution() / 91; ... }` (`Main.java:176-184`).

In Java, minimizing/hiding the display causes the container loop to sleep and skip `updateAndRender(...)`, so `Main.update(...)` is not called while hidden. In the TS browser port, hidden-tab behavior depends on RAF throttling and the current false default. If RAF continues at a throttled cadence, game logic can advance while hidden. If RAF is suspended, the first visible frame can still see a large `Sys.getTime()` gap and run up to eight fixed game ticks before resetting. Neither path matches Java's default hidden-window behavior.

This can alter attract mode timing, demo timing, cutscene state, music fade timing, and fullscreen/menu return timing after a tab is hidden or a PWA window is minimized.

### Required repair

- Make the TypeScript `AppGameContainer` default match Java: update only when visible unless `setUpdateOnlyWhenVisible(false)` is explicitly called.
- The least invasive fix is to override/initialize the AppGameContainer-specific default to true. Changing the base `GameContainer` default is also acceptable if no browser-specific code relies on it.
- Keep `setUpdateOnlyWhenVisible(boolean)` and `isUpdatingOnlyWhenVisible()` behavior unchanged.
- When hidden updates are skipped, also reset `lastFrameTime` or otherwise avoid feeding a giant raw delta into the first visible frame. Java calls `getDelta()` before the visibility check each loop, which prevents hidden time from accumulating into the next `updateAndRender(...)`.

### Regression tests to add

- Construct an `AppGameContainer` and assert `isUpdatingOnlyWhenVisible()` is true before any setter call.
- Set `document.visibilityState` to hidden in a test harness, run/simulate a frame, and assert `game.update(...)` is not called by default.
- Call `setUpdateOnlyWhenVisible(false)`, repeat the hidden-frame simulation, and assert `game.update(...)` is called.
- Simulate hidden then visible and assert the next visible frame does not pass accumulated hidden time into game update.

## Finding 2: `setSoundOn(false)` before audio init silences TS sound effects, but Java ignores it

Severity: high for this game if `Main.main(...)` is ported 1-to-1.

### Java behavior

Java `SoundStore` starts with these booleans false by default:

- `private boolean sounds;` (`C:\java-projects\slick2d\Slick\src\org\newdawn\slick\openal\SoundStore.java:33`)
- `private boolean music;` (`SoundStore.java:35`)
- `private boolean soundWorks;` (`SoundStore.java:37`)

`setSoundsOn(...)` only mutates the sound-effect flag after OpenAL is initialized and `soundWorks` is true:

- `public void setSoundsOn(boolean sounds) { if (soundWorks) { this.sounds = sounds; } }` (`SoundStore.java:256-259`).

`setMusicOn(...)` has the same `if (soundWorks)` guard (`SoundStore.java:119-127`).

During `SoundStore.init()`, Java sets both sound effects and music on after OpenAL creation succeeds:

- `soundWorks = true; sounds = true; music = true;` (`SoundStore.java:295-298`).

This means `main.appGameContainer.setSoundOn(false)` in `Main.main(...)` happens before `SoundStore.init()` and is ignored in the original desktop run:

- `main.appGameContainer.setSoundOn(false);` (`C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Main.java:811`)
- Sound init happens later when `new Sound(...)` / `new Music(...)` constructors call `SoundStore.get().init()` during `Main.init(...)`.

### Current TypeScript behavior

In `C:\js-projects\slick2d-ts\src\slick\openal\SoundStore.ts`:

- `musicEnabled` and `soundsEnabled` default to true immediately (`SoundStore.ts:33-34`).
- `setMusicOn(...)` always stores the requested flag (`SoundStore.ts:77-90`).
- `setSoundsOn(...)` always stores the requested flag (`SoundStore.ts:124-126`).
- `init()` only calls `getAudioContext()`; it does not model Java's pre-init ignored state or reset enabled flags to true on first successful init (`SoundStore.ts:144-146`).

### Concrete failure path

1. The port preserves `Main.main(...)` and calls `appGameContainer.setSoundOn(false)` before `start()`.
2. TS stores `soundsEnabled = false`.
3. `AppGameContainer.start()` calls `AL.create()`, which calls `SoundStore.get().init()`.
4. `SoundStore.init()` does not reset sound effects to true.
5. Every later `Sound.play()` returns early because `SoundStore.get().soundsOn()` is false (`src\slick\Sound.ts:60-63`), and `SoundStore.playSound(...)` also rejects when sounds are disabled (`src\slick\openal\SoundStore.ts:225-228`).

Visible result: the TS port can have no pellet, energizer, fruit, ghost, clapping, extra-life, death, or enter sounds, even though the original Java desktop path does play sound effects because the pre-init `setSoundOn(false)` call is ignored.

### Required repair

Model Java's initialization gate explicitly.

Suggested implementation:

- Add `inited` / `soundWorks` state to TS `SoundStore`.
- Start `musicEnabled` and `soundsEnabled` in the Java-observable pre-init state, not as already-user-set true flags.
- Make `setSoundsOn(...)` and `setMusicOn(...)` no-op until `soundWorks` is true, matching Java. If the browser port wants a deliberate pre-start mute control, add a separate browser helper rather than changing Slick2D Java semantics.
- On first successful `init()`, set `soundWorks = true`, `soundsEnabled = true`, and `musicEnabled = true`, matching `SoundStore.java:295-298`.
- Preserve the already-fixed global music-off suspend/resume semantics for calls made after init.

### Regression tests to add

- Before `SoundStore.init()`, call `SoundStore.get().setSoundsOn(false)`, then initialize audio, and assert `SoundStore.get().soundsOn()` is true.
- Before `SoundStore.init()`, call `SoundStore.get().setMusicOn(false)`, then initialize audio, and assert `SoundStore.get().musicOn()` is true.
- After init, call `setSoundsOn(false)` and assert a sound effect does not start.
- Add a Ms. Pac-Man boot-path test that preserves `Main.main`'s `setSoundOn(false)` call and still verifies `pressedEnterSound.play()` can create a sound-effect handle after init.

## Finding 3: TS sound effects have unlimited handles, but Java uses a finite OpenAL source pool

Severity: medium for general gameplay audio parity; high if exact sound overlap/drop behavior is required.

### Java behavior

Java `SoundStore` allocates a finite source pool:

- Default `maxSources = 64` (`C:\java-projects\slick2d\Slick\src\org\newdawn\slick\openal\SoundStore.java:73`).
- `init()` creates up to that many OpenAL sources and records `sourceCount` (`SoundStore.java:312-324`).
- Source 0 is reserved for music. Sound effects search from source 1 up to `sourceCount - 1` (`SoundStore.java:447-456`).
- `playAsSoundAt(...)` calls `findFreeSource()` and returns `-1` if no free source exists (`SoundStore.java:394-405`).

So Java drops a sound effect when all sound-effect sources are playing or paused. It does not create unbounded overlapping effects.

### Current TypeScript behavior

In TS:

- `SoundStore` tracks active handles in an unbounded `Set<AudioPlaybackHandle>` (`src\slick\openal\SoundStore.ts:41`).
- `playSound(...)` creates a new Web Audio source for every play request after the buffer resolves (`SoundStore.ts:225-276`).
- There is no source count, no reserved music source, no `findFreeSource()` equivalent, and no drop behavior when too many effects overlap.

### Why this matters for this game

The game can request many short effects in rapid succession:

- Pellet sound is played from `MsPacMan.java:111`.
- Energizer and blue-ghost sounds are played repeatedly in `PlayingMode.java:266-284`.
- Mode transitions and death/start paths call `stopAllSoundEffects()` (`PlayingMode.java:223`, `Main.java:447-458`).

Java's finite source pool is part of the audible behavior under heavy overlap. TS can sound busier because every request can create another handle instead of being dropped when the pool is full.

### Required repair

- Implement a Java-like finite sound-effect source pool in `SoundStore`.
- Reserve one logical source for music and use the remaining logical sources for sound effects.
- Default to Java's `maxSources = 64`, with a `setMaxSources(max)` API if broader Slick compatibility wants it.
- Track logical source state as playing/paused/free. A Web Audio `AudioBufferSourceNode` cannot be reused, but the logical source slot can own the current handle and become free on end/stop.
- If no source is free, return `null` / equivalent no-play result from `playSound(...)` without creating a Web Audio source.
- Keep `getSourceCount()` Java-like: return the logical source count, not the number of currently active handles.

### Regression tests to add

- Configure a small logical source count, for example 3 total sources: one music plus two effects.
- Start two long/looping sound effects and assert a third sound-effect play request is dropped.
- Stop one effect and assert the next play request succeeds.
- Assert `getSourceCount()` returns configured capacity, not currently active handles.

## Finding 4: `Sound.stop()` / `Sound.playing()` track all TS handles, but Java tracks only the last source for that `Sound`

Severity: medium for this game, because it repeatedly stops shared `Sound` instances.

### Java behavior

Java `Sound` delegates to a single `Audio` object:

- `Sound.playing()` returns `sound.isPlaying()` (`C:\java-projects\slick2d\Slick\src\org\newdawn\slick\Sound.java:165-167`).
- `Sound.stop()` calls `sound.stop()` (`Sound.java:172-174`).

For non-streamed sounds, `AudioImpl` stores one source index:

- `private int index = -1;` (`C:\java-projects\slick2d\Slick\src\org\newdawn\slick\openal\AudioImpl.java:15-23`)
- Each `playAsSoundEffect(...)` overwrites `index` with the newest source (`AudioImpl.java:84-94`).
- `stop()` stops only that current `index` and clears it (`AudioImpl.java:62-66`).
- `isPlaying()` checks only that current `index` (`AudioImpl.java:72-77`).

If the same Java `Sound` instance is played multiple times before earlier plays finish, `stop()` only stops the most recent source remembered by the `AudioImpl`. Earlier overlapping sources keep playing until they end or are stopped through lower-level source APIs.

### Current TypeScript behavior

In TS:

- `Sound` stores every playback handle in `private active: AudioPlaybackHandle[] = []` (`src\slick\Sound.ts:12`).
- `play(...)` pushes each handle (`Sound.ts:60-73`).
- `loop(...)` pushes each handle (`Sound.ts:82-89`).
- `playing()` returns true if any tracked handle is still playing (`Sound.ts:91-94`).
- `stop()` stops every tracked handle (`Sound.ts:97-101`).

### Why this matters for this game

The game owns one `Sound` object per effect and reuses those objects:

- `atePellotSound`, `ateEnergizerSound`, `blueGhostsSound`, and others are single fields loaded once (`Main.java:123-133`, `Main.java:524-541`).
- `stopAllSoundEffects()` calls `stop()` on those shared fields (`Main.java:447-458`).
- `stopSound(Sound sound)` ignores its parameter and stops `blueGhostsSound` specifically (`Main.java:443-445`), preserving the original Java quirk.

Because TS stops all handles for an effect, while Java stops only the latest logical source for that effect, the TS port can cut off more overlapping audio than the Java version during death, mode changes, energizer transitions, and blue-ghost cleanup.

### Required repair

Choose a Java-compatible model for `Sound`:

- Track the most recent logical sound-effect source/handle for `Sound.play(...)` and `Sound.loop(...)`.
- Make `Sound.playing()` report only that most recent source/handle.
- Make `Sound.stop()` stop only that most recent source/handle.
- Let `SoundStore.clear()` / container teardown remain the global way to stop every active handle.
- If a browser convenience method is desired to stop all handles spawned by one `Sound`, add it as a new browser helper, not as the Java `Sound.stop()` behavior.

This repair should be coordinated with Finding 3's logical source pool so `Sound` can remember a Java-like source id/slot rather than an arbitrary list of Web Audio nodes.

### Regression tests to add

- Use one `Sound` instance and play it twice with long or looped buffers.
- Call `sound.stop()`.
- Assert only the most recent logical source stops and the earlier one remains active until it ends or global cleanup occurs.
- Assert `sound.playing()` follows the most recent source only.
- Assert `SoundStore.clear()` still stops all active sources.

## Finding 5: Sound-effect volume scaling differs from Java and can affect the PWA menu volume slider

Severity: medium. This is mostly audible only when the port exposes user volume below 1, which the PWA requirements do.

### Java behavior

Java applies global sound volume in two places for sound effects:

- `Sound.play(float pitch, float volume)` passes `volume * SoundStore.get().getSoundVolume()` to `Audio.playAsSoundEffect(...)` (`C:\java-projects\slick2d\Slick\src\org\newdawn\slick\Sound.java:116-118`).
- `Sound.playAt(...)` does the same (`Sound.java:140-142`).
- `Sound.loop(float pitch, float volume)` does the same (`Sound.java:156-158`).
- `SoundStore.playAsSoundAt(...)` then does `gain *= soundVolume` again before assigning the source gain (`C:\java-projects\slick2d\Slick\src\org\newdawn\slick\openal\SoundStore.java:394-396`).

So the checked Java source's effective sound-effect gain is:

`requestedVolume * soundVolume * soundVolume`

Java `setSoundVolume(...)` updates only the stored `soundVolume` field for future source setup (`SoundStore.java:192-198`). It does not retroactively update already-playing sound-effect source gains.

### Current TypeScript behavior

In TS:

- `Sound.play(...)` passes the requested `volume` directly into `SoundStore.playSound(...)` (`src\slick\Sound.ts:60-73`).
- `SoundStore.playSound(...)` assigns that requested volume to a per-source `GainNode` (`src\slick\openal\SoundStore.ts:264`).
- Global sound volume is applied through `soundBus.gain.value` (`SoundStore.ts:111-115`, `SoundStore.ts:176-179`).
- Changing `setSoundVolume(...)` updates the bus and therefore changes active sound effects too (`SoundStore.ts:111-115`).

Effective TS gain is:

`requestedVolume * soundVolume`

and active sound effects are affected by later global volume changes.

### Why this matters for this port

The requested PWA menu includes an audio volume slider. If that slider sets Slick global sound volume to, for example, `0.5`, Java's checked source would make newly played sound effects roughly `0.25` of full requested gain, while TS currently makes them `0.5`. If the user changes the slider while a sound is already playing, TS changes that active sound immediately; Java does not for sound effects.

Music is different: Java's music volume path is intended to update current music through the music source. Do not apply this finding to music.

### Required repair

For strict Slick2D Java parity:

- Make `Sound.play(...)`, `playAt(...)`, and `loop(...)` apply `SoundStore.get().getSoundVolume()` before passing gain to `SoundStore.playSound(...)`, matching Java `Sound.java`.
- Keep `SoundStore.playSound(...)` applying the global sound volume again when the source is created, or otherwise make the final gain equal `requestedVolume * soundVolume * soundVolume`.
- Do not use a global sound bus gain for Java `setSoundVolume(...)` if it changes already-playing sound effects. Either leave existing handles at their assigned gain, or separate a browser master output bus from Slick's Java `soundVolume` and document the distinction.

If the product intentionally wants a modern linear master slider instead of Java's double-applied sound-volume quirk, document that as a deliberate game-port divergence. Do not leave it as an accidental Slick2D parity mismatch.

### Regression tests to add

- Set global sound volume to `0.5`.
- Play a sound with requested volume `1`.
- Assert the created source/effective gain is `0.25` in Java-parity mode.
- Change global sound volume after the source starts and assert the already-playing sound-effect gain does not change.
- Separately verify music volume still updates active music as intended.
