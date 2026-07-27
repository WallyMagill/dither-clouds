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
