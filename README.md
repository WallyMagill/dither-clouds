# Dithered Noise Background

A fullscreen animated WebGL2 background: domain-warped simplex noise,
quantized to a small muted palette, rendered through a screen-space
ordered-dither halftone grid. The result reads as posterized fluid noise —
organic folding cloud shapes broken into a fine dot grid, like newsprint or
risograph print.

It never throws and never leaves a blank canvas: if WebGL2 is unavailable, a
shader fails to compile/link, or the config turns out to be invalid, the
component falls back to a CSS gradient instead.

This repo is both a Next.js playground for tuning the effect and the source
of a portable component (`components/dither-background/`) meant to be lifted
into any other React — or non-React — project.

## Quick start

```bash
npm install
npm run dev
```

Open the app and press the **backtick** key (`` ` ``) to open the dev control
panel — sliders for every field below, palette swatches, and a "copy config"
button that emits the current values as a props object.

## Usage

```tsx
import { DitherBackground } from '@/components/dither-background'

<DitherBackground config={myConfig} className="absolute inset-0" />
```

Props:

| Prop | Type | Description |
|---|---|---|
| `config` | `DitherConfigInput` (optional) | Partial override of `DitherConfig`. Unset fields fall back to `DEFAULT_CONFIG`. |
| `className` | `string` (optional) | Applied to the absolutely-positioned wrapper div. |
| `paused` | `boolean` (optional, default `false`) | Stops the animation loop and renders a single static frame. |

**Hold `config` in state or memoize it.** Passing an inline object literal
(`config={{ speed: 0.2 }}`) gives it a new identity on every render, which
re-runs the uniform-push effect on every re-render — harmless correctness-wise,
but wasted work. Keep it in `useState`/`useMemo` instead, the way
`app/page.tsx` does.

## `DitherConfig` fields

All fields are optional in `config`; unset fields use the default shown.
See `components/dither-background/config.ts` for the full JSDoc.

| Field | Default | What it does |
|---|---|---|
| `palette` | `['#C4C3B8', '#B8B7AE', '#1A2121', '#03000A']` | Palette stops, light to dark. At least 2 required. |
| `bandCount` | `4` | Number of active palette stops. Clamped to `2..min(MAX_PALETTE_STOPS, palette.length)`. |
| `cellSize` | `8` | Halftone cell edge length, in **device** pixels. |
| `ditherStrength` | `1` | How far the Bayer threshold deviates from 0.5. `0` = hard posterize with no dot texture. |
| `noiseScale` | `1.5` | Base frequency of the noise field. |
| `warpStrength` | `0.85` | Strength of the first domain-warp level. |
| `warpDetail` | `0.9` | Strength of the second domain-warp level. |
| `speed` | `0.08` | Animation rate along the noise z axis. |
| `pointerStrength` | `0.6` | How far the pointer bends the fold pattern. `0` disables pointer input. |
| `pointerEase` | `0.04` | Easing factor applied to pointer motion per frame, `(0..1]`. Floored at `0.001` — exactly `0` would freeze the pointer permanently. |
| `contrastLow` | `0.29` | Lower edge of the contrast remap window. |
| `contrastHigh` | `0.71` | Upper edge of the contrast remap window. |
| `grain` | `0.02` | Amplitude of the per-cell grain pass. |

`bandCount` below `palette.length` resamples the ramp rather than truncating
it — both endpoints are always pinned, so a lower band count coarsens the
gradient instead of dropping its dark end.

The default palette values were measured from `docs/reference.png` (an exact-
color histogram per region, not an eyeballed guess — see the design spec in
`docs/superpowers/specs/`).

## Using the engine without React

`components/dither-background/engine.ts` re-exports only the React-free
surface — `createRenderer`, config resolution, palettes, the animation gate,
and viewport math — with no React or Next.js import anywhere in its module
graph (enforced by `portability.test.ts`). Import from there, not from the
top-level `index.ts` (which re-exports the `'use client'` React component), to
lift the rendering engine into a non-React project:

```ts
import { createRenderer, resolveConfig } from '@/components/dither-background/engine'

const renderer = createRenderer(canvasEl, resolveConfig({ speed: 0.2 }))
if (renderer) {
  renderer.start()
  // renderer.setConfig(...), renderer.resize(...), renderer.destroy(), ...
}
```

`createRenderer` returns `null` — never throws — if WebGL2 is unavailable or
the config is invalid; that's the same fallback contract `<DitherBackground>`
relies on. `fallbackGradient` (exported from `index.ts`) builds the matching
CSS gradient string, for an SSR placeholder or a manual fallback.

## Testing

```bash
npm test
```

Unit tests (vitest) cover every pure module in the engine — config resolution
and clamping, palette resampling, Bayer matrix generation, the animation gate,
viewport math, and generated shader source — plus a fake-GL suite that
exercises the WebGL2 renderer lifecycle (context loss/restore, resize,
teardown) without a browser, and a portability suite asserting the engine
stays free of React and Next.js imports.
