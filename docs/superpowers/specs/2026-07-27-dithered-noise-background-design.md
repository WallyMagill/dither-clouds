# Dithered Noise Background — Design

**Date:** 2026-07-27
**Status:** Approved, pending implementation plan

## Goal

A fullscreen animated background: domain-warped fbm noise, quantized to a small
muted palette, rendered through a screen-space ordered-dither halftone grid.
Visual target is "posterized fluid noise with ordered halftone dithering and a
muted editorial-print palette" — organic folding cloud shapes broken into a fine
dot grid, like newsprint or risograph.

Ships as a Next.js playground app plus a self-contained, portable React
component that can be lifted into any other project.

## Reference analysis

The palette and grid pitch below were measured from the reference image, not
estimated. Method: convert to BMP via `sips`, parse pixels directly, build an
exact-color histogram per region. Because the image is dithered, nearly every
pixel *is* a palette stop, so a frequency histogram recovers the palette more
faithfully than averaging (averaging would invent midtones that aren't there).

Regions were sampled separately because the reference has a darkening overlay
behind its text block; a whole-image histogram is contaminated by that overlay
and reports spurious neutral grays (`#444444`, `#626262`, `#7F7F7F`).

### Findings

**The palette is a duotone with two chromatically distinct dark ends.**

| Region | Dominant | Character |
|---|---|---|
| Top-left, upper-mid, bottom-right (light) | `#B8B7AE` | R−B = +10, G above (R+B)/2 → warm olive cream |
| Top-right (dark) | `#03000A` | R−B = −7 → near-black **navy** |
| Bottom (dark) | `#010A0A` | R−B = −9, G above mean → dark **teal** |
| Anywhere | `#B2B67F` | ~0.00% share → gray-green is a rare **accent**, not a band |

Two consequences for the shader:

1. **Four stops, not five.** The gray-green reads as a distinct tone to the eye
   but occupies almost no area; it is dither product and accent, not an equal
   band.
2. **The ramp must shift hue, not just luma.** The light end is warm/olive and
   the dark end is cool/navy. A neutral luma ramp between two grays loses the
   printed quality that makes the reference work.

**Halftone pitch: 3px dominant, 4px secondary** (mean-luma crossing intervals
along horizontal scanlines, measured at y=0.05 and y=0.85 of an 811px-wide
image). Cell ≈ 0.4% of image width → roughly 4–6px on a typical viewport. The
grid is fine and dense, not chunky.

**Shipped default: `cellSize: 8`, in device pixels.** At the DPR-2 cap that is
4 CSS px, or ~0.33% of a 1200px viewport against the reference's ~0.37% — the
same rendered pitch. The number differs from the measurement above only because
the config is expressed in device pixels; see the note in `config.test.ts`.

### Second reference, and the palette revision

`docs/reference-clouds.png` was supplied after the first implementation, with
the note that the result read "too monochrome, too busy … like camouflage."
That critique was correct and its cause was in this document: the four-stop
palette above ends in two near-identical near-blacks (`#1A2121`, `#03000A`)
with no real midtone between cream and dark, so the halftone had almost no
tonal information to carry and the whole field collapsed toward greyscale.

The same per-region histogram method applied to the second reference gives:

| Region | Measured | Character |
|---|---|---|
| Paper / pale masses | `#B4B0A7` | R−B = +13 → warm |
| Deep void (upper right) | `#16181D` | R−B = −7 → **navy**, not black |
| Centre midtone | `#6D6B66` | R−B = +7 → warm gray |

Its exact-color histogram is otherwise dominated by pure `#000000` (30%) and
`#B4B0A7` (33%) with perfectly neutral, evenly-spaced greys between them —
those greys are compression artifacts between two inks, not palette stops. So
the second reference is literally a **duotone**, and the five tones in the
revised palette are a design decision, not a measurement.

### Palette (default)

```
stop 0  #DEDACA   warm cream               (design; light headroom above the measured paper)
stop 1  #B4B0A7   muted olive-gray         (MEASURED — the reference's paper)
stop 2  #6E7A76   desaturated blue-green   (design; carries hue across the midtones)
stop 3  #31454A   deep teal                (design)
stop 4  #16181D   near-black navy          (MEASURED — the reference's void)
```

Both endpoints are measured; the midtones are chosen. Interpolating a neutral
ramp between the measured endpoints would land back on the reference's
compression greys and read monochrome — the exact failure being corrected. The
invariant that matters is enforced by a test: every palette must shift cooler
from its light end to its dark end.

## Architecture

Raw **WebGL2**, no three.js. This is a single fullscreen fragment shader;
three.js costs ~600KB and interposes a scene graph between the caller and the
uniforms. Next.js 16 App Router + TypeScript + Tailwind v4 for the shell.

The portable unit is a directory:

```
components/dither-background/
  renderer.ts             framework-agnostic WebGL2 engine — compile, link,
                          uniform cache, DPR/resize, RAF loop, pointer easing.
                          Zero React imports.
  shader.ts               GLSL vertex + fragment source
  bayer.ts                recursive Bayer (ordered dither) matrix generation
  config.ts               DitherConfig type, DEFAULT_CONFIG, hex→vec3,
                          resolveConfig, palette resampling
  palettes.ts             named palettes
  viewport.ts             DPR/resize math, pointer normalization, easing —
                          zero React imports
  animation-gate.ts       pure visible/hidden/reduced-motion/paused ->
                          should-animate gate — zero React imports
  dither-background.tsx   thin React shell — canvas ref, lifecycle,
                          config → uniforms
  index.ts                public entry point; re-exports the React component
                          plus the engine surface
  engine.ts               React-free entry point — re-exports only the
                          modules above with zero React imports, so the
                          engine is importable from a non-React project
                          without dragging React into its module graph
```

`renderer.ts` knows nothing about React. That seam is what makes the component
liftable into a non-React project, and it keeps the WebGL lifecycle testable
without a DOM renderer.

The dev control panel lives **outside** this directory, in the playground app,
so the portable component never carries dev UI into a consumer's bundle.

Config changes push new uniform values. They never recompile the shader or
remount the canvas — retuning a slider must not restart the animation.

## Shader pipeline

Seven stages:

1. **Per-cell field snap, then aspect-corrected UV.** `gl_FragCoord` is snapped
   to the center of its `uCellSize` halftone cell — `(floor(fragCoord / cellSize)
   + 0.5) * cellSize` — *before* anything else touches it, so every term
   downstream (the noise field and the Bayer threshold alike) is evaluated once
   per cell rather than once per pixel. That is what makes every cell a single
   flat dot, the way real halftone print works; sampling per pixel instead would
   let the band comparison flip inside a cell, producing sub-cell detail with
   smooth edges instead of dots. UV is then aspect-corrected from that snapped
   coordinate so the field does not stretch on resize.
2. **3D simplex noise** (Ashima/Gustavson `snoise`) with **time on the z axis**.
   Scrolling a 2D field reads as sliding wallpaper; drifting through z reads as
   clouds forming and dissolving. This is the difference between "moving" and
   "fluid".
3. **fbm** — 4 octaves, lacunarity 2.0, gain 0.5. Big masses come from a low
   `noiseScale`; bumpy edges come from octave depth. Those are separate
   controls, and conflating them once cost a revision: cutting octaves to fight
   a "camouflage" reading caused by a high `noiseScale` also removed the
   fractal detail that makes a cloud edge look like cauliflower.
4. **Domain warp**, driven by smooth fbm, sliding the masses around. The eased
   pointer vector is injected into the warp offset rather than the base
   coordinate, so the cloud edges bend near the cursor instead of the whole sky
   translating. The warp is deliberately *not* driven by billow — distorting
   with billow folds the distortion itself and creases the lobes.
5. **Cloud construction — two decks and a scalloped boundary.** This is where
   the shape stops being fluid and starts being cloud, and each half is
   load-bearing:
   - Two fbm decks at different scales are combined with a **smooth** max
     (`smax`, blend width 0.12), so the nearer deck occludes the farther one and
     the sky gains depth. A plain `max()` is only C0 continuous: along the curve
     where the decks cross it leaves a crease, and the warp stretches those
     creases into thin tendrils that read as smoke. Averaging instead of
     max-ing dissolves both decks into uniform haze.
   - **Billow** (`abs(noise)`, normalised by the amplitude sum) is added to the
     boundary. `|noise|` is convex almost everywhere, so it pushes cloud edges
     outward into rounded cauliflower scallops, where ordinary fbm curves inward
     and outward equally and reads as flow. It must stay a *boundary
     perturbation*: driving the whole density from billow makes its
     zero-crossing creases the dominant structure and the warp pulls them into
     veins — tried, and visibly wrong. Frequency matters as much as amplitude;
     much above ~2× the base it adds wisps rather than scallops.
   - Density is then **inverted** so dense cloud takes the palette's cream end
     and open sky takes its navy end.
5. **Field-gain expansion, contrast remap, tone-headroom inset.** fbm's output is
   statistically far narrower than its nominal -1..1 range (RMS ≈ 0.11 at 4
   octaves / gain 0.5), so a constant `FIELD_GAIN` (1.05) expands it first —
   without this the field crowds into a narrow band around 0.5 and the palette
   bands never separate. `smoothstep(contrastLow, contrastHigh, …)` then remaps
   into confident islands of pure light and dark; without it the bands land in a
   narrow middle and read washed out. Because `smoothstep` saturates to exact
   0.0/1.0, a final `TONE_HEADROOM` (0.07) inset keeps a minimum dot density in
   the lightest and darkest regions instead of letting them go perfectly flat —
   real halftone print's lightest areas are paper plus sparse ink, never pure
   paper.
6. **Fused ordered dither + palette quantization.** These are one operation, not
   two sequential ones — scaled by `uBandCount`, the number of *active* palette
   stops (2–6, resolved by `resolveConfig`), **not** by `MAX_PALETTE_STOPS`
   (a fixed 6 — just the size of the `uPalette` uniform array, unrelated to how
   many of its entries are actually in play for a given render):

   ```glsl
   float v = value * float(uBandCount - 1);
   int   i = int(floor(v));
   float f = fract(v);
   vec3 color = f < bayer8(gl_FragCoord.xy / cellSize)
              ? uPalette[i]
              : uPalette[i + 1];
   ```

   Regions well inside a band come out solid. Regions near a boundary become a
   checkerboard of the two neighbouring stops, with dot density tracking exactly
   how close the value sits to the next stop. This single expression produces the
   entire newspaper-density effect — no separate posterize pass is needed.
7. **Screen-space grid.** The Bayer matrix is sampled from `gl_FragCoord`, sized
   in **device pixels**. The dot grid stays nailed to the glass while the clouds
   move behind it. This is the whole "printed on paper" illusion — sampling in UV
   space makes the dots swim with the noise and it immediately looks like a video
   filter rather than print.

Plus a low-amplitude grain pass, sampled per cell (not per pixel, or it would
speckle the inside of every dot), which sells the risograph feel and suppresses
banding in flat regions.

Default `cellSize`: 8 device px, per the measured pitch above.

## Playground and controls

`app/page.tsx` renders the background fullscreen with sample overlay content
(a headline, matching the reference's composition) so text legibility over the
field is verifiable at a glance.

A collapsible control panel, hidden by default and toggled with a keypress,
exposes: warp strength, noise scale, animation speed, band count (= number of
active palette stops rendered, 2–6 — the ramp is *resampled* across the whole
palette with both endpoints always pinned, so lowering the count coarsens the
gradient rather than truncating its dark end; see `resampleIndices` in
`config.ts`), cell size, dither strength (how far the Bayer threshold deviates
from 0.5 — at 0 the quantization is a hard posterize with no dot texture),
grain amount, contrast, and palette swatches. A "copy config"
button emits the current values as a props object, so a tuned look can be frozen
into `DEFAULT_CONFIG`.

## Performance and failure handling

This is a background. It must never be the reason a page janks.

- Fullscreen triangle via `gl_VertexID` — no vertex buffer.
- DPR capped at 2.
- `prefers-reduced-motion` → render a single frame, no RAF loop.
- RAF pauses on tab-hidden (`visibilitychange`) and when the canvas leaves the
  viewport (`IntersectionObserver`).
- WebGL2 unavailable, or shader compile/link failure → fall back to a CSS
  gradient built from the palette endpoints. Never throws, never renders blank.
- `webglcontextlost` → `preventDefault()`, reinitialize on
  `webglcontextrestored`.
- Shader compile errors log the driver info log with line-numbered source in dev.

## Testing

Unit tests (vitest) cover the pure TypeScript, the generated shader source, the
renderer lifecycle against a fake GL layer, and the portability contract:

- config merge and clamping of out-of-range values
- hex → vec3 conversion
- Bayer matrix generation
- palette validation (stop count matches the shader's `MAX_PALETTE_STOPS`)
- generated fragment/vertex shader source — uniform declarations, the embedded
  Bayer literal, `gl_FragCoord`-based sampling, the `FIELD_GAIN` and pointer
  falloff terms
- the animation gate (`shouldAnimate`) across every combination of
  visible/hidden/reduced-motion/paused
- viewport math — DPR capping, drawing-buffer sizing (including non-finite
  input), pointer normalization, easing
- the renderer lifecycle — compile/link/VAO failure, `webglcontextlost` /
  `webglcontextrestored`, resize, `setConfig` (including a rejected invalid
  update), `destroy` — driven against a hand-written fake WebGL2 context, no
  real browser or GPU involved
- engine portability — every engine file imports no React and no Next.js, so
  the "liftable into a non-React project" claim in the Architecture section
  above stays true rather than silently rotting

**There is no meaningful automated assertion for "does this look like the
reference."** Visual correctness is verified by rendering in a browser and
comparing against the reference by eye, then iterating on the panel. This is
stated plainly rather than dressed up as a passing test suite — a green run here
does not mean the background looks right.

## Known tuning risks

- **Warp strength** — the gap between "organic" and "melted" is narrow. Panel
  slider, expect a second pass.
- **Contrast remap window** — controls how much area is solid vs dithered. Too
  tight and the whole field becomes dot texture with no solid islands; too wide
  and the dithering disappears.

Band count was flagged as a risk before the reference analysis; measurement
resolved it to 4.

## Out of scope

- Scroll-driven animation
- Multiple simultaneous instances on one page
- Server-side/static rendering of the shader output
- Registry packaging for `dither-kit` (possible follow-up; the directory
  structure above does not preclude it)
