# Audio Mixing Audit - 2026-08-05

## Scope

Audited the browser PWA shell in `C:\js-projects\ms-pac-man-2010-js`, the converted Ms. Pac-Man game classes in `src\mspacman`, the Java original in `C:\NetBeansProjects\SlickMsPacMan`, the TypeScript Slick2D port in `C:\js-projects\slick2d-ts`, and the Java Slick2D source in `C:\java-projects\slick2d\Slick`.

The user-visible report was that pellet and other sound effects were audible but weak compared with music. The comparison point was `C:\js-projects\stickvania-js\AUDIO_MIXING_AUDIT_2026-08-05.md`.

## Project Audio Call Sites

Ms. Pac-Man game logic uses normal Slick sound and music APIs:

- Pellet collection calls `main.playSound(main.atePellotSound)` in both `src\mspacman\MsPacMan.ts` and `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\MsPacMan.java`.
- `Main.playSound(...)` calls `sound.play()` in both the TS port and Java original.
- Cutscene speech effects call `Sound.play()` directly, still using the normal Slick sound-effect path.
- No converted game code calls `Sound.play(pitch, volume)`, `Sound.loop(pitch, volume)`, `Sound.playAt(...)`, `SoundStore.playSound(...)`, `setSoundVolume(...)`, or `setMusicVolume(...)`.
- Music calls are no-argument `Music.play()` / `Music.loop()` or project methods that set per-track volume to `1`, matching Java.

Therefore all normal game sound effects share the same Slick global sound-volume path, and all normal music shares the Slick global music-volume path.

## Slick2D Sound-Effect Path

`C:\js-projects\slick2d-ts\src\slick\Sound.ts` mirrors Java Slick2D by multiplying the per-call sound volume by `SoundStore.get().getSoundVolume()` before delegating to `SoundStore.playSound(...)`.

`C:\js-projects\slick2d-ts\src\slick\openal\SoundStore.ts` then multiplies the incoming effect volume by `this.soundVolume` when assigning the WebAudio source gain.

Final normal effect gain:

```text
perSoundVolume * soundVolume * soundVolume
```

This matches Java Slick2D:

- `C:\java-projects\slick2d\Slick\src\org\newdawn\slick\Sound.java`
- `C:\java-projects\slick2d\Slick\src\org\newdawn\slick\openal\SoundStore.java`

This double application is parity behavior, not an upstream `slick2d-ts` defect.

## Slick2D Music Path

`C:\js-projects\slick2d-ts\src\slick\Music.ts` uses per-music gain for `Music.setVolume(...)`.

`C:\js-projects\slick2d-ts\src\slick\openal\SoundStore.ts` applies global music volume once through the music bus.

Final normal music gain:

```text
perMusicVolume * musicVolume
```

This also matches Java Slick2D's music path.

## Bug Found

The PWA shell previously treated the menu slider as a single scalar and passed that scalar directly to both Slick global volumes:

```ts
setMusicVolume(volume);
setSoundVolume(volume);
```

That is not a neutral master-volume mapping because the normal effect path applies `soundVolume` twice while the music path applies `musicVolume` once.

At the default menu volume of `80%`, the old mix was:

```text
music = 0.8
normal sound effect = 0.8 * 0.8 = 0.64
```

A live Chrome probe before the fix confirmed pellet playback at `gainLater = 0.6400000000000001` while `musicBusGain = 0.800000011920929`.

## Fix

Fixed in `src\app\main.ts` by keeping the menu slider as master volume, applying it directly to music, and applying its square root to Slick's global sound volume:

```ts
const musicVolume = volume;
const soundVolume = Math.sqrt(volume);
```

Then:

```ts
setMusicVolume(musicVolume);
setSoundVolume(soundVolume);
```

Expected final gains:

```text
music = masterVolume
normal sound effect = sqrt(masterVolume) * sqrt(masterVolume) = masterVolume
```

This is a project-shell adaptation for browser mixing. It does not alter converted Ms. Pac-Man classes and does not alter `slick2d-ts` parity behavior.

## Post-Fix Verification

After the fix, a live headless Chrome probe against the running PWA at default menu volume `80%` observed:

- `soundfx/ate_pellot.ogg` was requested `12` times in five seconds of forced gameplay.
- `SoundStore.getSoundVolume()` was `0.8944271909999159`.
- the first pellet call entered `SoundStore.playSound(...)` at `volume = 0.8944271909999159`.
- the first pellet source settled to `gainLater = 0.7999999999999999`.
- `SoundStore.getMusicVolume()` was `0.8`.
- the music bus gain was `0.800000011920929`.

That confirms the menu slider now behaves as a neutral master volume for normal music and sound-effect playback.

## slick2d-ts Follow-Up

No required `slick2d-ts` fix was found for this mixing problem.

One unrelated parity note remains: current `slick2d-ts` intentionally allows exact zero sound gain, while the Java Slick2D source floors zero sound-effect gain to `0.001f`. That is documented in `C:\js-projects\slick2d-ts\docs\SLICK2D-PARITY-API.md` as a deliberate browser mute behavior, and it is not related to the weak sound-effect mix at normal volume.
