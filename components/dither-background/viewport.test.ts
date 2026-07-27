import { describe, expect, test } from 'vitest'
import { MAX_DPR, computeDrawingBufferSize, easeToward, normalizePointer } from './viewport'

describe('computeDrawingBufferSize', () => {
  test('multiplies css size by device pixel ratio', () => {
    expect(computeDrawingBufferSize(800, 600, 1)).toEqual({ width: 800, height: 600 })
    expect(computeDrawingBufferSize(800, 600, 2)).toEqual({ width: 1600, height: 1200 })
  })

  test('caps device pixel ratio at MAX_DPR', () => {
    expect(MAX_DPR).toBe(2)
    expect(computeDrawingBufferSize(800, 600, 3)).toEqual({ width: 1600, height: 1200 })
  })

  test('rounds to whole pixels', () => {
    expect(computeDrawingBufferSize(800.4, 600.6, 1)).toEqual({ width: 800, height: 601 })
  })

  test('never returns a zero dimension', () => {
    // A zero-sized drawing buffer is a GL error; a collapsed container must
    // still produce a valid (if tiny) framebuffer.
    expect(computeDrawingBufferSize(0, 0, 2)).toEqual({ width: 1, height: 1 })
  })

  test('treats a non-finite or absent dpr as 1', () => {
    expect(computeDrawingBufferSize(800, 600, Number.NaN)).toEqual({ width: 800, height: 600 })
    expect(computeDrawingBufferSize(800, 600, 0)).toEqual({ width: 800, height: 600 })
  })

  test('treats a non-finite cssWidth as 1 css pixel rather than propagating NaN', () => {
    // getBoundingClientRect can't produce this in the React shell, but resize()
    // is on the exported DitherRenderer type and callable from any framework —
    // a non-finite width must not collapse to a zero-sized drawing buffer.
    expect(computeDrawingBufferSize(Number.NaN, 600, 1)).toEqual({ width: 1, height: 600 })
    expect(computeDrawingBufferSize(Number.POSITIVE_INFINITY, 600, 1)).toEqual({
      width: 1,
      height: 600,
    })
  })

  test('treats a non-finite cssHeight as 1 css pixel rather than propagating NaN', () => {
    expect(computeDrawingBufferSize(800, Number.NaN, 1)).toEqual({ width: 800, height: 1 })
    expect(computeDrawingBufferSize(800, Number.POSITIVE_INFINITY, 1)).toEqual({
      width: 800,
      height: 1,
    })
  })
})

describe('easeToward', () => {
  test('moves a fraction of the remaining distance', () => {
    expect(easeToward(0, 10, 0.5)).toBe(5)
    expect(easeToward(5, 10, 0.5)).toBe(7.5)
  })

  test('factor 1 snaps to target', () => {
    expect(easeToward(0, 10, 1)).toBe(10)
  })

  test('factor 0 does not move', () => {
    expect(easeToward(3, 10, 0)).toBe(3)
  })

  test('converges toward the target under repeated application', () => {
    let v = 0
    for (let i = 0; i < 500; i++) v = easeToward(v, 1, 0.04)
    expect(v).toBeCloseTo(1, 5)
  })

  test('is stable when already at target', () => {
    expect(easeToward(10, 10, 0.5)).toBe(10)
  })
})

describe('normalizePointer', () => {
  const rect = { left: 0, top: 0, width: 800, height: 400 }

  test('maps the center to the origin', () => {
    expect(normalizePointer(400, 200, rect)).toEqual([0, 0])
  })

  test('maps horizontal extremes to -1 and 1', () => {
    expect(normalizePointer(0, 200, rect)[0]).toBe(-1)
    expect(normalizePointer(800, 200, rect)[0]).toBe(1)
  })

  test('flips y so up is positive, matching gl_FragCoord', () => {
    expect(normalizePointer(400, 0, rect)[1]).toBe(1)
    expect(normalizePointer(400, 400, rect)[1]).toBe(-1)
  })

  test('accounts for a non-zero element offset', () => {
    const offset = { left: 100, top: 50, width: 800, height: 400 }
    expect(normalizePointer(500, 250, offset)).toEqual([0, 0])
  })

  test('does not divide by zero on a collapsed element', () => {
    const collapsed = { left: 0, top: 0, width: 0, height: 0 }
    const [x, y] = normalizePointer(0, 0, collapsed)
    expect(Number.isFinite(x)).toBe(true)
    expect(Number.isFinite(y)).toBe(true)
  })
})
