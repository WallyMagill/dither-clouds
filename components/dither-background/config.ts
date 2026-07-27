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
  palette: ['#C4C3B8', '#B8B7AE', '#1A2121', '#03000A', '#03000A', '#03000A'],
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
