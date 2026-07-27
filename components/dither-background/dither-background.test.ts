import { describe, expect, test } from 'vitest'
import { DEFAULT_CONFIG } from './config'
import { fallbackGradient } from './dither-background'

// This file tests only the pure exported function below — no React
// rendering, no DOM. `dither-background.tsx` itself has no unit tests by
// design: it is browser-API lifecycle orchestration whose value is entirely
// in real-browser behavior, verified in Task 10. `fallbackGradient` is
// different: it's a plain string-builder with real failure modes (an
// invalid or degenerate palette silently producing no background at all),
// so it gets the same kind of coverage as the rest of the engine's pure
// functions.

describe('fallbackGradient', () => {
  test('the default palette produces a gradient containing both its first and last stop', () => {
    const result = fallbackGradient()
    expect(result).toContain(DEFAULT_CONFIG.palette[0])
    expect(result).toContain(DEFAULT_CONFIG.palette[DEFAULT_CONFIG.palette.length - 1])
  })

  test('a valid 2-stop custom palette uses those stops', () => {
    const result = fallbackGradient({ palette: ['#111111', '#eeeeee'] })
    expect(result).toContain('#111111')
    expect(result).toContain('#eeeeee')
    expect(result).not.toContain(DEFAULT_CONFIG.palette[0])
  })

  test('an empty palette falls back to the default and contains no undefined', () => {
    const result = fallbackGradient({ palette: [] })
    expect(result).toContain(DEFAULT_CONFIG.palette[0])
    expect(result).not.toContain('undefined')
  })

  test('a 1-stop palette falls back to the default', () => {
    const result = fallbackGradient({ palette: ['#123456'] })
    expect(result).toContain(DEFAULT_CONFIG.palette[0])
    expect(result).not.toContain('undefined')
  })

  test('a 2-stop palette of invalid hex falls back to the default', () => {
    const result = fallbackGradient({ palette: ['nope', 'alsonope'] })
    expect(result).toContain(DEFAULT_CONFIG.palette[0])
    expect(result).not.toContain('undefined')
    expect(result).not.toContain('nope')
  })

  test('undefined config falls back to the default', () => {
    const result = fallbackGradient(undefined)
    expect(result).toContain(DEFAULT_CONFIG.palette[0])
    expect(result).not.toContain('undefined')
  })
})
