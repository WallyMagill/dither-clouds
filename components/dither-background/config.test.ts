import { describe, expect, test } from 'vitest'
import {
  DEFAULT_CONFIG,
  MAX_PALETTE_STOPS,
  hexToVec3,
  paletteToFloat32,
  resampleIndices,
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
    expect(c.cloudScale).toBe(DEFAULT_CONFIG.cloudScale)
  })

  test('clamps bandCount into 2..palette length', () => {
    expect(resolveConfig({ bandCount: 0 }).bandCount).toBe(2)
    // The default palette has 5 stops, so 5 — not MAX_PALETTE_STOPS — is the ceiling.
    expect(resolveConfig({ bandCount: 99 }).bandCount).toBe(5)
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
    expect(DEFAULT_CONFIG.palette[0]).toBe('#EEE9DD')
  })

  test('orders an inverted contrast window instead of accepting it', () => {
    const c = resolveConfig({ contrastLow: 0.9, contrastHigh: 0.1 })
    expect(c.contrastHigh).toBeGreaterThan(c.contrastLow)
  })

  test('clamps coverage into 0..1', () => {
    expect(resolveConfig({ coverage: -1 }).coverage).toBe(0)
    expect(resolveConfig({ coverage: 5 }).coverage).toBe(1)
    expect(resolveConfig({ coverage: Number.NaN }).coverage).toBe(0)
  })

  test('clamps ditherStrength into 0..1', () => {
    expect(resolveConfig({ ditherStrength: -5 }).ditherStrength).toBe(0)
    expect(resolveConfig({ ditherStrength: 5 }).ditherStrength).toBe(1)
  })

  test('accepts only supported dither matrices', () => {
    expect(resolveConfig({ ditherType: '4x4' }).ditherType).toBe('4x4')
    expect(resolveConfig({ ditherType: '8x8' }).ditherType).toBe('8x8')
    expect(resolveConfig({ ditherType: 'other' as '8x8' }).ditherType).toBe('8x8')
  })

  test('clamps composition, grain motion, frame, and pixel budget safely', () => {
    const c = resolveConfig({ zoom: 0, offsetX: 2, offsetY: -2, grainMotion: 4, frame: -1, maxPixelCount: 0 })
    expect(c.zoom).toBe(0.01)
    expect(c.offsetX).toBe(1)
    expect(c.offsetY).toBe(-1)
    expect(c.grainMotion).toBe(1)
    expect(c.frame).toBe(0)
    expect(c.maxPixelCount).toBe(1)
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
    expect(DEFAULT_CONFIG.bandCount).toBe(5)
    // 3 DEVICE px. The reference's halftone is a fine screen; coarser cells
    // read as pixel art rather than print.
    expect(DEFAULT_CONFIG.cellSize).toBe(3)
    // The default is the art-directed Silver Lining five-ink preset.
    expect(DEFAULT_CONFIG.palette).toEqual([
      '#EEE9DD',
      '#C9C5B9',
      '#858F8C',
      '#45585D',
      '#172026',
    ])
  })

  test('the default palette runs warm at the light end and cool at the dark end', () => {
    // The hue shift along the ramp is what keeps this from reading as a
    // greyscale gradient — it is the property that made the previous
    // near-black-on-near-black palette look monochrome.
    const [lr, , lb] = hexToVec3(DEFAULT_CONFIG.palette[0])
    const [dr, , db] = hexToVec3(DEFAULT_CONFIG.palette[DEFAULT_CONFIG.palette.length - 1])
    expect(lr).toBeGreaterThan(lb) // warm: red above blue
    expect(dr).toBeLessThan(db) // cool: blue above red
  })
})

describe('DEFAULT_CONFIG', () => {
  // The exported singleton is what a consumer touches directly (unlike
  // resolveConfig's output, which is already copied). Frozen so one caller
  // mutating it can't corrupt every other caller sharing the module.
  test('is frozen: assigning a field throws', () => {
    expect(() => {
      DEFAULT_CONFIG.speed = 999
    }).toThrow()
  })

  test('is frozen: mutating its palette array throws', () => {
    expect(() => {
      DEFAULT_CONFIG.palette.push('#000000')
    }).toThrow()
  })
})

describe('resampleIndices', () => {
  test('resamples a 4-stop palette at bandCount 2 to the endpoints', () => {
    expect(resampleIndices(4, 2)).toEqual([0, 3])
  })

  test('is the identity mapping when bandCount equals palette length', () => {
    expect(resampleIndices(4, 4)).toEqual([0, 1, 2, 3])
  })

  test('resamples a 5-stop palette at bandCount 3 evenly', () => {
    expect(resampleIndices(5, 3)).toEqual([0, 2, 4])
  })

  test('returns just the first index when bandCount is 1', () => {
    expect(resampleIndices(4, 1)).toEqual([0])
  })

  test('a non-finite band count returns [0]', () => {
    expect(resampleIndices(4, Number.NaN)).toEqual([0])
  })

  test('first and last entries are always 0 and paletteLength - 1 for any bandCount >= 2', () => {
    for (let paletteLength = 2; paletteLength <= 7; paletteLength++) {
      for (let bandCount = 2; bandCount <= paletteLength; bandCount++) {
        const indices = resampleIndices(paletteLength, bandCount)
        expect(indices[0]).toBe(0)
        expect(indices[indices.length - 1]).toBe(paletteLength - 1)
      }
    }
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

  test('resamples across the full palette instead of truncating the dark end', () => {
    const out = paletteToFloat32(['#FFFFFF', '#CCCCCC', '#444444', '#000000'], 2)
    // Endpoints pinned: white and black, not white and light-grey.
    expect(Array.from(out.slice(0, 3))).toEqual([1, 1, 1])
    expect(Array.from(out.slice(3, 6))).toEqual([0, 0, 0])
  })

  test('pads unused slots with the last active stop', () => {
    const out = paletteToFloat32(['#FFFFFF', '#CCCCCC', '#444444', '#000000'], 2)
    expect(Array.from(out.slice(6, 9))).toEqual([0, 0, 0])
  })

  test('is the identity mapping when bandCount equals palette length', () => {
    const out = paletteToFloat32(['#FFFFFF', '#000000'], 2)
    expect(Array.from(out.slice(0, 6))).toEqual([1, 1, 1, 0, 0, 0])
  })

  test('never returns all zeros for a non-finite bandCount', () => {
    const out = paletteToFloat32(['#FFFFFF', '#000000'], Number.NaN)
    expect(Array.from(out.slice(0, 3))).toEqual([1, 1, 1])
  })
})
