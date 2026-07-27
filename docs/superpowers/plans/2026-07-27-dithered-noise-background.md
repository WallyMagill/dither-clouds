# Dithered Noise Background Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fullscreen animated background — domain-warped fbm noise quantized to a 4-stop muted palette through a screen-space ordered-dither halftone grid — shipped as a Next.js playground plus a portable, framework-agnostic React component.

**Architecture:** A single fullscreen fragment shader drawn on a 3-vertex triangle via raw WebGL2. The WebGL lifecycle lives in `renderer.ts` with zero React imports; `dither-background.tsx` is a thin shell that owns a canvas ref and pushes config into uniforms. Pure math (viewport sizing, pointer easing, Bayer generation, color conversion) is extracted into separate modules so it is unit-testable without a GL context.

**Tech Stack:** Next.js 16.2 (App Router), React 19.2, TypeScript, Tailwind CSS 4.3, Vitest 4.1, raw WebGL2 / GLSL ES 3.00. No three.js, no shader libraries.

## Global Constraints

- **No three.js, OGL, or any WebGL wrapper.** Raw `WebGL2RenderingContext` only.
- **`renderer.ts`, `viewport.ts`, `shader.ts`, `bayer.ts`, `config.ts`, `palettes.ts` must not import React.** Verified by a test in Task 7.
- **The Bayer matrix is sampled from `gl_FragCoord` in device pixels, never from UV.** Sampling in UV space makes the dot grid swim with the noise and destroys the printed-paper effect. This is the single most important visual constraint.
- **Config changes must not recompile the shader or remount the canvas.** Retuning a slider must never restart the animation.
- **Palette stop values, verbatim from the spec's measurement:** `#C4C3B8`, `#B8B7AE`, `#1A2121`, `#03000A`. Accent (non-default): `#B2B67F`.
- **Default `cellSize`: 4 device pixels.** Measured from the reference (3px dominant / 4px secondary pitch at 811px width).
- **Default band count: 4.**
- **`MAX_PALETTE_STOPS = 6`** — the GLSL uniform array is fixed at this size; band count 2–6 selects how many are active.
- **DPR capped at 2.**
- Node 24.18+, npm 11+.

---

### Task 1: Scaffold app and test harness

**Files:**
- Create: entire Next.js app skeleton at repo root
- Create: `vitest.config.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: a working `npm run dev` and `npm test`; path alias `@/*` → repo root

- [ ] **Step 1: Scaffold Next.js**

The repo already contains `.git/`, `docs/`, and `.gitignore`. `create-next-app` writes its own `.gitignore` and will refuse if it conflicts, so remove it first — it gets recreated.

```bash
rm -f .gitignore
npx create-next-app@16.2.12 . --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*" --turbopack --yes
```

- [ ] **Step 2: Verify the dev server boots**

```bash
npm run build
```

Expected: build succeeds. If it fails, stop and report — everything downstream depends on this.

- [ ] **Step 3: Add Vitest**

```bash
npm i -D vitest@4.1.10
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**'],
  },
})
```

- [ ] **Step 5: Add the test script**

In `package.json`, add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 6: Verify the harness runs**

Create `lib/harness.test.ts`:

```ts
import { expect, test } from 'vitest'

test('vitest harness works', () => {
  expect(1 + 1).toBe(2)
})
```

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 7: Delete the harness test and commit**

```bash
rm lib/harness.test.ts
git add -A
git commit -m "chore: scaffold Next.js app and vitest harness"
```

---

### Task 2: Color conversion and config

**Files:**
- Create: `components/dither-background/config.ts`
- Test: `components/dither-background/config.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `MAX_PALETTE_STOPS: 6`
  - `type DitherConfig` — all fields required (see Step 3)
  - `type DitherConfigInput = Partial<DitherConfig>`
  - `DEFAULT_CONFIG: DitherConfig`
  - `hexToVec3(hex: string): [number, number, number]` — throws `Error` on malformed input
  - `resolveConfig(input?: DitherConfigInput): DitherConfig` — merges over defaults and clamps
  - `paletteToFloat32(palette: string[], bandCount: number): Float32Array` — length `MAX_PALETTE_STOPS * 3`

- [ ] **Step 1: Write the failing tests**

Create `components/dither-background/config.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import {
  DEFAULT_CONFIG,
  MAX_PALETTE_STOPS,
  hexToVec3,
  paletteToFloat32,
  resolveConfig,
} from './config'

describe('hexToVec3', () => {
  test('converts 6-digit hex to normalized rgb', () => {
    expect(hexToVec3('#FFFFFF')).toEqual([1, 1, 1])
    expect(hexToVec3('#000000')).toEqual([0, 0, 0])
  })

  test('accepts hex without leading hash', () => {
    expect(hexToVec3('FFFFFF')).toEqual([1, 1, 1])
  })

  test('is case insensitive', () => {
    expect(hexToVec3('#b8b7ae')).toEqual(hexToVec3('#B8B7AE'))
  })

  test('converts the measured cream stop correctly', () => {
    const [r, g, b] = hexToVec3('#B8B7AE')
    expect(r).toBeCloseTo(184 / 255, 6)
    expect(g).toBeCloseTo(183 / 255, 6)
    expect(b).toBeCloseTo(174 / 255, 6)
  })

  test('throws on malformed input', () => {
    expect(() => hexToVec3('#FFF')).toThrow()
    expect(() => hexToVec3('#GGGGGG')).toThrow()
    expect(() => hexToVec3('')).toThrow()
  })
})

describe('resolveConfig', () => {
  test('returns defaults when given nothing', () => {
    expect(resolveConfig()).toEqual(DEFAULT_CONFIG)
  })

  test('overrides only the provided fields', () => {
    const c = resolveConfig({ speed: 0.5 })
    expect(c.speed).toBe(0.5)
    expect(c.noiseScale).toBe(DEFAULT_CONFIG.noiseScale)
  })

  test('clamps bandCount into 2..MAX_PALETTE_STOPS', () => {
    expect(resolveConfig({ bandCount: 0 }).bandCount).toBe(2)
    expect(resolveConfig({ bandCount: 99 }).bandCount).toBe(MAX_PALETTE_STOPS)
  })

  test('clamps ditherStrength into 0..1', () => {
    expect(resolveConfig({ ditherStrength: -5 }).ditherStrength).toBe(0)
    expect(resolveConfig({ ditherStrength: 5 }).ditherStrength).toBe(1)
  })

  test('clamps cellSize to at least 1', () => {
    expect(resolveConfig({ cellSize: 0 }).cellSize).toBe(1)
  })

  test('rejects a palette shorter than bandCount', () => {
    expect(() => resolveConfig({ palette: ['#000000'], bandCount: 4 })).toThrow()
  })

  test('defaults match the spec measurements', () => {
    expect(DEFAULT_CONFIG.bandCount).toBe(4)
    expect(DEFAULT_CONFIG.cellSize).toBe(4)
    expect(DEFAULT_CONFIG.palette.slice(0, 4)).toEqual([
      '#C4C3B8',
      '#B8B7AE',
      '#1A2121',
      '#03000A',
    ])
  })
})

describe('paletteToFloat32', () => {
  test('produces a fixed-length array regardless of band count', () => {
    const out = paletteToFloat32(['#FFFFFF', '#000000'], 2)
    expect(out.length).toBe(MAX_PALETTE_STOPS * 3)
  })

  test('packs rgb triples in order', () => {
    const out = paletteToFloat32(['#FFFFFF', '#000000'], 2)
    expect(Array.from(out.slice(0, 6))).toEqual([1, 1, 1, 0, 0, 0])
  })

  test('pads unused slots with the last active stop', () => {
    const out = paletteToFloat32(['#FFFFFF', '#000000'], 2)
    expect(Array.from(out.slice(6, 9))).toEqual([0, 0, 0])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run components/dither-background/config.test.ts`
Expected: FAIL — cannot resolve `./config`.

- [ ] **Step 3: Write the implementation**

Create `components/dither-background/config.ts`:

```ts
export const MAX_PALETTE_STOPS = 6

export type DitherConfig = {
  /** Palette stops, light to dark. Length must be >= bandCount. */
  palette: string[]
  /** Number of active palette stops, 2..MAX_PALETTE_STOPS. */
  bandCount: number
  /** Halftone cell edge length in device pixels. */
  cellSize: number
  /** How far the Bayer threshold deviates from 0.5. 0 = hard posterize. */
  ditherStrength: number
  /** Base frequency of the noise field. */
  noiseScale: number
  /** Strength of the first domain-warp level. */
  warpStrength: number
  /** Strength of the second domain-warp level. */
  warpDetail: number
  /** Animation rate along the noise z axis. */
  speed: number
  /** How far the pointer bends the fold pattern. 0 disables pointer input. */
  pointerStrength: number
  /** Easing factor applied to pointer motion per frame, 0..1. */
  pointerEase: number
  /** Lower edge of the contrast remap window. */
  contrastLow: number
  /** Upper edge of the contrast remap window. */
  contrastHigh: number
  /** Amplitude of the per-pixel grain pass. */
  grain: number
}

export type DitherConfigInput = Partial<DitherConfig>

export const DEFAULT_CONFIG: DitherConfig = {
  palette: ['#C4C3B8', '#B8B7AE', '#1A2121', '#03000A'],
  bandCount: 4,
  cellSize: 4,
  ditherStrength: 1,
  noiseScale: 2.2,
  warpStrength: 4,
  warpDetail: 4,
  speed: 0.08,
  pointerStrength: 0.6,
  pointerEase: 0.04,
  contrastLow: 0.32,
  contrastHigh: 0.68,
  grain: 0.02,
}

const HEX_RE = /^#?([0-9a-f]{6})$/i

export function hexToVec3(hex: string): [number, number, number] {
  const match = HEX_RE.exec(hex.trim())
  if (!match) {
    throw new Error(`Invalid hex color: ${JSON.stringify(hex)} (expected 6 digits, e.g. "#B8B7AE")`)
  }
  const n = parseInt(match[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function resolveConfig(input: DitherConfigInput = {}): DitherConfig {
  const merged = { ...DEFAULT_CONFIG, ...input }
  const bandCount = Math.round(clamp(merged.bandCount, 2, MAX_PALETTE_STOPS))

  if (merged.palette.length < bandCount) {
    throw new Error(
      `Palette has ${merged.palette.length} stop(s) but bandCount is ${bandCount}. ` +
        `Provide at least ${bandCount} stops.`,
    )
  }
  for (const stop of merged.palette) hexToVec3(stop)

  return {
    ...merged,
    bandCount,
    cellSize: Math.max(1, merged.cellSize),
    ditherStrength: clamp(merged.ditherStrength, 0, 1),
    noiseScale: Math.max(0.01, merged.noiseScale),
    warpStrength: Math.max(0, merged.warpStrength),
    warpDetail: Math.max(0, merged.warpDetail),
    speed: Math.max(0, merged.speed),
    pointerStrength: Math.max(0, merged.pointerStrength),
    pointerEase: clamp(merged.pointerEase, 0.001, 1),
    contrastLow: clamp(merged.contrastLow, 0, 1),
    contrastHigh: clamp(merged.contrastHigh, 0, 1),
    grain: Math.max(0, merged.grain),
  }
}

export function paletteToFloat32(palette: string[], bandCount: number): Float32Array {
  const out = new Float32Array(MAX_PALETTE_STOPS * 3)
  const active = Math.min(bandCount, palette.length)
  let last: [number, number, number] = [0, 0, 0]

  for (let i = 0; i < MAX_PALETTE_STOPS; i++) {
    if (i < active) last = hexToVec3(palette[i])
    out[i * 3] = last[0]
    out[i * 3 + 1] = last[1]
    out[i * 3 + 2] = last[2]
  }
  return out
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run components/dither-background/config.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add components/dither-background/config.ts components/dither-background/config.test.ts
git commit -m "feat: add dither config with clamping and hex conversion"
```

---

### Task 3: Palettes

**Files:**
- Create: `components/dither-background/palettes.ts`
- Test: `components/dither-background/palettes.test.ts`

**Interfaces:**
- Consumes: `MAX_PALETTE_STOPS`, `hexToVec3` from `./config`
- Produces: `PALETTES: Record<PaletteName, string[]>`, `type PaletteName`, `PALETTE_NAMES: PaletteName[]`

- [ ] **Step 1: Write the failing tests**

Create `components/dither-background/palettes.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { PALETTES, PALETTE_NAMES } from './palettes'
import { MAX_PALETTE_STOPS, hexToVec3, resolveConfig } from './config'

describe('palettes', () => {
  test('every palette has 2..MAX_PALETTE_STOPS stops', () => {
    for (const name of PALETTE_NAMES) {
      const stops = PALETTES[name]
      expect(stops.length).toBeGreaterThanOrEqual(2)
      expect(stops.length).toBeLessThanOrEqual(MAX_PALETTE_STOPS)
    }
  })

  test('every stop is valid hex', () => {
    for (const name of PALETTE_NAMES) {
      for (const stop of PALETTES[name]) {
        expect(() => hexToVec3(stop)).not.toThrow()
      }
    }
  })

  test('every palette is ordered light to dark by luma', () => {
    const luma = (hex: string) => {
      const [r, g, b] = hexToVec3(hex)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    for (const name of PALETTE_NAMES) {
      const lumas = PALETTES[name].map(luma)
      for (let i = 1; i < lumas.length; i++) {
        expect(lumas[i]).toBeLessThan(lumas[i - 1])
      }
    }
  })

  test('every palette resolves as a config without throwing', () => {
    for (const name of PALETTE_NAMES) {
      const stops = PALETTES[name]
      expect(() => resolveConfig({ palette: stops, bandCount: stops.length })).not.toThrow()
    }
  })

  test('editorial palette is the measured reference palette', () => {
    expect(PALETTES.editorial).toEqual(['#C4C3B8', '#B8B7AE', '#1A2121', '#03000A'])
  })

  test('PALETTE_NAMES covers every key in PALETTES', () => {
    expect([...PALETTE_NAMES].sort()).toEqual(Object.keys(PALETTES).sort())
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run components/dither-background/palettes.test.ts`
Expected: FAIL — cannot resolve `./palettes`.

- [ ] **Step 3: Write the implementation**

Create `components/dither-background/palettes.ts`:

```ts
/**
 * Palette stops are ordered light to dark. The ramp shifts hue along its
 * length (warm olive highlights to cool navy shadows) rather than running a
 * neutral luma ramp — that hue shift is what reads as printed ink rather than
 * as a greyscale gradient.
 *
 * `editorial` values were measured from the reference image via a per-region
 * exact-color histogram. See docs/superpowers/specs/2026-07-27-*.md.
 */
export const PALETTES = {
  /** The measured reference palette. */
  editorial: ['#C4C3B8', '#B8B7AE', '#1A2121', '#03000A'],
  /** Reference palette with the rare gray-green accent promoted to a band. */
  editorialAccent: ['#C4C3B8', '#B8B7AE', '#B2B67F', '#1A2121', '#03000A'],
  /** Two-stop duotone — maximum dot texture, minimum tonal information. */
  duotone: ['#B8B7AE', '#03000A'],
  /** Cooler, higher-contrast variant. */
  slate: ['#CDD2D4', '#8A9599', '#2E3A40', '#080D12'],
} as const satisfies Record<string, string[]>

export type PaletteName = keyof typeof PALETTES

export const PALETTE_NAMES = Object.keys(PALETTES) as PaletteName[]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run components/dither-background/palettes.test.ts`
Expected: PASS, 6 tests.

If the luma-ordering test fails on `slate`, adjust that palette's stops until strictly descending — do not weaken the test. Ordering is load-bearing: the shader maps field value 0→stop 0 and 1→stop N-1, so an out-of-order palette produces inverted bands.

- [ ] **Step 5: Commit**

```bash
git add components/dither-background/palettes.ts components/dither-background/palettes.test.ts
git commit -m "feat: add named palettes with luma ordering guarantee"
```

---

### Task 4: Bayer matrix generation

**Files:**
- Create: `components/dither-background/bayer.ts`
- Test: `components/dither-background/bayer.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `generateBayer(order: number): number[]` — returns `(2^order)^2` normalized thresholds in `[0, 1)`; `BAYER_8: number[]` (64 entries); `BAYER_SIZE = 8`

The matrix is generated in TypeScript and injected into the GLSL source as a
literal array at shader-assembly time (Task 5). It is not computed analytically
in GLSL — generating it here makes it real, load-bearing code rather than a
test-only mirror of shader logic.

- [ ] **Step 1: Write the failing tests**

Create `components/dither-background/bayer.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { BAYER_8, BAYER_SIZE, generateBayer } from './bayer'

describe('generateBayer', () => {
  test('order 1 produces the canonical 2x2 matrix', () => {
    // Unnormalized 2x2 is [[0,2],[3,1]]; normalized by (v + 0.5) / 4.
    expect(generateBayer(1)).toEqual([0.125, 0.625, 0.875, 0.375])
  })

  test('order n produces (2^n)^2 entries', () => {
    expect(generateBayer(1).length).toBe(4)
    expect(generateBayer(2).length).toBe(16)
    expect(generateBayer(3).length).toBe(64)
  })

  test('all values lie strictly inside 0..1', () => {
    for (const v of generateBayer(3)) {
      expect(v).toBeGreaterThan(0)
      expect(v).toBeLessThan(1)
    }
  })

  test('values are uniformly spaced with no duplicates', () => {
    const sorted = [...generateBayer(3)].sort((a, b) => a - b)
    expect(new Set(sorted).size).toBe(64)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i] - sorted[i - 1]).toBeCloseTo(1 / 64, 10)
    }
  })

  test('mean is 0.5 — the matrix does not bias the field lighter or darker', () => {
    const values = generateBayer(3)
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    expect(mean).toBeCloseTo(0.5, 10)
  })

  test('throws on order below 1', () => {
    expect(() => generateBayer(0)).toThrow()
  })
})

describe('BAYER_8', () => {
  test('is the order-3 matrix', () => {
    expect(BAYER_8).toEqual(generateBayer(3))
  })

  test('BAYER_SIZE matches its edge length', () => {
    expect(BAYER_SIZE * BAYER_SIZE).toBe(BAYER_8.length)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run components/dither-background/bayer.test.ts`
Expected: FAIL — cannot resolve `./bayer`.

- [ ] **Step 3: Write the implementation**

Create `components/dither-background/bayer.ts`:

```ts
/**
 * Recursive Bayer (ordered dither) matrix generation.
 *
 * M(1) = [[0, 2], [3, 1]]
 * M(n) is built from M(n-1) by scaling each entry by 4 and adding the M(1)
 * offset for the corresponding quadrant.
 *
 * Values are returned normalized to (0, 1) via (v + 0.5) / count, which centers
 * the thresholds so the matrix mean is exactly 0.5 — an unbiased matrix, so
 * dithering does not darken or lighten the field overall.
 */
export function generateBayer(order: number): number[] {
  if (!Number.isInteger(order) || order < 1) {
    throw new Error(`Bayer order must be an integer >= 1, received ${order}`)
  }

  let matrix = [
    [0, 2],
    [3, 1],
  ]

  for (let step = 1; step < order; step++) {
    const size = matrix.length
    const next: number[][] = Array.from({ length: size * 2 }, () => new Array(size * 2).fill(0))
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const base = matrix[y][x] * 4
        next[y][x] = base + 0
        next[y][x + size] = base + 2
        next[y + size][x] = base + 3
        next[y + size][x + size] = base + 1
      }
    }
    matrix = next
  }

  const flat = matrix.flat()
  const count = flat.length
  return flat.map((v) => (v + 0.5) / count)
}

export const BAYER_SIZE = 8
export const BAYER_8 = generateBayer(3)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run components/dither-background/bayer.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add components/dither-background/bayer.ts components/dither-background/bayer.test.ts
git commit -m "feat: add recursive Bayer matrix generation"
```

---

### Task 5: Shader source assembly

**Files:**
- Create: `components/dither-background/shader.ts`
- Test: `components/dither-background/shader.test.ts`

**Interfaces:**
- Consumes: `BAYER_8`, `BAYER_SIZE` from `./bayer`; `MAX_PALETTE_STOPS` from `./config`
- Produces: `VERTEX_SHADER: string`, `buildFragmentShader(octaves?: number): string`, `UNIFORM_NAMES: readonly string[]`

`UNIFORM_NAMES` is the contract Task 6 uses to build its uniform-location cache.
Every name in it must appear in the fragment source; Task 5's tests enforce that.

- [ ] **Step 1: Write the failing tests**

Create `components/dither-background/shader.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { UNIFORM_NAMES, VERTEX_SHADER, buildFragmentShader } from './shader'
import { BAYER_8, BAYER_SIZE } from './bayer'
import { MAX_PALETTE_STOPS } from './config'

const frag = buildFragmentShader()

describe('shader sources', () => {
  test('both declare GLSL ES 3.00 on the first line', () => {
    expect(VERTEX_SHADER.split('\n')[0].trim()).toBe('#version 300 es')
    expect(frag.split('\n')[0].trim()).toBe('#version 300 es')
  })

  test('no unresolved template placeholders remain', () => {
    expect(frag).not.toMatch(/\$\{/)
    expect(frag).not.toMatch(/\bTODO\b|\bTBD\b/)
    expect(VERTEX_SHADER).not.toMatch(/\$\{/)
  })

  test('vertex shader uses gl_VertexID and declares no attributes', () => {
    expect(VERTEX_SHADER).toContain('gl_VertexID')
    expect(VERTEX_SHADER).not.toMatch(/\bin\s+vec/)
  })
})

describe('fragment shader', () => {
  test('declares every uniform named in UNIFORM_NAMES', () => {
    for (const name of UNIFORM_NAMES) {
      expect(frag).toMatch(new RegExp(`uniform\\s+\\w+\\s+${name}\\b`))
    }
  })

  test('declares no uniform missing from UNIFORM_NAMES', () => {
    const declared = [...frag.matchAll(/uniform\s+\w+\s+(\w+)/g)].map((m) => m[1])
    expect([...declared].sort()).toEqual([...UNIFORM_NAMES].sort())
  })

  test('embeds the full Bayer matrix', () => {
    expect(frag).toContain(`float BAYER[${BAYER_8.length}]`)
    for (const v of BAYER_8) {
      expect(frag).toContain(v.toFixed(6))
    }
  })

  test('sizes the palette uniform to MAX_PALETTE_STOPS', () => {
    expect(frag).toMatch(new RegExp(`uniform\\s+vec3\\s+uPalette\\[${MAX_PALETTE_STOPS}\\]`))
  })

  test('embeds the Bayer edge length', () => {
    expect(frag).toContain(`${BAYER_SIZE}.0`)
  })

  test('samples the dither grid from gl_FragCoord, not from UV', () => {
    // The whole printed-paper illusion depends on this. If the threshold is
    // ever derived from uv, the dots swim with the noise.
    const line = frag.split('\n').find((l) => l.includes('bayer('))
    expect(line).toBeDefined()
    expect(frag).toMatch(/bayer\s*\(\s*gl_FragCoord\.xy/)
  })

  test('bayer() takes its coordinate in device pixels and divides by cell size', () => {
    expect(frag).toMatch(/mod\s*\(\s*fragCoord\s*\/\s*cell/)
  })

  test('octave count is compiled in as a loop bound', () => {
    expect(buildFragmentShader(4)).toContain('i < 4')
    expect(buildFragmentShader(6)).toContain('i < 6')
  })

  test('rejects a nonsensical octave count', () => {
    expect(() => buildFragmentShader(0)).toThrow()
    expect(() => buildFragmentShader(12)).toThrow()
  })

  test('has balanced braces', () => {
    const open = (frag.match(/\{/g) ?? []).length
    const close = (frag.match(/\}/g) ?? []).length
    expect(open).toBe(close)
  })

  test('writes to a declared output', () => {
    expect(frag).toMatch(/out\s+vec4\s+(\w+)/)
    const name = /out\s+vec4\s+(\w+)/.exec(frag)![1]
    expect(frag).toContain(`${name} =`)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run components/dither-background/shader.test.ts`
Expected: FAIL — cannot resolve `./shader`.

- [ ] **Step 3: Write the implementation**

Create `components/dither-background/shader.ts`:

```ts
import { BAYER_8, BAYER_SIZE } from './bayer'
import { MAX_PALETTE_STOPS } from './config'

export const UNIFORM_NAMES = [
  'uResolution',
  'uTime',
  'uPointer',
  'uPalette',
  'uBandCount',
  'uCellSize',
  'uDitherStrength',
  'uNoiseScale',
  'uWarpStrength',
  'uWarpDetail',
  'uPointerStrength',
  'uContrastLow',
  'uContrastHigh',
  'uGrain',
] as const

/**
 * Fullscreen triangle with no vertex buffer. Three vertices covering NDC
 * (-1,-1), (3,-1), (-1,3) — cheaper than a quad and avoids the diagonal seam
 * where two triangles meet.
 */
export const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`

export function buildFragmentShader(octaves = 4): string {
  if (!Number.isInteger(octaves) || octaves < 1 || octaves > 8) {
    throw new Error(`Octave count must be an integer in 1..8, received ${octaves}`)
  }

  const bayerLiteral = BAYER_8.map((v) => v.toFixed(6)).join(', ')

  return `#version 300 es
precision highp float;
// GLSL ES 3.00 fragment shaders default int to mediump. The Bayer index only
// needs 0..63, but declaring it removes a source of driver variance.
precision highp int;

out vec4 fragColor;

uniform vec2  uResolution;
uniform float uTime;
uniform vec2  uPointer;
uniform vec3  uPalette[${MAX_PALETTE_STOPS}];
uniform int   uBandCount;
uniform float uCellSize;
uniform float uDitherStrength;
uniform float uNoiseScale;
uniform float uWarpStrength;
uniform float uWarpDetail;
uniform float uPointerStrength;
uniform float uContrastLow;
uniform float uContrastHigh;
uniform float uGrain;

const float BAYER[${BAYER_8.length}] = float[${BAYER_8.length}](${bayerLiteral});

// ---------------------------------------------------------------------------
// Simplex noise (Ashima Arts / Stefan Gustavson, MIT). 3D so that time can be
// the z axis: drifting through z reads as clouds forming and dissolving, where
// scrolling a 2D field reads as sliding wallpaper.
// ---------------------------------------------------------------------------
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float fbm(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  for (int i = 0; i < ${octaves}; i++) {
    sum += amp * snoise(p * freq);
    freq *= 2.0;   // lacunarity
    amp  *= 0.5;   // gain
  }
  return sum;
}

// Two-level domain warp (Inigo Quilez construction): fbm feeding the
// coordinates of fbm feeding the coordinates of fbm. This is what produces
// curling, folding contours rather than round blobs.
//
// The pointer is injected into the SECOND warp offset only. Adding it to the
// base coordinate would translate the whole image; adding it here bends the
// fold pattern locally, which is the intended effect.
float warpedField(vec2 uv, float t) {
  vec3 p = vec3(uv * uNoiseScale, t);

  vec2 q = vec2(
    fbm(p),
    fbm(p + vec3(5.2, 1.3, 0.0))
  );

  vec2 pointerBend = uPointer * uPointerStrength;

  vec2 r = vec2(
    fbm(p + vec3(uWarpStrength * q + vec2(1.7, 9.2), 0.15 * t)),
    fbm(p + vec3(uWarpStrength * q + vec2(8.3, 2.8) + pointerBend, 0.126 * t))
  );

  return fbm(p + vec3(uWarpDetail * r, 0.0));
}

// The Bayer threshold is sampled in DEVICE PIXELS from gl_FragCoord and is
// deliberately independent of uv. That keeps the dot grid nailed to the glass
// while the field moves behind it, which is the entire printed-paper illusion.
// Sampling this in uv space makes the dots swim with the noise and it reads as
// a video filter instead.
float bayer(vec2 fragCoord, float cell) {
  vec2 c = floor(mod(fragCoord / cell, ${BAYER_SIZE}.0));
  int idx = int(c.y) * ${BAYER_SIZE} + int(c.x);
  return BAYER[idx];
}

float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  // Aspect-corrected, centered coordinates so the field does not stretch on
  // resize. Dividing both axes by the same scalar preserves circles.
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / max(uResolution.x, uResolution.y);

  float field = warpedField(uv, uTime);

  // fbm output is roughly -1..1; map to 0..1 then push contrast so the field
  // resolves into confident islands of light and dark rather than mush.
  float v = clamp(field * 0.5 + 0.5, 0.0, 1.0);
  v = smoothstep(uContrastLow, uContrastHigh, v);

  // Fused ordered dither + palette quantization. Regions well inside a band
  // come out solid; regions near a boundary become a checkerboard of the two
  // neighbouring stops whose dot density tracks how close the value sits to
  // the next stop. This single expression is the whole halftone effect — no
  // separate posterize pass is required.
  float scaled = v * float(uBandCount - 1);
  float lower = floor(scaled);
  float frac = scaled - lower;

  float threshold = 0.5 + (bayer(gl_FragCoord.xy, uCellSize) - 0.5) * uDitherStrength;

  int idx = int(lower) + (frac < threshold ? 0 : 1);
  idx = clamp(idx, 0, uBandCount - 1);

  vec3 color = uPalette[idx];

  // Low-amplitude grain: sells the risograph feel and suppresses banding in
  // flat regions. Offset by time so it shimmers rather than sitting static.
  float grain = hash12(gl_FragCoord.xy + fract(uTime) * 137.0) - 0.5;
  color += grain * uGrain;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run components/dither-background/shader.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add components/dither-background/shader.ts components/dither-background/shader.test.ts
git commit -m "feat: add domain-warped noise fragment shader with fused Bayer quantization"
```

---

### Task 6: Viewport and pointer math

**Files:**
- Create: `components/dither-background/viewport.ts`
- Test: `components/dither-background/viewport.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `MAX_DPR = 2`
  - `computeDrawingBufferSize(cssWidth, cssHeight, devicePixelRatio): { width: number; height: number }`
  - `easeToward(current: number, target: number, factor: number): number`
  - `normalizePointer(clientX, clientY, rect: { left: number; top: number; width: number; height: number }): [number, number]`

Extracted from `renderer.ts` so the arithmetic is testable in Node without a GL
context. `renderer.ts` (Task 7) contains only the parts that genuinely need
WebGL.

- [ ] **Step 1: Write the failing tests**

Create `components/dither-background/viewport.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { MAX_DPR, computeDrawingBufferSize, easeToward, normalizePointer } from './viewport'

describe('computeDrawingBufferSize', () => {
  test('multiplies css size by device pixel ratio', () => {
    expect(computeDrawingBufferSize(800, 600, 1)).toEqual({ width: 800, height: 600 })
    expect(computeDrawingBufferSize(800, 600, 2)).toEqual({ width: 1600, height: 1200 })
  })

  test('caps device pixel ratio at MAX_DPR', () => {
    expect(MAX_DPR).toBe(2)
    expect(computeDrawingBufferSize(800, 600, 3)).toEqual({ width: 1600, height: 1200 })
  })

  test('rounds to whole pixels', () => {
    expect(computeDrawingBufferSize(800.4, 600.6, 1)).toEqual({ width: 800, height: 601 })
  })

  test('never returns a zero dimension', () => {
    // A zero-sized drawing buffer is a GL error; a collapsed container must
    // still produce a valid (if tiny) framebuffer.
    expect(computeDrawingBufferSize(0, 0, 2)).toEqual({ width: 1, height: 1 })
  })

  test('treats a non-finite or absent dpr as 1', () => {
    expect(computeDrawingBufferSize(800, 600, Number.NaN)).toEqual({ width: 800, height: 600 })
    expect(computeDrawingBufferSize(800, 600, 0)).toEqual({ width: 800, height: 600 })
  })
})

describe('easeToward', () => {
  test('moves a fraction of the remaining distance', () => {
    expect(easeToward(0, 10, 0.5)).toBe(5)
    expect(easeToward(5, 10, 0.5)).toBe(7.5)
  })

  test('factor 1 snaps to target', () => {
    expect(easeToward(0, 10, 1)).toBe(10)
  })

  test('factor 0 does not move', () => {
    expect(easeToward(3, 10, 0)).toBe(3)
  })

  test('converges toward the target under repeated application', () => {
    let v = 0
    for (let i = 0; i < 500; i++) v = easeToward(v, 1, 0.04)
    expect(v).toBeCloseTo(1, 5)
  })

  test('is stable when already at target', () => {
    expect(easeToward(10, 10, 0.5)).toBe(10)
  })
})

describe('normalizePointer', () => {
  const rect = { left: 0, top: 0, width: 800, height: 400 }

  test('maps the center to the origin', () => {
    expect(normalizePointer(400, 200, rect)).toEqual([0, 0])
  })

  test('maps horizontal extremes to -1 and 1', () => {
    expect(normalizePointer(0, 200, rect)[0]).toBe(-1)
    expect(normalizePointer(800, 200, rect)[0]).toBe(1)
  })

  test('flips y so up is positive, matching gl_FragCoord', () => {
    expect(normalizePointer(400, 0, rect)[1]).toBe(1)
    expect(normalizePointer(400, 400, rect)[1]).toBe(-1)
  })

  test('accounts for a non-zero element offset', () => {
    const offset = { left: 100, top: 50, width: 800, height: 400 }
    expect(normalizePointer(500, 250, offset)).toEqual([0, 0])
  })

  test('does not divide by zero on a collapsed element', () => {
    const collapsed = { left: 0, top: 0, width: 0, height: 0 }
    const [x, y] = normalizePointer(0, 0, collapsed)
    expect(Number.isFinite(x)).toBe(true)
    expect(Number.isFinite(y)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run components/dither-background/viewport.test.ts`
Expected: FAIL — cannot resolve `./viewport`.

- [ ] **Step 3: Write the implementation**

Create `components/dither-background/viewport.ts`:

```ts
/** Rendering above 2x costs fill rate with no visible benefit at this dot pitch. */
export const MAX_DPR = 2

export function computeDrawingBufferSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): { width: number; height: number } {
  const dpr =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? Math.min(devicePixelRatio, MAX_DPR)
      : 1

  return {
    width: Math.max(1, Math.round(cssWidth * dpr)),
    height: Math.max(1, Math.round(cssHeight * dpr)),
  }
}

/** Frame-rate-naive exponential ease. Factor is the fraction of remaining distance covered per call. */
export function easeToward(current: number, target: number, factor: number): number {
  return current + (target - current) * factor
}

/**
 * Maps a client-space pointer position to -1..1 on both axes, y flipped so
 * positive is up — matching gl_FragCoord's origin-at-bottom-left convention,
 * so pointer motion in the shader agrees with what the user sees.
 */
export function normalizePointer(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): [number, number] {
  const width = rect.width || 1
  const height = rect.height || 1
  const x = ((clientX - rect.left) / width) * 2 - 1
  const y = -(((clientY - rect.top) / height) * 2 - 1)
  return [x, y]
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run components/dither-background/viewport.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add components/dither-background/viewport.ts components/dither-background/viewport.test.ts
git commit -m "feat: add viewport sizing and pointer normalization math"
```

---

### Task 7: WebGL2 renderer

**Files:**
- Create: `components/dither-background/renderer.ts`
- Test: `components/dither-background/renderer.test.ts`

**Interfaces:**
- Consumes: `VERTEX_SHADER`, `buildFragmentShader`, `UNIFORM_NAMES` from `./shader`; `resolveConfig`, `paletteToFloat32`, type `DitherConfig`/`DitherConfigInput` from `./config`; `computeDrawingBufferSize`, `easeToward`, `normalizePointer` from `./viewport`
- Produces:
  - `createRenderer(canvas: HTMLCanvasElement, input?: DitherConfigInput): DitherRenderer | null` — returns `null` if WebGL2 or shader compilation is unavailable
  - `type DitherRenderer = { setConfig(input: DitherConfigInput): void; start(): void; stop(): void; resize(cssWidth: number, cssHeight: number, dpr: number): void; setPointerTarget(x: number, y: number): void; renderOnce(): void; destroy(): void; readonly running: boolean }`
  - `compileShader(gl, type, source): WebGLShader | null`
  - `linkProgram(gl, vertexSource, fragmentSource): WebGLProgram | null`

Note on testing: the GL lifecycle is exercised against a hand-written fake
`WebGL2RenderingContext` that records calls. This verifies wiring — that
uniform locations are cached once, that `setConfig` does not relink, that
context loss is handled — but it does **not** verify that the shader produces
correct pixels. That is checked visually in Task 10.

- [ ] **Step 1: Write the failing tests**

Create `components/dither-background/renderer.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createRenderer } from './renderer'
import { UNIFORM_NAMES } from './shader'

/** Minimal recording fake of the subset of WebGL2 the renderer touches. */
function createFakeGl(options: { failCompile?: boolean; failLink?: boolean } = {}) {
  const calls: string[] = []
  const uniformLocations = new Map<string, object>()

  const gl = {
    calls,
    uniformLocations,
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    COMPILE_STATUS: 35713,
    LINK_STATUS: 35714,
    COLOR_BUFFER_BIT: 16384,
    TRIANGLES: 4,

    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => !options.failCompile),
    getShaderInfoLog: vi.fn(() => 'fake compile error'),
    deleteShader: vi.fn(),

    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(() => calls.push('linkProgram')),
    getProgramParameter: vi.fn(() => !options.failLink),
    getProgramInfoLog: vi.fn(() => 'fake link error'),
    deleteProgram: vi.fn(),
    useProgram: vi.fn(),

    createVertexArray: vi.fn(() => ({})),
    bindVertexArray: vi.fn(),
    deleteVertexArray: vi.fn(),

    getUniformLocation: vi.fn((_p: unknown, name: string) => {
      calls.push(`getUniformLocation:${name}`)
      if (!uniformLocations.has(name)) uniformLocations.set(name, { name })
      return uniformLocations.get(name)!
    }),

    uniform1f: vi.fn(),
    uniform1i: vi.fn(),
    uniform2f: vi.fn(),
    uniform3fv: vi.fn(),

    viewport: vi.fn((...args: number[]) => calls.push(`viewport:${args.join(',')}`)),
    clearColor: vi.fn(),
    clear: vi.fn(),
    drawArrays: vi.fn(() => calls.push('drawArrays')),
    getExtension: vi.fn(() => null),
  }
  return gl
}

function createFakeCanvas(gl: unknown) {
  const listeners = new Map<string, EventListener>()
  return {
    gl,
    listeners,
    width: 0,
    height: 0,
    getContext: vi.fn((kind: string) => (kind === 'webgl2' ? gl : null)),
    addEventListener: vi.fn((type: string, fn: EventListener) => listeners.set(type, fn)),
    removeEventListener: vi.fn((type: string) => listeners.delete(type)),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  } as unknown as HTMLCanvasElement & { gl: ReturnType<typeof createFakeGl>; listeners: Map<string, EventListener> }
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

describe('createRenderer', () => {
  test('returns null when webgl2 is unavailable', () => {
    const canvas = { getContext: () => null, addEventListener: vi.fn() } as unknown as HTMLCanvasElement
    expect(createRenderer(canvas)).toBeNull()
  })

  test('returns null when shader compilation fails', () => {
    const canvas = createFakeCanvas(createFakeGl({ failCompile: true }))
    expect(createRenderer(canvas)).toBeNull()
  })

  test('returns null when program linking fails', () => {
    const canvas = createFakeCanvas(createFakeGl({ failLink: true }))
    expect(createRenderer(canvas)).toBeNull()
  })

  test('caches a location for every uniform exactly once', () => {
    const canvas = createFakeCanvas(createFakeGl())
    createRenderer(canvas)
    const lookups = canvas.gl.calls.filter((c) => c.startsWith('getUniformLocation:'))
    expect(lookups.length).toBe(UNIFORM_NAMES.length)
    expect(new Set(lookups).size).toBe(UNIFORM_NAMES.length)
  })

  test('setConfig does not relink the program', () => {
    const canvas = createFakeCanvas(createFakeGl())
    const renderer = createRenderer(canvas)!
    const linksBefore = canvas.gl.calls.filter((c) => c === 'linkProgram').length

    renderer.setConfig({ speed: 0.5, bandCount: 6, cellSize: 9 })

    const linksAfter = canvas.gl.calls.filter((c) => c === 'linkProgram').length
    expect(linksAfter).toBe(linksBefore)
  })

  test('setConfig does not re-look-up uniform locations', () => {
    const canvas = createFakeCanvas(createFakeGl())
    const renderer = createRenderer(canvas)!
    const before = canvas.gl.calls.filter((c) => c.startsWith('getUniformLocation:')).length

    renderer.setConfig({ speed: 0.5 })

    const after = canvas.gl.calls.filter((c) => c.startsWith('getUniformLocation:')).length
    expect(after).toBe(before)
  })

  test('resize sets the drawing buffer and gl viewport with capped dpr', () => {
    const canvas = createFakeCanvas(createFakeGl())
    const renderer = createRenderer(canvas)!

    renderer.resize(800, 600, 3)

    expect(canvas.width).toBe(1600)
    expect(canvas.height).toBe(1200)
    expect(canvas.gl.calls).toContain('viewport:0,0,1600,1200')
  })

  test('renderOnce issues a draw call', () => {
    const canvas = createFakeCanvas(createFakeGl())
    const renderer = createRenderer(canvas)!
    renderer.renderOnce()
    expect(canvas.gl.calls).toContain('drawArrays')
    expect(canvas.gl.drawArrays).toHaveBeenCalledWith(canvas.gl.TRIANGLES, 0, 3)
  })

  test('start sets running and stop clears it', () => {
    const canvas = createFakeCanvas(createFakeGl())
    const renderer = createRenderer(canvas)!

    expect(renderer.running).toBe(false)
    renderer.start()
    expect(renderer.running).toBe(true)
    renderer.stop()
    expect(renderer.running).toBe(false)
  })

  test('start is idempotent — a second call schedules no extra frame', () => {
    const canvas = createFakeCanvas(createFakeGl())
    const renderer = createRenderer(canvas)!
    renderer.start()
    const count = (requestAnimationFrame as unknown as ReturnType<typeof vi.fn>).mock.calls.length
    renderer.start()
    expect(
      (requestAnimationFrame as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(count)
  })

  test('registers a webglcontextlost handler that prevents default', () => {
    const canvas = createFakeCanvas(createFakeGl())
    createRenderer(canvas)

    const handler = canvas.listeners.get('webglcontextlost')
    expect(handler).toBeDefined()

    const preventDefault = vi.fn()
    handler!({ preventDefault } as unknown as Event)
    expect(preventDefault).toHaveBeenCalled()
  })

  test('destroy stops the loop and releases GL objects', () => {
    const canvas = createFakeCanvas(createFakeGl())
    const renderer = createRenderer(canvas)!
    renderer.start()
    renderer.destroy()

    expect(renderer.running).toBe(false)
    expect(canvas.gl.deleteProgram).toHaveBeenCalled()
    expect(canvas.gl.deleteVertexArray).toHaveBeenCalled()
    expect(canvas.removeEventListener).toHaveBeenCalled()
  })

  test('renderOnce after destroy is a no-op rather than a crash', () => {
    const canvas = createFakeCanvas(createFakeGl())
    const renderer = createRenderer(canvas)!
    renderer.destroy()
    const before = canvas.gl.calls.filter((c) => c === 'drawArrays').length
    expect(() => renderer.renderOnce()).not.toThrow()
    expect(canvas.gl.calls.filter((c) => c === 'drawArrays').length).toBe(before)
  })

  test('an invalid config throws before touching GL state', () => {
    const canvas = createFakeCanvas(createFakeGl())
    const renderer = createRenderer(canvas)!
    expect(() => renderer.setConfig({ palette: ['#000000'], bandCount: 4 })).toThrow()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run components/dither-background/renderer.test.ts`
Expected: FAIL — cannot resolve `./renderer`.

- [ ] **Step 3: Write the implementation**

Create `components/dither-background/renderer.ts`:

```ts
import { type DitherConfig, type DitherConfigInput, paletteToFloat32, resolveConfig } from './config'
import { UNIFORM_NAMES, VERTEX_SHADER, buildFragmentShader } from './shader'
import { computeDrawingBufferSize, easeToward } from './viewport'

export { normalizePointer } from './viewport'

export type DitherRenderer = {
  setConfig(input: DitherConfigInput): void
  start(): void
  stop(): void
  resize(cssWidth: number, cssHeight: number, dpr: number): void
  setPointerTarget(x: number, y: number): void
  renderOnce(): void
  destroy(): void
  readonly running: boolean
}

/** Prefixes each source line with its number so driver error logs are actionable. */
function numberSource(source: string): string {
  return source
    .split('\n')
    .map((line, i) => `${String(i + 1).padStart(4, ' ')} | ${line}`)
    .join('\n')
}

export function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(
        `[dither-background] shader compile failed:\n${gl.getShaderInfoLog(shader)}\n\n${numberSource(source)}`,
      )
    }
    gl.deleteShader(shader)
    return null
  }
  return shader
}

export function linkProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram | null {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
  if (!vertex) return null

  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  if (!fragment) {
    gl.deleteShader(vertex)
    return null
  }

  const program = gl.createProgram()
  if (!program) {
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    return null
  }

  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)

  // Shaders are reference-counted by the program; detaching is unnecessary.
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[dither-background] program link failed: ${gl.getProgramInfoLog(program)}`)
    }
    gl.deleteProgram(program)
    return null
  }
  return program
}

export function createRenderer(
  canvas: HTMLCanvasElement,
  input: DitherConfigInput = {},
): DitherRenderer | null {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
  }) as WebGL2RenderingContext | null

  if (!gl) return null

  const program = linkProgram(gl, VERTEX_SHADER, buildFragmentShader())
  if (!program) return null

  // Cached once at construction. setConfig must never re-look-up locations —
  // that is the difference between a slider being free and a slider stalling
  // the pipeline.
  const locations = new Map<string, WebGLUniformLocation | null>()
  for (const name of UNIFORM_NAMES) {
    locations.set(name, gl.getUniformLocation(program, name))
  }
  const at = (name: string) => locations.get(name) ?? null

  // WebGL2 requires a bound VAO even when the shader reads no attributes.
  const vao = gl.createVertexArray()

  let config: DitherConfig = resolveConfig(input)
  let paletteBuffer = paletteToFloat32(config.palette, config.bandCount)

  let frame = 0
  let running = false
  let destroyed = false
  let contextLost = false

  let time = 0
  let lastTimestamp: number | null = null

  const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 }
  let width = 1
  let height = 1

  function pushStaticUniforms() {
    gl.useProgram(program)
    gl.uniform3fv(at('uPalette'), paletteBuffer)
    gl.uniform1i(at('uBandCount'), config.bandCount)
    gl.uniform1f(at('uCellSize'), config.cellSize)
    gl.uniform1f(at('uDitherStrength'), config.ditherStrength)
    gl.uniform1f(at('uNoiseScale'), config.noiseScale)
    gl.uniform1f(at('uWarpStrength'), config.warpStrength)
    gl.uniform1f(at('uWarpDetail'), config.warpDetail)
    gl.uniform1f(at('uPointerStrength'), config.pointerStrength)
    gl.uniform1f(at('uContrastLow'), config.contrastLow)
    gl.uniform1f(at('uContrastHigh'), config.contrastHigh)
    gl.uniform1f(at('uGrain'), config.grain)
  }

  function draw() {
    if (destroyed || contextLost) return

    gl.useProgram(program)
    gl.bindVertexArray(vao)

    gl.uniform2f(at('uResolution'), width, height)
    gl.uniform1f(at('uTime'), time)
    gl.uniform2f(at('uPointer'), pointer.x, pointer.y)

    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  function tick(timestamp: number) {
    if (!running || destroyed) return

    const deltaSeconds = lastTimestamp === null ? 0 : Math.min((timestamp - lastTimestamp) / 1000, 0.1)
    lastTimestamp = timestamp
    time += deltaSeconds * config.speed

    pointer.x = easeToward(pointer.x, pointer.targetX, config.pointerEase)
    pointer.y = easeToward(pointer.y, pointer.targetY, config.pointerEase)

    draw()
    frame = requestAnimationFrame(tick)
  }

  function handleContextLost(event: Event) {
    event.preventDefault()
    contextLost = true
    running = false
    cancelAnimationFrame(frame)
  }

  function handleContextRestored() {
    contextLost = false
    pushStaticUniforms()
    if (!destroyed) renderer.start()
  }

  canvas.addEventListener('webglcontextlost', handleContextLost)
  canvas.addEventListener('webglcontextrestored', handleContextRestored)

  gl.clearColor(0, 0, 0, 1)
  pushStaticUniforms()

  const renderer: DitherRenderer = {
    get running() {
      return running
    },

    setConfig(next: DitherConfigInput) {
      // resolveConfig validates first, so an invalid palette throws without
      // leaving GL state half-updated.
      const resolved = resolveConfig({ ...config, ...next })
      config = resolved
      paletteBuffer = paletteToFloat32(config.palette, config.bandCount)
      pushStaticUniforms()
    },

    start() {
      if (running || destroyed || contextLost) return
      running = true
      lastTimestamp = null
      frame = requestAnimationFrame(tick)
    },

    stop() {
      running = false
      lastTimestamp = null
      cancelAnimationFrame(frame)
    },

    resize(cssWidth: number, cssHeight: number, dpr: number) {
      const size = computeDrawingBufferSize(cssWidth, cssHeight, dpr)
      width = size.width
      height = size.height
      canvas.width = size.width
      canvas.height = size.height
      gl.viewport(0, 0, size.width, size.height)
    },

    setPointerTarget(x: number, y: number) {
      pointer.targetX = x
      pointer.targetY = y
    },

    renderOnce() {
      draw()
    },

    destroy() {
      renderer.stop()
      destroyed = true
      canvas.removeEventListener('webglcontextlost', handleContextLost)
      canvas.removeEventListener('webglcontextrestored', handleContextRestored)
      gl.deleteVertexArray(vao)
      gl.deleteProgram(program)
    },
  }

  return renderer
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run components/dither-background/renderer.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Add the no-React-imports guard**

Create `components/dither-background/portability.test.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const DIR = join(process.cwd(), 'components/dither-background')

// The engine must stay liftable into a non-React project. If one of these
// files ever imports React, the portability claim quietly becomes false.
const ENGINE_FILES = ['bayer.ts', 'config.ts', 'palettes.ts', 'renderer.ts', 'shader.ts', 'viewport.ts']

describe('engine portability', () => {
  test('the engine file list matches what is on disk', () => {
    const onDisk = readdirSync(DIR)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .sort()
    expect(onDisk).toEqual([...ENGINE_FILES].sort())
  })

  test.each(ENGINE_FILES)('%s does not import react', (file) => {
    const source = readFileSync(join(DIR, file), 'utf8')
    expect(source).not.toMatch(/from\s+['"]react/)
    expect(source).not.toMatch(/require\(['"]react/)
  })

  test.each(ENGINE_FILES)('%s does not import next', (file) => {
    const source = readFileSync(join(DIR, file), 'utf8')
    expect(source).not.toMatch(/from\s+['"]next/)
  })
})
```

Run: `npx vitest run components/dither-background/portability.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/dither-background/renderer.ts components/dither-background/renderer.test.ts components/dither-background/portability.test.ts
git commit -m "feat: add WebGL2 renderer with cached uniforms and context-loss handling"
```

---

### Task 8: React component and fallback

**Files:**
- Create: `components/dither-background/dither-background.tsx`
- Create: `components/dither-background/index.ts`

**Interfaces:**
- Consumes: `createRenderer`, type `DitherRenderer` from `./renderer`; `normalizePointer` from `./viewport`; `DEFAULT_CONFIG`, type `DitherConfigInput` from `./config`
- Produces: `DitherBackground` (default and named export), `type DitherBackgroundProps`; `index.ts` re-exports the public surface

This task has no unit tests — it is DOM lifecycle and browser APIs
(`ResizeObserver`, `IntersectionObserver`, `matchMedia`) whose value is entirely
in real-browser behavior. Testing it against jsdom fakes would assert that the
mocks were called, not that the background works. It is verified in Task 10.

- [ ] **Step 1: Write the component**

Create `components/dither-background/dither-background.tsx`:

```tsx
'use client'

import { useEffect, useRef } from 'react'
import { type DitherConfigInput, DEFAULT_CONFIG } from './config'
import { type DitherRenderer, createRenderer } from './renderer'
import { normalizePointer } from './viewport'

export type DitherBackgroundProps = {
  config?: DitherConfigInput
  className?: string
  /** Render a single frame and skip the animation loop. */
  paused?: boolean
}

/** Endpoint colors of the default palette, used for the no-WebGL fallback. */
function fallbackGradient(config?: DitherConfigInput): string {
  const palette = config?.palette ?? DEFAULT_CONFIG.palette
  const light = palette[0]
  const dark = palette[palette.length - 1]
  return `linear-gradient(160deg, ${light} 0%, ${dark} 100%)`
}

export function DitherBackground({ config, className, paused = false }: DitherBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<DitherRenderer | null>(null)

  // Config is read inside effects that must not re-run on every parent render.
  const configRef = useRef(config)
  configRef.current = config

  // Mount: create the renderer once. Config changes are pushed as uniforms by
  // the effect below, never by recreating the context.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const renderer = createRenderer(canvas, configRef.current)
    if (!renderer) return // fallback gradient on the wrapper stays visible
    rendererRef.current = renderer

    const parent = canvas.parentElement
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

    const sync = () => {
      const rect = (parent ?? canvas).getBoundingClientRect()
      renderer.resize(rect.width, rect.height, window.devicePixelRatio)
      renderer.renderOnce()
    }

    let visible = true
    const shouldAnimate = () =>
      visible && !document.hidden && !reduceMotion.matches && !paused

    const updateLoop = () => {
      if (shouldAnimate()) renderer.start()
      else {
        renderer.stop()
        renderer.renderOnce()
      }
    }

    sync()
    updateLoop()

    const resizeObserver = new ResizeObserver(() => {
      sync()
      if (!shouldAnimate()) renderer.renderOnce()
    })
    resizeObserver.observe(parent ?? canvas)

    // Stop burning GPU when scrolled out of view or on a hidden tab.
    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        visible = entries.some((entry) => entry.isIntersecting)
        updateLoop()
      },
      { threshold: 0 },
    )
    intersectionObserver.observe(canvas)

    const onVisibility = () => updateLoop()
    const onMotionChange = () => updateLoop()

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const [x, y] = normalizePointer(event.clientX, event.clientY, rect)
      renderer.setPointerTarget(x, y)
    }

    const onPointerLeave = () => renderer.setPointerTarget(0, 0)

    document.addEventListener('visibilitychange', onVisibility)
    reduceMotion.addEventListener('change', onMotionChange)
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerleave', onPointerLeave, { passive: true })

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      reduceMotion.removeEventListener('change', onMotionChange)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerleave', onPointerLeave)
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      renderer.destroy()
      rendererRef.current = null
    }
    // `paused` is read through shouldAnimate on each event; the dedicated
    // effect below handles changes to it without tearing down the context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Push config changes as uniforms. No relink, no remount, no restart.
  useEffect(() => {
    if (config) rendererRef.current?.setConfig(config)
  }, [config])

  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer) return
    if (paused) {
      renderer.stop()
      renderer.renderOnce()
    } else if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      renderer.start()
    }
  }, [paused])

  return (
    <div
      className={className}
      style={{ position: 'absolute', inset: 0, background: fallbackGradient(config) }}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
    </div>
  )
}

export default DitherBackground
```

- [ ] **Step 2: Create the public entry point**

Create `components/dither-background/index.ts`:

```ts
export { DitherBackground, default } from './dither-background'
export type { DitherBackgroundProps } from './dither-background'
export { DEFAULT_CONFIG, MAX_PALETTE_STOPS, resolveConfig } from './config'
export type { DitherConfig, DitherConfigInput } from './config'
export { PALETTES, PALETTE_NAMES } from './palettes'
export type { PaletteName } from './palettes'
export { createRenderer } from './renderer'
export type { DitherRenderer } from './renderer'
```

- [ ] **Step 3: Verify the whole suite and the build still pass**

```bash
npm test
npm run build
```

Expected: all tests pass; build succeeds. The portability test from Task 7 must
still pass — `dither-background.tsx` is `.tsx` and is correctly excluded from
the engine file list.

- [ ] **Step 4: Commit**

```bash
git add components/dither-background/dither-background.tsx components/dither-background/index.ts
git commit -m "feat: add React shell with reduced-motion, visibility and pointer wiring"
```

---

### Task 9: Playground page and control panel

**Files:**
- Create: `components/control-panel.tsx`
- Modify: `app/page.tsx` (replace the scaffolded content entirely)
- Modify: `app/layout.tsx` (metadata only)

**Interfaces:**
- Consumes: `DitherBackground`, `DEFAULT_CONFIG`, `PALETTES`, `PALETTE_NAMES`, types from `@/components/dither-background`
- Produces: `ControlPanel` component

The panel lives outside `components/dither-background/` so the portable
component never carries dev UI into a consumer's bundle.

- [ ] **Step 1: Write the control panel**

Create `components/control-panel.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import {
  type DitherConfig,
  type PaletteName,
  PALETTES,
  PALETTE_NAMES,
} from '@/components/dither-background'

type Slider = {
  key: keyof DitherConfig
  label: string
  min: number
  max: number
  step: number
}

const SLIDERS: Slider[] = [
  { key: 'bandCount', label: 'Bands', min: 2, max: 6, step: 1 },
  { key: 'cellSize', label: 'Cell size (px)', min: 1, max: 16, step: 1 },
  { key: 'ditherStrength', label: 'Dither strength', min: 0, max: 1, step: 0.01 },
  { key: 'noiseScale', label: 'Noise scale', min: 0.2, max: 8, step: 0.1 },
  { key: 'warpStrength', label: 'Warp strength', min: 0, max: 12, step: 0.1 },
  { key: 'warpDetail', label: 'Warp detail', min: 0, max: 12, step: 0.1 },
  { key: 'speed', label: 'Speed', min: 0, max: 0.6, step: 0.005 },
  { key: 'pointerStrength', label: 'Pointer strength', min: 0, max: 3, step: 0.05 },
  { key: 'contrastLow', label: 'Contrast low', min: 0, max: 1, step: 0.01 },
  { key: 'contrastHigh', label: 'Contrast high', min: 0, max: 1, step: 0.01 },
  { key: 'grain', label: 'Grain', min: 0, max: 0.2, step: 0.005 },
]

export function ControlPanel({
  config,
  onChange,
}: {
  config: DitherConfig
  onChange: (next: Partial<DitherConfig>) => void
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  // Backtick toggles the panel — off by default so the page reads as a real
  // background, not a demo harness.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '`') {
        event.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function copyConfig() {
    await navigator.clipboard.writeText(JSON.stringify(config, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-50 rounded-full bg-black/60 px-3 py-1.5 font-mono text-xs text-white/70 backdrop-blur transition hover:text-white"
      >
        ` controls
      </button>
    )
  }

  return (
    <aside className="fixed bottom-4 right-4 z-50 max-h-[85vh] w-72 overflow-y-auto rounded-lg bg-black/75 p-4 font-mono text-xs text-white/90 backdrop-blur">
      <div className="mb-3 flex items-center justify-between">
        <span className="tracking-wide uppercase text-white/50">Controls</span>
        <button type="button" onClick={() => setOpen(false)} className="text-white/50 hover:text-white">
          close
        </button>
      </div>

      <label className="mb-3 block">
        <span className="mb-1 block text-white/50">Palette</span>
        <select
          value={PALETTE_NAMES.find((n) => PALETTES[n].join() === config.palette.join()) ?? ''}
          onChange={(e) => {
            const name = e.target.value as PaletteName
            const palette = [...PALETTES[name]]
            onChange({ palette, bandCount: Math.min(config.bandCount, palette.length) })
          }}
          className="w-full rounded bg-white/10 px-2 py-1"
        >
          <option value="">custom</option>
          {PALETTE_NAMES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>

      <div className="mb-3 flex gap-1">
        {config.palette.slice(0, config.bandCount).map((hex, i) => (
          <input
            key={i}
            type="color"
            value={hex}
            aria-label={`Palette stop ${i + 1}`}
            onChange={(e) => {
              const palette = [...config.palette]
              palette[i] = e.target.value.toUpperCase()
              onChange({ palette })
            }}
            className="h-7 w-full cursor-pointer rounded border border-white/20 bg-transparent"
          />
        ))}
      </div>

      {SLIDERS.map(({ key, label, min, max, step }) => (
        <label key={key} className="mb-2 block">
          <span className="flex justify-between text-white/50">
            {label}
            <span className="text-white/80">{Number(config[key]).toFixed(step < 1 ? 3 : 0)}</span>
          </span>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={Number(config[key])}
            onChange={(e) => onChange({ [key]: Number(e.target.value) } as Partial<DitherConfig>)}
            className="w-full accent-white/80"
          />
        </label>
      ))}

      <button
        type="button"
        onClick={copyConfig}
        className="mt-2 w-full rounded bg-white/15 py-1.5 transition hover:bg-white/25"
      >
        {copied ? 'copied' : 'copy config'}
      </button>
    </aside>
  )
}
```

- [ ] **Step 2: Write the playground page**

Replace `app/page.tsx` entirely:

```tsx
'use client'

import { useState } from 'react'
import { ControlPanel } from '@/components/control-panel'
import { DEFAULT_CONFIG, DitherBackground, type DitherConfig } from '@/components/dither-background'

export default function Home() {
  const [config, setConfig] = useState<DitherConfig>(DEFAULT_CONFIG)

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <DitherBackground config={config} />

      {/* Sample overlay content, composed like the reference, so legibility
          over the field is verifiable at a glance rather than assumed. */}
      <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center">
        <h1 className="text-6xl font-black tracking-tight text-white drop-shadow-lg sm:text-8xl">
          posterized
        </h1>
        <p className="mt-2 max-w-md text-lg font-semibold text-white/90 drop-shadow-md sm:text-xl">
          fluid noise with ordered halftone dithering
        </p>
      </div>

      <ControlPanel config={config} onChange={(next) => setConfig((c) => ({ ...c, ...next }))} />
    </main>
  )
}
```

- [ ] **Step 3: Set page metadata**

In `app/layout.tsx`, replace the exported `metadata` object:

```ts
export const metadata: Metadata = {
  title: 'Dithered Noise Background',
  description: 'Domain-warped noise posterized through an ordered halftone dither grid.',
}
```

- [ ] **Step 4: Verify build and lint pass**

```bash
npm run build
npm run lint
```

Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add app components/control-panel.tsx
git commit -m "feat: add playground page with live control panel"
```

---

### Task 10: Visual verification and tuning pass

**Files:**
- Modify: `components/dither-background/config.ts` (DEFAULT_CONFIG values only)

**Interfaces:**
- Consumes: everything above
- Produces: tuned `DEFAULT_CONFIG` constants

This is the task where the work is actually judged. Everything before this
proves the machinery is wired correctly; none of it proves the background looks
like the reference.

- [ ] **Step 1: Run the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Load the page in a browser and capture a screenshot**

Open `http://localhost:3000`. Confirm before anything else:

1. The field renders — not a flat color, not the fallback gradient.
2. The dot grid is **stationary** while the clouds move behind it. Watch a
   single dot for a few seconds. If the dots drift with the noise, the Bayer
   threshold is being sampled from UV rather than `gl_FragCoord` — fix that
   before tuning anything, because no amount of parameter adjustment
   compensates for it.
3. Moving the pointer bends the fold pattern locally rather than sliding the
   whole image.

- [ ] **Step 3: Compare against the reference**

Reference source image: `docs/reference.png` (copy it there from the spec's
source path if it still exists, so the comparison is reproducible later).

Compare specifically:
- **Dot pitch** — the reference measures 3–4px at 811px width. Adjust `cellSize`.
- **Ratio of solid area to dithered area** — the reference is roughly 38% solid
  light and 32% solid dark, with dithering concentrated in the transitions.
  Widen `contrastLow`/`contrastHigh` toward each other for more solid area,
  apart for more dot texture.
- **Blob scale** — the reference has a handful of large islands, not many small
  ones. Adjust `noiseScale`.
- **Fold character** — contours should curl and fold back on themselves. Too
  little `warpStrength` gives round blobs; too much gives melted smears.

- [ ] **Step 4: Tune via the panel, then freeze the values**

Press `` ` `` to open the panel. Adjust until it matches, click "copy config",
and paste the resulting numbers into `DEFAULT_CONFIG` in
`components/dither-background/config.ts`.

- [ ] **Step 5: Re-run the config test**

Changing `DEFAULT_CONFIG` will break the `defaults match the spec measurements`
test in `config.test.ts` if band count, cell size, or the palette changed.

- If **palette stops** changed: the test is correct to fail. Revert to the
  measured values — they came from the reference, and drifting off them means
  the palette is no longer the measured one.
- If **cellSize** or **bandCount** changed as a deliberate tuning outcome:
  update the test's expected values *and* the spec's "Palette (default)"
  section so the recorded measurement and the shipped default do not silently
  disagree.

```bash
npm test
```

Expected: all pass.

- [ ] **Step 6: Verify the degraded paths by hand**

- **Reduced motion:** enable it at the OS level (macOS: System Settings →
  Accessibility → Display → Reduce motion), reload. Expected: a single static
  frame, no animation, no CPU spin.
- **Background tab:** open the page, switch tabs for ~10s, switch back.
  Expected: animation resumes smoothly, no time jump.
- **No WebGL2 fallback:** in Chrome DevTools, temporarily rename `getContext`
  usage or disable WebGL via `chrome://flags`. Simpler and sufficient: in the
  console run `HTMLCanvasElement.prototype.getContext = () => null` before the
  component mounts (hard-reload with the override in a snippet), and confirm
  the gradient shows rather than a blank or crashed page.

- [ ] **Step 7: Commit**

```bash
git add components/dither-background/config.ts components/dither-background/config.test.ts docs
git commit -m "feat: tune default config against reference image"
```

---

## Self-Review Notes

Checked against the spec:

| Spec requirement | Task |
|---|---|
| Raw WebGL2, no three.js | Global constraints; Task 7 |
| Portable directory structure | Tasks 2–8; enforced by Task 7 Step 5 |
| `renderer.ts` framework-agnostic | Task 7 portability test |
| Aspect-corrected UV | Task 5 shader `main()` |
| 3D simplex, time on z | Task 5 `snoise` / `warpedField` |
| fbm 4 octaves, lacunarity 2, gain 0.5 | Task 5 `fbm` |
| Two-level domain warp, pointer in second offset | Task 5 `warpedField` |
| Contrast remap | Task 5 `smoothstep` |
| Fused dither + quantization | Task 5 `main()` |
| Screen-space grid in device px | Task 5 `bayer()`; tested Task 5; verified Task 10 Step 2 |
| Grain pass | Task 5 `hash12` |
| 4 stops, measured palette | Task 2 `DEFAULT_CONFIG`, Task 3 `PALETTES.editorial` |
| cellSize 4 default | Task 2 |
| Fullscreen triangle via gl_VertexID | Task 5 `VERTEX_SHADER` |
| DPR capped at 2 | Task 6 `MAX_DPR` |
| prefers-reduced-motion → single frame | Task 8; verified Task 10 Step 6 |
| Pause on hidden tab / off-screen | Task 8 |
| CSS gradient fallback | Task 8 `fallbackGradient`; verified Task 10 Step 6 |
| Context loss handled | Task 7; tested Task 7 |
| Line-numbered compile errors in dev | Task 7 `numberSource` |
| Unit tests: config merge, hex→vec3, Bayer, palette validation | Tasks 2, 3, 4 |
| Control panel with listed controls + copy config | Task 9 |
| Playground with overlay content | Task 9 |
| Config changes don't recompile/remount | Task 7 tests; Task 8 effect split |

Known gaps, stated rather than hidden:

- **No automated test asserts the background looks correct.** Task 10 is manual
  and is the only real check on visual output. A fully green `npm test` says
  nothing about whether this resembles the reference.
- **`dither-background.tsx` has no unit tests.** Its logic is browser API
  orchestration; jsdom tests would assert mocks were called, not that the
  component works. Verified in Task 10 instead.
- **The renderer tests use a fake GL context.** They verify call wiring, not
  that any pixel is correct. A shader that compiles and draws garbage passes
  every test in Task 7.
