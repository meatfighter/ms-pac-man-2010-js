# slick2d-ts Parity Note: Sound Effects Apply Global Volume Twice

## Summary

This file supersedes the earlier diagnosis that treated double application of global sound volume as a `slick2d-ts` bug.

After comparing against `C:\java-projects\slick2d\Slick`, the double application is Java Slick2D behavior and should be preserved for strict 1-to-1 parity.

## Java Behavior

Java `org.newdawn.slick.Sound` applies global sound volume before delegating to OpenAL:

- `Sound.play(float pitch, float volume)` calls `sound.playAsSoundEffect(pitch, volume * SoundStore.get().getSoundVolume(), false)`.
- `Sound.playAt(float pitch, float volume, float x, float y, float z)` does the same.
- `Sound.loop(float pitch, float volume)` does the same.

Java `org.newdawn.slick.openal.SoundStore` then applies global sound volume again when assigning the OpenAL source gain:

- `playAsSoundAt(...)` starts with `gain *= soundVolume`.
- if the result is `0`, Java raises it to `0.001f`.

So Java effective gain for `Sound.play(1, perCallVolume)` is:

```text
perCallVolume * soundVolume * soundVolume
```

## Required TypeScript Parity

The TypeScript port should keep the same split:

- `src/slick/Sound.ts` multiplies the per-call volume by `SoundStore.get().getSoundVolume()`.
- `src/slick/openal/SoundStore.ts` multiplies the incoming gain by `this.soundVolume` before assigning per-source gain.
- if gain is `0`, the TypeScript path should use the Java-style floor of `0.001`.
- `SoundStore.setSoundVolume()` should only store `soundVolume`; it should not update an already-created global sound bus if strict Java behavior is required.
- the WebAudio sound bus should initialize at gain `1`, because Java has no global sound-effect bus that automatically updates active sources.

## Ms. Pac-Man Observation

With the PWA menu volume slider at `80%`, Java-parity math makes `soundfx/ate_pellot.ogg` play at effective gain `0.64`.

Browser instrumentation confirmed that the game does request `soundfx/ate_pellot.ogg` repeatedly during pellet collection. If the pellet effect is considered too quiet in the web port, the parity-preserving options are outside `slick2d-ts`, for example default the PWA volume slider to `100%`, document that lower global sound volumes compound like Java Slick2D, or explicitly approve a web-only divergence.

## Runtime Verification After Restoring Parity

After restoring the Java-parity path and rebuilding `slick2d-ts`, a headless Chrome probe against the running PWA at menu volume `80%` observed:

- `soundfx/ate_pellot.ogg` was requested `12` times in five seconds of forced gameplay.
- `volume` entering `SoundStore.playSound()` was `0.8`.
- each source settled to gain `0.6400000000000001`.
- `SoundStore.getSoundVolume()` was `0.8`.
- the WebAudio sound bus gain stayed at `1`.

This matches Java's effective sound gain behavior: `1 * 0.8 * 0.8`.

## Additional Related Fix

The Ms. Pac-Man Java source also contains this method:

```ts
public stopSound(sound: Sound): void {
    this.blueGhostsSound.stop();
}
```

That odd-looking behavior is Java parity, not a TypeScript bug, because `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Main.java` has the same implementation.
