/**
 * Palette stops are ordered light to dark. The ramp shifts hue along its
 * length (warm cream highlights to cool navy shadows) rather than running a
 * neutral luma ramp — that hue shift is what reads as printed ink rather than
 * as a greyscale gradient.
 *
 * Each preset is art-directed as a complete five-ink ramp. The first stop is
 * the brightest cloud crown; the final stop is open sky. That lets atmospheric
 * presets use a true sky color without changing the shader's density model.
 */
export const PALETTES = {
  /** Warm silver light breaking through blue-charcoal cloud. */
  silverLining: ['#EEE9DD', '#C9C5B9', '#858F8C', '#45585D', '#172026'],
  /** Dense neutral storm ink with a cold graphite belly. */
  stormFront: ['#DDDCD4', '#ADB1AB', '#707B7B', '#394A50', '#111A20'],
  /** Evening blue atmosphere without electric or synthetic saturation. */
  blueHour: ['#DCE5E3', '#A8B8B8', '#70888D', '#405A65', '#172A38'],
  /** Five neutral inks from cloud white through graphite to near-black. */
  monochrome: ['#FAFAFA', '#BABABA', '#707070', '#333333', '#16181D'],
  /** Sunlit cloud white through airy blue shadow into a clear cerulean sky. */
  daylight: ['#FFF8E8', '#DCE8E6', '#9EC5D5', '#4D98BC', '#1572A4'],
  /** Warm cloud light through apricot and rose into a muted violet sky. */
  sunset: ['#FFF1D2', '#F7C48B', '#D98A73', '#96556D', '#3F315E'],
} as const satisfies Record<string, string[]>

export type PaletteName = keyof typeof PALETTES

export const PALETTE_NAMES = Object.keys(PALETTES) as PaletteName[]
