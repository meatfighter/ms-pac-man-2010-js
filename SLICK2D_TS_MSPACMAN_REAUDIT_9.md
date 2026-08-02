# Slick2D TypeScript Ms. Pac-Man Reaudit 9

Date: 2026-08-02

Scope: another targeted Slick2D Java-to-TypeScript parity audit after the claimed repairs for `SLICK2D_TS_MSPACMAN_REAUDIT_8.md`. This pass compared `C:\java-projects\slick2d\Slick\src` against `C:\js-projects\slick2d-ts\src`, then checked whether any mismatch is relevant to the desktop browser port of `C:\NetBeansProjects\SlickMsPacMan`.

No Slick2D source code was changed in this pass. This file is the repair note for the next AI.

## Current Verification

- The prior `_8` finding appears repaired: `C:\js-projects\slick2d-ts\src\slick\Music.ts` now defaults `play()` and `loop()` to `volume = 1` at lines 117 and 125.
- A regression test now exists for that repair: `C:\js-projects\slick2d-ts\test\sound-store-parity.test.mjs:277`.
- `npm.cmd test` in `C:\js-projects\slick2d-ts` passed on 2026-08-02 with 18 passing tests and 0 failures.
- There is still no `FastTrig` test under `C:\js-projects\slick2d-ts\test`.

## Finding 1: `FastTrig` is not a parity implementation of Java Slick2D

Severity: medium for perfect-parity conversion. The visible differences are usually tiny, but this game directly uses `FastTrig` in repeated animation and position calculations. For the requested 1-to-1 port, the helper should be copied exactly instead of replaced with direct JavaScript trig calls.

Java Slick2D implementation:

- `C:\java-projects\slick2d\Slick\src\org\newdawn\slick\util\FastTrig.java:18-25` defines `reduceSinAngle(double radians)`.
- `FastTrig.java:37-43` implements `sin(double)` by reducing the angle, then using either `Math.sin(reduced)` or `Math.cos(Math.PI / 2 - reduced)`.
- `FastTrig.java:52-53` implements `cos(double)` as `sin(radians + Math.PI / 2)`.

Current TypeScript implementation:

- `C:\js-projects\slick2d-ts\src\slick\util\FastTrig.ts:12-13` returns `Math.sin(radians)` directly.
- `C:\js-projects\slick2d-ts\src\slick\util\FastTrig.ts:21-22` returns `Math.cos(radians)` directly.

This is not the same function mapping. Java Slick's `cos` is explicitly routed through the Java Slick `sin` implementation, not through `Math.cos`.

## Ms. Pac-Man Impact

The game uses `FastTrig` in these desktop-path classes:

- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Act1Mode.java:124`
- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\Act4Mode.java:113`
- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\EndingMode.java:179`
- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\FruitTarget.java:40`
- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\SelectWorldMode.java:92`
- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\SelectWorldMode.java:151`
- `C:\NetBeansProjects\SlickMsPacMan\src\mspacman\SelectWorldMode.java:152`

These values feed bobbing, fruit offsets, select-screen movement, and energizer positions. A direct `Math.sin`/`Math.cos` replacement will normally look close, but it is not exact. A quick reproduction of Java Slick's algorithm in Node showed non-zero deltas compared with direct JS trig; for example at `1000.01` radians the Java-style algorithm differs from direct `Math.sin` by about `2.1538326677728037e-14` and from direct `Math.cos` by about `-7.538414337204813e-14`.

That size of error is not likely to be a large visual defect by itself. The reason to fix it is stricter: the project goal is exact Java-to-TypeScript behavior mapping, and this is a copied Slick2D helper used by the game.

## Suggested Repair

Update `C:\js-projects\slick2d-ts\src\slick\util\FastTrig.ts` to port the Java Slick2D algorithm directly:

- Add the private/static equivalent of `reduceSinAngle`.
- Implement `sin(radians)` by reducing the angle first.
- Use the same branch condition: `Math.abs(radians) <= Math.PI / 4`.
- In the else branch, return `Math.cos(Math.PI / 2 - radians)`.
- Implement `cos(radians)` by returning `FastTrig.sin(radians + Math.PI / 2)`.

Add a test file or extend the existing suite with `FastTrig` parity tests. The tests should not compare to direct `Math.sin`/`Math.cos` as the expected behavior. Instead, mirror the Java Slick2D algorithm in the test expected values and include samples that exercise both branches and angle reduction, such as:

- `0`
- `0.1`
- `Math.PI / 3`
- `2.1`
- `3.14`
- `4.7`
- `12.345`
- `1000.01`
- `-2.1`
- `-1000.01`

Also include an explicit assertion that `FastTrig.cos(x)` matches the Java rule `FastTrig.sin(x + Math.PI / 2)`.

## Checked But Not Filed As New Repair Items

- `Music.play()` / `Music.loop()` no-argument volume behavior from `_8` is fixed and now tested.
- Sound effect source-pool behavior and double `soundVolume` application are still covered by passing tests.
- `ScalableGame2` target sizing, render transform order, clipping, and explicit `containerSizeChanged(...)` behavior still match the game-used Java helper closely enough for this port. There is a weak implementation smell because the TS class inherits `ScalableGame.update(...)`, which can recalculate scale repeatedly while letterboxed, but I did not file it as a repair item because it should not change this game's rendered frame or input coordinates.
- `Image.draw(x, y, scale, Color)` is still not a complete Slick2D overload mapping, but the Ms. Pac-Man desktop path does not call that overload directly. The game uses `Main.drawScaled(...)` and direct GL transform helpers instead.

## Bottom Line

Only one new game-relevant Slick2D parity repair was found in this pass: replace the simplified TypeScript `FastTrig` implementation with the Java Slick2D angle-reduction algorithm and add tests that lock the helper to Java Slick behavior.
