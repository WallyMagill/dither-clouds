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
