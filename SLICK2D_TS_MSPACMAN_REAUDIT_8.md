# Slick2D TS vs Java Re-audit 8 for the Ms. Pac-Man Browser Port

Date: 2026-08-02

Scope: another focused audit of `C:\java-projects\slick2d` against `C:\js-projects\slick2d-ts`, limited to Slick2D behavior that can affect the planned 1-to-1 TypeScript port of `C:\NetBeansProjects\SlickMsPacMan`. I intentionally did not re-list Java desktop/applet/native details that are not expected in a desktop browser PWA, and I did not re-list issues already repaired from the previous reports.

## Current Status of the Last Report

The issues from `SLICK2D_TS_MSPACMAN_REAUDIT_7.md` appear to have been repaired in the current `slick2d-ts` working tree:

- `C:\js-projects\slick2d-ts\src\slick\Sound.ts:12`, `:62-71`, and `:85-90` now keep a current `AudioPlaybackHandle`, clear it when `play()` or `loop()` cannot allocate/play, and keep `playing()`/`stop()` tied to the latest handle.
- `C:\js-projects\slick2d-ts\src\slick\openal\SoundStore.ts:390-398` now searches effect sources with `index < this.maxSources - 1`, matching Java Slick2D's `i < sourceCount - 1` behavior.
- `C:\js-projects\slick2d-ts\src\slick\openal\SoundStore.ts:209-224` now trims/keeps legal sound source slots consistently when `setMaxSources()` changes the pool.
- Existing tests in `C:\js-projects\slick2d-ts\test\sound-store-parity.test.mjs` cover the repaired sound-source and failed-play behavior. They do not currently cover the new `Music` finding below.
- Verification run: `npm.cmd test` in `C:\js-projects\slick2d-ts` passed on 2026-08-02 with 16 passing tests and 0 failures. This confirms the current repaired suite passes, but it also confirms there is no existing `Music.play()` / `Music.loop()` default-volume test.

## Finding 1: `Music.play()` and `Music.loop()` default to the previous track volume instead of Java's default `1.0`

Severity: Medium for this game port, high for exact Slick2D API parity.

### Java Behavior

In Java Slick2D:

- `C:\java-projects\slick2d\Slick\src\org\newdawn\slick\Music.java:222-224`
  - `public void loop()` calls `loop(1.0f, 1.0f)`.
- `C:\java-projects\slick2d\Slick\src\org\newdawn\slick\Music.java:229-231`
  - `public void play()` calls `play(1.0f, 1.0f)`.
- `C:\java-projects\slick2d\Slick\src\org\newdawn\slick\Music.java:259-273`
  - `startMusic(float pitch, float volume, boolean loop)` clamps the supplied volume and then calls `setVolume(volume)`.

That means every no-argument Java `Music.play()` or no-argument Java `Music.loop()` resets the individual `Music` object's volume to full volume (`1.0`) before or as playback starts.

### Current TypeScript Behavior

In the current TypeScript port:

- `C:\js-projects\slick2d-ts\src\slick\Music.ts:113-119`
  - `public play(pitch: number = 1, volume: number = this.volume): void`
- `C:\js-projects\slick2d-ts\src\slick\Music.ts:121-126`
  - `public loop(pitch: number = 1, volume: number = this.volume): void`
- `C:\js-projects\slick2d-ts\src\slick\Music.ts:215-225`
  - `start(...)` calls `this.setVolume(volume)`.

So the no-argument TS methods reuse the object's previous individual volume, not Java's hard-coded default volume of `1.0`.

### Why This Is Relevant to Ms. Pac-Man

The Java game uses no-argument `Music.play()` and `Music.loop()` in the exact desktop AppGameContainer path we are porting:

- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\IntroMode.java:52`
  - `main.introMusic.play();`
- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Act1Mode.java:240-241`
  - `if (!main.actMusic[0].playing()) main.actMusic[0].play();`
- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Act2Mode.java:207-208`
  - `main.actMusic[1].play();`
- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Act3Mode.java:167-168`
  - `main.actMusic[2].play();`
- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Act6Mode.java:153-154`
  - `main.actMusic[0].play();`
- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Main.java:499-520`
  - `Main.playMusic(...)` and `Main.loopMusic(...)` also call no-argument `music.play()` and `music.loop()` after explicitly setting volume to `1f`.

The wrapper methods in `Main.playMusic(...)` and `Main.loopMusic(...)` reduce the immediate risk for those specific paths because they call `music.setVolume(1f)` before playback. However, the direct mode calls above rely on the Slick2D no-argument method semantics themselves. In Java, those calls are guaranteed to force the track's individual volume to `1.0`. In TS, they only preserve whatever volume that `Music` object already had.

This is not just an abstract library mismatch. The game has custom fade state that writes individual `Music` object volume:

- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Main.java:155-163`
  - `currentMusic.setVolume(musicVolume);`
- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Main.java:484-488`
  - `fadeMusic()` starts the manual fade.
- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\PlayingMode.java:224`
  - player death starts a music fade.
- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Act4Mode.java:101`
  - the training sequence fades music.
- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\EndingMode.java:253`
  - the ending sequence fades music.

If an exact TS game port ever replays a `Music` object after it has retained a faded individual volume, Java no-argument `play()`/`loop()` restores full volume and the current TS implementation does not. The visible/audible symptom would be a track restarting too quietly or silently after a previous fade or manual volume change.

Because the game uses these no-argument methods directly, the Slick2D TS methods need to match Java even if some current game paths happen to set volume before calling them.

### Required Repair

Update `C:\js-projects\slick2d-ts\src\slick\Music.ts` so the no-argument overload behavior is Java-equivalent:

- `play()` must call/start with `pitch = 1` and `volume = 1`.
- `loop()` must call/start with `pitch = 1` and `volume = 1`.
- Explicit overload calls must keep honoring the supplied volume:
  - `play(1, 0.25)` must start with individual volume `0.25`.
  - `loop(1, 0.25)` must start with individual volume `0.25`.

Do not change `Music.setVolume(...)` clamping behavior; it already matches Java's 0-to-1 bounds.

### Regression Tests to Add

Add a `Music` parity test. At minimum:

1. Create a `Music` instance using a test audio resource or a mocked browser audio environment.
2. Call `music.setVolume(0)`.
3. Call no-argument `music.play()`.
4. Assert `music.getVolume()` is `1`, matching Java `play() -> play(1.0f, 1.0f)`.
5. Repeat for no-argument `music.loop()`.
6. Assert explicit-volume overloads still preserve the explicit value:
   - `music.play(1, 0.25)` leaves `music.getVolume()` at `0.25`.
   - `music.loop(1, 0.25)` leaves `music.getVolume()` at `0.25`.

If the existing test harness cannot easily construct real `Music` playback, expose this through a small mock/stub around the Web Audio dependencies rather than weakening the assertion. The regression is about the public Java API contract, not actual audible output.

## Checked and Not Re-listed

These were audited again and are not being filed as new repair items:

- `Sound.play()` / `Sound.loop()` failed allocation now clears the active handle. Previous issue fixed.
- `SoundStore` effect source allocation now preserves Java's one-music-source plus unavailable-last-slot behavior. Previous issue fixed.
- Java `Sound.stop()` only stops the latest source index stored by `AudioImpl`; the current TS `Sound.active` model matches that latest-handle behavior. This matters for `Main.stopAllSoundEffects()` and is not a new bug.
- `GameContainer.setSoundOn(false)` is called before `start()` in `Main.java:811`; both Java and TS ignore pre-init sound toggles while `soundWorks` / `soundWorksFlag` is false. Not a new bug.
- `GameContainer.setMusicOn(false/true)` pause behavior maps to Java's `pauseLoop()` / `restartLoop()` role; the TS browser implementation suspends/resumes active music handles. Not a new game blocker.
- `ScalableGame2` target sizing, clipping, input scaling, and transform order still match the copied Java helper used by this game.
- `Color` fade construction for `Main.java:190` is okay for this game. The actual alpha values are `0,11,23,34,46,57,69,81,92,104,115,127,139,150,162,173,185,197,208,220,231,243,255`, so the current TS number normalization maps them to the same alpha fractions Java gets from the integer constructor.
- Keyboard constants used by `HumanInput.java` are present and mapped in `Input.ts`: arrows, WASD, IJKL, `2/4/6/8`, Enter, Space, Escape, and P.
- Packed sprite sheet loading/parsing remains compatible with the game's `pack_1.def` and `pack_2.def` assets from the previous audit checks.

## Summary for the Repair AI

Only one new game-relevant Slick2D parity problem was found in this pass: fix `Music.play()` and `Music.loop()` so the no-argument forms default to volume `1`, not `this.volume`, and add tests that lock both no-argument and explicit-volume overload behavior.
