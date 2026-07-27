# Dithered Noise Background

A fullscreen animated WebGL2 background: drifting cumulus cloud masses,
quantized to a small muted palette and rendered through a screen-space
ordered-dither halftone grid — like an editorial screen print or risograph.

The sky is built as a PICTURE WITH DEPTH, not as one posterized noise field.
Six cloud banks are composited far-to-near with a painter's algorithm. Every
depth cue moves together: banks further back sit higher on screen, have smaller
features, drift slower, and blend further toward the sky colour. Break any one
and the stack flattens into texture.

Three details carry the whole effect:

- **Banks translate, they do not morph.** Each bank's sample coordinate is
  offset by `drift * t` and no time term ever reaches the noise itself. Putting
  time on the noise's z axis churns the field in place, which is exactly what
  reads as flowing liquid. Sampling a fixed field at a moving offset makes each
  bank a rigid body that crosses the frame keeping its shape.
- **Billow silhouettes.** `abs(noise)` is convex almost everywhere, so cloud
  crowns scallop into cauliflower lobes. Ordinary fbm curves inward and outward
  equally and reads as flow.
- **Bands of finite depth, not fills.** A bank that fills everything below its
  silhouette hides every bank behind it, and the stack collapses to one horizon
  line.

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
| `palette` | `['#DEDACA', '#B4B0A7', '#6E7A76', '#31454A', '#16181D']` | Palette stops, light to dark. At least 2 required. |
| `bandCount` | `5` | Number of active palette stops. Clamped to `2..min(MAX_PALETTE_STOPS, palette.length)`. |
| `cellSize` | `3` | Halftone cell edge length, in **device** pixels. |
| `ditherStrength` | `0.77` | How far the Bayer threshold deviates from 0.5. `0` = hard posterize with no dot texture. |
| `noiseScale` | `0.6` | Base frequency of the cloud field. Lower = fewer, larger masses. |
| `warpStrength` | `0` | Jitters the spacing of the silhouette lobes. Off by default — the shape reads better without it. |
| `warpDetail` | `0.55` | Billow detail on the cloud crown — this is what scallops edges into cauliflower lobes. At `0` they curve smoothly and read as fluid. |
| `speed` | `0.445` | Drift rate. Banks translate; nothing morphs in place. |
| `pointerStrength` | `0` | How far the pointer bends the cloud edges. Off by default. |
| `pointerEase` | `0.04` | Easing factor applied to pointer motion per frame, `(0..1]`. Floored at `0.001` — exactly `0` would freeze the pointer permanently. |
| `contrastLow` | `0.19` | Lower edge of the contrast remap window. |
| `contrastHigh` | `0.96` | Upper edge of the contrast remap window. |
| `grain` | `0.02` | Amplitude of the per-cell grain pass. |

`bandCount` below `palette.length` resamples the ramp rather than truncating
it — both endpoints are always pinned, so a lower band count coarsens the
gradient instead of dropping its dark end.

The contrast window is deliberately asymmetric about 0.5. Centring it spreads
every tone evenly across the canvas, which reads as static; biasing it leaves
broad pale areas as the default state and concentrates the darks into a few
voids, which is what gives the composition hierarchy and open space.

The palette's two endpoints are measured from `docs/reference-clouds.png` via a
per-region exact-color histogram: the paper reads `#B4B0A7` (warm, R−B = +13)
and the deep void reads `#16181D` (navy, R−B = −7 — not black). The midtones
between them are a design choice rather than a measurement; that reference is
literally a duotone, and its apparent greys are neutral compression artifacts
between two inks. Interpolating a neutral ramp between the endpoints lands back
on those greys and reads monochrome, so the midtones step through olive-gray and
desaturated blue-green to carry hue across the middle of the range.

## Using the engine without React

`components/dither-background/engine.ts` re-exports only the React-free
surface — `createRenderer`, config resolution, palettes, the animation gate,
and viewport math — with no React or Next.js import anywhere in its module
graph (enforced by `portability.test.ts`). Import from there, not from the
top-level `index.ts` (which re-exports the `'use client'` React component), to
lift the rendering engine into a non-React project:

```ts
import { createRenderer } from '@/components/dither-background/engine'

const renderer = createRenderer(canvasEl, { speed: 0.2 })
if (renderer) {
  renderer.start()
  // renderer.setConfig(...), renderer.resize(...), renderer.destroy(), ...
}
```

`createRenderer` takes a raw `DitherConfigInput` and resolves it internally, so
there's no need to call `resolveConfig` first. `createRenderer` returns
`null` — never throws — if WebGL2 is unavailable or the config is invalid;
that's the same fallback contract `<DitherBackground>` relies on.
`fallbackGradient` (exported from `index.ts`) builds the matching CSS gradient
string, for an SSR placeholder or a manual fallback — though note that
`index.ts` is the React barrel, so importing from it re-introduces the React
dependency this section exists to avoid.

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
