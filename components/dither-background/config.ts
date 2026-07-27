export const MAX_PALETTE_STOPS = 6

export type DitherConfig = {
  /** Palette stops, light to dark. At least 2 required. */
  palette: string[]
  /** Number of active palette stops. Clamped to 2..min(MAX_PALETTE_STOPS, palette.length). */
  bandCount: number
  /** Halftone cell edge length in device pixels. */
  cellSize: number
  /** How far the Bayer threshold deviates from 0.5. 0 = hard posterize. */
  ditherStrength: number
  /** Spatial frequency of the cloud field. LOWER = fewer, larger masses. */
  cloudScale: number
  /**
   * How much of the sky is cloud, 0..1. Sets how hard the gaps are bitten
   * through each bank: at 0 the banks dissolve entirely and only open sky is
   * left, at 1 they close into unbroken decks. The strongest compositional
   * control there is.
   */
  coverage: number
  /**
   * Billow detail on the cloud crowns. This is what scallops the silhouette
   * into rounded cauliflower lobes; at 0 the crowns curve smoothly and the
   * result reads as fluid rather than as cloud.
   */
  crownDetail: number
  /** Drift rate. Banks translate across the frame; nothing morphs in place. */
  speed: number
  /** How far the pointer bends the fold pattern. 0 disables pointer input. */
  pointerStrength: number
  /** Easing factor applied to pointer motion per frame, (0..1]. Floored at 0.001 rather than 0 — a factor of exactly 0 would freeze the pointer permanently. */
  pointerEase: number
  /** Lower edge of the contrast remap window. */
  contrastLow: number
  /** Upper edge of the contrast remap window. */
  contrastHigh: number
  /**
   * Amplitude of the grain pass, sampled once per halftone cell (not per
   * pixel) — per-pixel grain would speckle the inside of every dot and undo
   * the flat-cell halftone the shader otherwise produces.
   */
  grain: number
}

export type DitherConfigInput = Partial<DitherConfig>

export const DEFAULT_CONFIG: DitherConfig = {
  palette: ['#DEDACA', '#B4B0A7', '#6E7A76', '#31454A', '#16181D'],
  bandCount: 5,
  cellSize: 3,
  ditherStrength: 0.77,
  cloudScale: 0.6,
  // 0.72 reproduces the hole-cutting threshold this was hardcoded at before it
  // became a control.
  coverage: 0.72,
  crownDetail: 0.55,
  speed: 0.445,
  // Pointer interaction off by default; the drifting sky is better left alone.
  pointerStrength: 0,
  pointerEase: 0.04,
  contrastLow: 0.19,
  contrastHigh: 0.96,
  grain: 0.02,
}
// Frozen so the singleton a consumer imports and touches directly can't be
// mutated out from under every other caller. `resolveConfig` spreads this
// (and copies `palette` into a fresh array), so freezing here doesn't affect
// its output.
Object.freeze(DEFAULT_CONFIG.palette)
Object.freeze(DEFAULT_CONFIG)

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
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function atLeast(value: number, min: number): number {
  return Number.isFinite(value) ? Math.max(min, value) : min
}

export function resolveConfig(input: DitherConfigInput = {}): DitherConfig {
  const merged = { ...DEFAULT_CONFIG, ...input }

  // A single color cannot make a ramp, so that alone is fatal. Anything else
  // out of range clamps rather than throwing: this is a background, and the
  // spec requires it never throw and never render blank. Crashing a page over
  // bandCount: 5 on a 4-stop palette is the wrong failure mode.
  if (merged.palette.length < 2) {
    throw new Error(
      `Palette needs at least 2 stops, received ${merged.palette.length}.`,
    )
  }
  for (const stop of merged.palette) hexToVec3(stop)

  const maxBands = Math.min(MAX_PALETTE_STOPS, merged.palette.length)
  const bandCount = Math.round(clamp(merged.bandCount, 2, maxBands))
  const contrastLow = clamp(merged.contrastLow, 0, 1)
  const contrastHigh = Math.max(clamp(merged.contrastHigh, 0, 1), contrastLow + 0.001)

  return {
    ...merged,
    palette: [...merged.palette],
    bandCount,
    cellSize: atLeast(merged.cellSize, 1),
    ditherStrength: clamp(merged.ditherStrength, 0, 1),
    cloudScale: atLeast(merged.cloudScale, 0.01),
    coverage: clamp(merged.coverage, 0, 1),
    crownDetail: atLeast(merged.crownDetail, 0),
    speed: atLeast(merged.speed, 0),
    pointerStrength: atLeast(merged.pointerStrength, 0),
    pointerEase: clamp(merged.pointerEase, 0.001, 1),
    contrastLow,
    contrastHigh,
    grain: atLeast(merged.grain, 0),
  }
}

/**
 * Which palette indices an N-band render actually samples. Both endpoints are
 * pinned so lowering the band count coarsens the ramp instead of truncating its
 * dark end. Exported so UI can show exactly the stops that are rendering.
 */
export function resampleIndices(paletteLength: number, bandCount: number): number[] {
  const active = Math.max(1, Math.min(Math.trunc(bandCount) || 0, paletteLength))
  if (active === 1) return [0]
  return Array.from({ length: active }, (_, i) =>
    Math.round((i * (paletteLength - 1)) / (active - 1)),
  )
}

export function paletteToFloat32(palette: string[], bandCount: number): Float32Array {
  const out = new Float32Array(MAX_PALETTE_STOPS * 3)
  const indices = resampleIndices(palette.length, bandCount)

  // Palettes run light to dark, so taking the first N stops would drop the dark
  // end and wash the image out. Resample across the whole ramp instead, pinning
  // both endpoints — a lower band count should coarsen the ramp, not truncate it.
  let last: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < MAX_PALETTE_STOPS; i++) {
    if (i < indices.length) {
      last = hexToVec3(palette[indices[i]])
    }
    out[i * 3] = last[0]
    out[i * 3 + 1] = last[1]
    out[i * 3 + 2] = last[2]
  }
  return out
}
