import { describe, expect, test } from 'vitest'
import { BAYER_8, BAYER_SIZE, generateBayer } from './bayer'

describe('generateBayer', () => {
  test('order 1 produces the canonical 2x2 matrix', () => {
    // Unnormalized 2x2 is [[0,2],[3,1]]; normalized by (v + 0.5) / 4.
    expect(generateBayer(1)).toEqual([0.125, 0.625, 0.875, 0.375])
  })

  test('order 2 matches the canonical 4x4 Bayer matrix', () => {
    // Aggregate properties (count, spacing, mean, uniqueness) are all invariant
    // under a transposed or rotated quadrant mapping, so they cannot catch a
    // wrong recursion. Pinning the exact raw values is the only test that can.
    const raw = generateBayer(2).map((v) => Math.round(v * 16 - 0.5))
    expect(raw).toEqual([
       0,  8,  2, 10,
      12,  4, 14,  6,
       3, 11,  1,  9,
      15,  7, 13,  5,
    ])
  })

  test('order n produces (2^n)^2 entries', () => {
    expect(generateBayer(1).length).toBe(4)
    expect(generateBayer(2).length).toBe(16)
    expect(generateBayer(3).length).toBe(64)
  })

  test('all values lie strictly inside 0..1', () => {
    for (const v of generateBayer(3)) {
      expect(v).toBeGreaterThan(0)
      expect(v).toBeLessThan(1)
    }
  })

  test('values are uniformly spaced with no duplicates', () => {
    const sorted = [...generateBayer(3)].sort((a, b) => a - b)
    expect(new Set(sorted).size).toBe(64)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i] - sorted[i - 1]).toBeCloseTo(1 / 64, 10)
    }
  })

  test('mean is 0.5 — the matrix does not bias the field lighter or darker', () => {
    const values = generateBayer(3)
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    expect(mean).toBeCloseTo(0.5, 10)
  })

  test('throws on order below 1', () => {
    expect(() => generateBayer(0)).toThrow()
  })
})

describe('BAYER_8', () => {
  test('is the order-3 matrix', () => {
    expect(BAYER_8).toEqual(generateBayer(3))
  })

  test('BAYER_SIZE matches its edge length', () => {
    expect(BAYER_SIZE * BAYER_SIZE).toBe(BAYER_8.length)
  })
})
