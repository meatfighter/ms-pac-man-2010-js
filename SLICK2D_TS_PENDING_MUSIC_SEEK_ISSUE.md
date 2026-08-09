# slick2d-ts Pending Music Seek Issue

Date: 2026-08-08

## Summary

`slick2d-ts` can lose a `Music.setPosition()` call when it is made immediately after `Music.play()` or `Music.loop()`.

This affects the Ms. Pac-Man 2010 PWA save/restore path. The game saves the current music id and playback position before returning to the PWA menu. On Continue, the game restores the correct mode and calls `Music.loop()` or `Music.play()`, then calls `Music.setPosition(savedPosition)`. The music still restarts because the underlying `Music.start()` method begins playback asynchronously and captures the original `offset` argument, usually `0`.

## Relevant slick2d-ts Behavior

In `C:\js-projects\slick2d-ts\src\slick\Music.ts`, `Music.play()` and `Music.loop()` call private `start(...)`.

`start(...)` attaches asynchronous work to `readyPromise`:

```ts
void this.readyPromise.then(() => this.loadBuffer()).then((buffer) => {
    ...
    this.startSource(buffer, loop, offset);
});
```

If client code calls this sequence:

```ts
music.loop();
music.setPosition(12.5);
```

then `setPosition(12.5)` updates `positionOffset`, but the pending `startSource(...)` still uses the closed-over `offset` value from `loop()`, which is `0`. When the async callback runs, it starts the source at `0` and overwrites the intended restored position.

## Why This Matters For Ms. Pac-Man

The PWA restore code needs to resume music from the exact point saved when the user pressed the hamburger icon and later pressed Continue.

Enter pause/resume usually works because the same live `Music` instance is suspended and resumed. Returning to the PWA menu destroys the game/container and restores from serialized state, which exercises the `play/loop` followed by `setPosition` path.

## Second Related Issue

For looped music, `Music.getPosition()` returns total elapsed playback time:

```ts
return this.positionOffset + (context.currentTime - this.startedAt) * this.playbackRate;
```

For looping tracks this can exceed `buffer.duration`. Later `startSource(...)` clamps offsets to `buffer.duration`:

```ts
this.positionOffset = Math.max(0, Math.min(offset, buffer.duration));
source.start(0, this.positionOffset);
```

That means a saved looped position after one full loop can seek to the end of the buffer instead of the matching position within the current loop. The position for looped music should be normalized modulo `buffer.duration`.

## Suggested slick2d-ts Fix

Make pending starts respect the latest `positionOffset`.

One possible shape:

1. In `Music.start(...)`, set `this.positionOffset` from the requested `offset` immediately.
2. In the async ready/load callback, call `startSource(buffer, loop, this.normalizedPositionOffset(buffer, loop))` instead of using the closed-over `offset`.
3. In `Music.setPosition(...)`, keep updating `positionOffset` even if the source has not started yet, as it already does.
4. For looped music, normalize offsets with `position % buffer.duration` when a buffer is available.

The key requirement is that this sequence must start at 12.5 seconds, not 0:

```ts
music.loop();
music.setPosition(12.5);
```

And this sequence must resume at the equivalent point within the loop:

```ts
music.loop();
music.setPosition(buffer.duration + 3.0);
```

## Current Ms. Pac-Man Workaround

The Ms. Pac-Man PWA now keeps music globally off during restore, waits until the `Music` object is ready, seeks after the pending start has had a chance to settle, and only then re-enables music if the game is not paused.

That game-level workaround avoids the user-facing restart, but the lower-level `slick2d-ts` issue remains worth fixing for parity and for other ports.
