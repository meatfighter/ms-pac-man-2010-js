# slick2d-ts Issue: Image Textures Are Not Context-Aware Across Renderer Restarts

## Summary

During the Ms. Pac-Man PWA restart path, the browser app destroys the active `AppGameContainer`, returns to an HTML menu, then starts a new `AppGameContainer` and a new WebGL canvas/context.

The game-side stale reference bug has been patched in this repo, but `slick2d-ts` still has an independent renderer safety issue: `WebGLTextureResource` stores one `WebGLTexture` without tracking which `WebGL2RenderingContext` created it. If an `Image` object survives a renderer/context restart and is drawn later, `ensureTexture(newGl)` returns a texture object from the old context instead of re-uploading the decoded source into the new context.

## Observed Symptom

After:

1. Start the game.
2. Play until sprites are visible.
3. Press the PWA hamburger menu.
4. Press Start again.

Ms. Pac-Man and ghost sprites can render using the wrong atlas content. They are logically `pack_1.png` sprites, but the displayed pixels look like `pack_2.png`.

## Why This Can Happen

Relevant files in `slick2d-ts`:

- `src/slick/rendering/WebGLTextureResource.ts`
- `src/slick/rendering/WebGLRenderer.ts`
- `src/slick/AppGameContainer.ts`
- `src/slick/Image.ts`

`AppGameContainer.destroy()` calls `Renderer.getBackend().dispose()`, which releases renderer-owned state and clears its own texture map. However, ordinary Slick `Image` instances own `WebGLTextureResource` objects outside that renderer-owned map.

`WebGLTextureResource` currently has:

```ts
private texture: WebGLTexture | null = null;
```

and:

```ts
public ensureTexture(gl: WebGL2RenderingContext): WebGLTexture | null {
    if (this.texture) {
        return this.texture;
    }
    ...
}
```

That means a texture created by canvas/context A can be returned while drawing with canvas/context B.

In WebGL, texture objects belong to their creating context. Binding a texture from a different context is invalid. Depending on browser behavior and the current renderer state, the bind can fail and leave a previous texture bound. In this game, `pack_2.png` is often drawn for UI/stage/symbol work, so failed binds for stale `pack_1.png` image resources can visually sample from `pack_2.png`.

## Suggested slick2d-ts Fix

Make `WebGLTextureResource` context-aware.

Recommended shape:

```ts
private texture: WebGLTexture | null = null;
private textureContext: WebGL2RenderingContext | null = null;
```

Then in `ensureTexture(gl)`:

```ts
if (this.texture && this.textureContext === gl && gl.isTexture(this.texture)) {
    return this.texture;
}

this.texture = null;
this.textureContext = null;

if (!this.source) {
    return null;
}

this.texture = gl.createTexture();
this.textureContext = gl;
...
```

In `dispose(gl)`:

```ts
if (gl && this.texture && this.textureContext === gl) {
    gl.deleteTexture(this.texture);
}
this.texture = null;
this.textureContext = null;
```

`WebGLRenderTarget.attachTexture()` should also record the context that owns the attached texture. That probably means changing:

```ts
attachTexture(texture: WebGLTexture, width: number, height: number): void
```

to include the `gl` context:

```ts
attachTexture(gl: WebGL2RenderingContext, texture: WebGLTexture, width: number, height: number): void
```

and updating `WebGLRenderTarget.ensure(gl)` accordingly.

## Additional Defensive Option

`WebGLRenderer.dispose()` could reset all transient renderer state, not just GL handles:

- `currentTarget = null`
- `transformStack = [identityMatrix3()]`
- `immediateVertices = []`
- `immediateType = 0`
- `currentTextureId = 0`

This is not the core atlas-swap bug, but it makes restart behavior less stateful.

## Test Recommendation

Add a browser test that:

1. Creates a renderer and canvas.
2. Loads two `Image` resources.
3. Draws image A.
4. Disposes the renderer.
5. Creates a new renderer/canvas.
6. Draws the same surviving `Image` object.
7. Pixel-checks that the result is image A, not a previously bound texture or blank output.

This should fail before context-aware texture ownership and pass after the fix.
