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

### Palette (default)

```
stop 0  #C4C3B8   light cream       (lifted from B8B7AE for highlight headroom)
stop 1  #B8B7AE   warm olive cream  (dominant light, measured)
stop 2  #1A2121   dark teal         (measured)
stop 3  #03000A   near-black navy   (measured)
```

`#B2B67F` is retained in `palettes.ts` as an optional accent variant, not a
default stop.

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
  config.ts               DitherConfig type, DEFAULT_CONFIG, hex→vec3
  palettes.ts             named palettes
  dither-background.tsx   thin React shell — canvas ref, lifecycle,
                          config → uniforms
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

1. **Aspect-corrected UV** so the field does not stretch on resize.
2. **3D simplex noise** (Ashima/Gustavson `snoise`) with **time on the z axis**.
   Scrolling a 2D field reads as sliding wallpaper; drifting through z reads as
   clouds forming and dissolving. This is the difference between "moving" and
   "fluid".
3. **fbm** — 4 octaves, lacunarity 2.0, gain 0.5.
4. **Two-level domain warp** (Iñigo Quilez construction): fbm feeding the
   coordinates of fbm feeding the coordinates of fbm. Produces curling, folding
   contours rather than round blobs. The eased pointer vector is injected into
   the **second** warp offset, so the fold pattern bends near the cursor instead
   of the whole image translating.
5. **Contrast remap** — smoothstep into a fuller range. The reference has
   confident islands of pure light and pure dark; without this the bands land in
   a narrow middle and read washed out.
6. **Fused ordered dither + palette quantization.** These are one operation, not
   two sequential ones:

   ```glsl
   float v = value * float(PALETTE_SIZE - 1);
   int   i = int(floor(v));
   float f = fract(v);
   vec3 color = f < bayer8(gl_FragCoord.xy / cellSize)
              ? palette[i]
              : palette[i + 1];
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

Plus a low-amplitude grain pass, which sells the risograph feel and suppresses
banding in flat regions.

Default `cellSize`: 4 device px, per the measured pitch above.

## Playground and controls

`app/page.tsx` renders the background fullscreen with sample overlay content
(a headline, matching the reference's composition) so text legibility over the
field is verifiable at a glance.

A collapsible control panel, hidden by default and toggled with a keypress,
exposes: warp strength, noise scale, animation speed, band count (= number of
active palette stops, 2–6; stops beyond the count are ignored), cell size,
dither strength (how far the Bayer threshold deviates from 0.5 — at 0 the
quantization is a hard posterize with no dot texture), grain amount, contrast,
and palette swatches. A "copy config"
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

Unit tests (vitest) cover the pure TypeScript only:

- config merge and clamping of out-of-range values
- hex → vec3 conversion
- Bayer matrix generation
- palette validation (stop count matches shader `PALETTE_SIZE`)

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
