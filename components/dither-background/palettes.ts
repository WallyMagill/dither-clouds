/**
 * Palette stops are ordered light to dark. The ramp shifts hue along its
 * length (warm cream highlights to cool navy shadows) rather than running a
 * neutral luma ramp — that hue shift is what reads as printed ink rather than
 * as a greyscale gradient.
 *
 * Both endpoints of `editorial` are measured from docs/reference-clouds.png via
 * a per-region exact-color histogram: the paper reads #B4B0A7 (R−B = +13, warm)
 * and the deep void reads #16181D (R−B = −7, navy — not black). The midtones
 * between them are a design choice, not a measurement: that reference is
 * literally a duotone, and its apparent greys are neutral, evenly-spaced
 * compression artifacts between two inks rather than real stops. Interpolating
 * a neutral ramp between the endpoints would land back on those greys and read
 * monochrome, so the midtones step through olive-gray and desaturated
 * blue-green to carry hue across the middle of the range.
 */
export const PALETTES = {
  /** Warm cream → olive-gray → blue-green → deep teal → near-black navy. */
  editorial: ['#DEDACA', '#B4B0A7', '#6E7A76', '#31454A', '#16181D'],
  /** Cooler and greener through the midtones. */
  seafoam: ['#E2E0D2', '#AFB8A8', '#6B8580', '#2C4A4E', '#121C22'],
  /** Two-stop duotone — maximum dot texture, minimum tonal information. */
  duotone: ['#B4B0A7', '#16181D'],
  /** Neutral-cool variant with less warmth in the paper. */
  slate: ['#CDD2D4', '#8A9599', '#4A5A62', '#2E3A40', '#080D12'],
} as const satisfies Record<string, string[]>

export type PaletteName = keyof typeof PALETTES

export const PALETTE_NAMES = Object.keys(PALETTES) as PaletteName[]
