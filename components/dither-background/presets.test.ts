import { describe, expect, test } from 'vitest'
import { resolveConfig } from './config'
import { PRESETS, PRESET_NAMES } from './presets'

describe('presets', () => {
  test('every preset resolves to a valid full config', () => {
    for (const name of PRESET_NAMES) {
      expect(() => resolveConfig(PRESETS[name])).not.toThrow()
    }
  })

  test('five-ink looks are the majority', () => {
    const fiveInk = PRESET_NAMES.filter((name) => PRESETS[name].palette?.length === 5)
    expect(fiveInk.length).toBeGreaterThan(PRESET_NAMES.length / 2)
  })

  test('monochrome preserves the supplied configuration exactly', () => {
    expect(resolveConfig(PRESETS.monochrome)).toMatchObject({
      palette: ['#FAFAFA', '#BABABA', '#707070', '#333333', '#16181D'],
      bandCount: 5,
      cellSize: 2,
      ditherStrength: 0.68,
      ditherType: '8x8',
      cloudScale: 0.42,
      coverage: 0.72,
      crownDetail: 0.61,
      speed: 0.25,
      frame: 0,
      zoom: 1.12,
      offsetX: 0.1,
      offsetY: 0,
      pointerStrength: 0,
      pointerEase: 0.04,
      contrastLow: 0.24,
      contrastHigh: 0.96,
      grain: 0.02,
      grainMotion: 0,
      maxPixelCount: 6_250_000,
    })
  })
})
