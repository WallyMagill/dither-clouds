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

  test('monochrome pins the user-selected five-ink black-to-white ramp', () => {
    expect(PALETTES.monochrome).toEqual(['#FAFAFA', '#BABABA', '#707070', '#333333', '#16181D'])
  })

  test('atmospheric palettes shift cooler from their light end to their dark end', () => {
    // A neutral luma ramp reads as greyscale no matter how it is dithered, so
    // every palette must carry a hue shift. The invariant is the *shift*, not
    // absolute warmth — `slate` is deliberately cool throughout, so asserting
    // its light stop is warm would be asserting the wrong thing.
    for (const name of PALETTE_NAMES) {
      const stops = PALETTES[name]
      const [lr, , lb] = hexToVec3(stops[0])
      const [dr, , db] = hexToVec3(stops[stops.length - 1])
      expect(lr - lb, `${name} should shift cooler toward its dark end`).toBeGreaterThan(dr - db)
    }
  })

  test('five-ink palettes are the majority of the curated defaults', () => {
    const fiveInkCount = PALETTE_NAMES.filter((name) => PALETTES[name].length === 5).length
    expect(fiveInkCount).toBeGreaterThan(PALETTE_NAMES.length / 2)
  })

  test('PALETTE_NAMES covers every key in PALETTES', () => {
    expect([...PALETTE_NAMES].sort()).toEqual(Object.keys(PALETTES).sort())
  })
})
