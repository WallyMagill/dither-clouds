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

  test('clamps bandCount into 2..palette length', () => {
    expect(resolveConfig({ bandCount: 0 }).bandCount).toBe(2)
    expect(resolveConfig({ bandCount: 99 }).bandCount).toBe(4)
  })

  test('clamps bandCount to MAX_PALETTE_STOPS even on a longer palette', () => {
    const long = ['#FFFFFF', '#EEEEEE', '#CCCCCC', '#999999', '#666666', '#333333', '#000000']
    expect(resolveConfig({ palette: long, bandCount: 7 }).bandCount).toBe(MAX_PALETTE_STOPS)
  })

  test('coerces NaN to finite in-range values instead of propagating it', () => {
    const c = resolveConfig({ bandCount: NaN, cellSize: NaN, speed: NaN })
    expect(Number.isFinite(c.bandCount)).toBe(true)
    expect(Number.isFinite(c.cellSize)).toBe(true)
    expect(Number.isFinite(c.speed)).toBe(true)
    expect(c.bandCount).toBeGreaterThanOrEqual(2)
    expect(c.cellSize).toBeGreaterThanOrEqual(1)
    expect(c.speed).toBeGreaterThanOrEqual(0)
  })

  test('does not alias DEFAULT_CONFIG.palette', () => {
    const c = resolveConfig()
    expect(c.palette).not.toBe(DEFAULT_CONFIG.palette)
    c.palette[0] = '#FF0000'
    expect(DEFAULT_CONFIG.palette[0]).toBe('#C4C3B8')
  })

  test('orders an inverted contrast window instead of accepting it', () => {
    const c = resolveConfig({ contrastLow: 0.9, contrastHigh: 0.1 })
    expect(c.contrastHigh).toBeGreaterThan(c.contrastLow)
  })

  test('clamps ditherStrength into 0..1', () => {
    expect(resolveConfig({ ditherStrength: -5 }).ditherStrength).toBe(0)
    expect(resolveConfig({ ditherStrength: 5 }).ditherStrength).toBe(1)
  })

  test('clamps cellSize to at least 1', () => {
    expect(resolveConfig({ cellSize: 0 }).cellSize).toBe(1)
  })

  test('clamps bandCount down to the palette length', () => {
    expect(resolveConfig({ palette: ['#FFFFFF', '#000000'], bandCount: 4 }).bandCount).toBe(2)
  })

  test('throws on a palette with fewer than 2 stops', () => {
    expect(() => resolveConfig({ palette: ['#000000'] })).toThrow()
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

  test('pads unused slots with the last ACTIVE stop, not the last in the array', () => {
    const out = paletteToFloat32(['#FFFFFF', '#000000', '#FF0000'], 2)
    expect(Array.from(out.slice(6, 9))).toEqual([0, 0, 0]) // black, not red
  })
})
