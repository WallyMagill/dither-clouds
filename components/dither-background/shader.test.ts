import { describe, expect, test } from 'vitest'
import { UNIFORM_NAMES, VERTEX_SHADER, buildFragmentShader } from './shader'
import { BAYER_8, BAYER_SIZE } from './bayer'
import { MAX_PALETTE_STOPS } from './config'

const frag = buildFragmentShader()

describe('shader sources', () => {
  test('both declare GLSL ES 3.00 on the first line', () => {
    expect(VERTEX_SHADER.split('\n')[0].trim()).toBe('#version 300 es')
    expect(frag.split('\n')[0].trim()).toBe('#version 300 es')
  })

  test('no unresolved template placeholders remain', () => {
    expect(frag).not.toMatch(/\$\{/)
    expect(frag).not.toMatch(/\bTODO\b|\bTBD\b/)
    expect(VERTEX_SHADER).not.toMatch(/\$\{/)
  })

  test('vertex shader uses gl_VertexID and declares no attributes', () => {
    expect(VERTEX_SHADER).toContain('gl_VertexID')
    expect(VERTEX_SHADER).not.toMatch(/\bin\s+vec/)
  })
})

describe('fragment shader', () => {
  test('declares every uniform named in UNIFORM_NAMES', () => {
    for (const name of UNIFORM_NAMES) {
      expect(frag).toMatch(new RegExp(`uniform\\s+\\w+\\s+${name}\\b`))
    }
  })

  test('declares no uniform missing from UNIFORM_NAMES', () => {
    const declared = [...frag.matchAll(/uniform\s+\w+\s+(\w+)/g)].map((m) => m[1])
    expect([...declared].sort()).toEqual([...UNIFORM_NAMES].sort())
  })

  test('embeds the full Bayer matrix', () => {
    expect(frag).toContain(`float BAYER[${BAYER_8.length}]`)
    for (const v of BAYER_8) {
      expect(frag).toContain(v.toFixed(6))
    }
  })

  test('sizes the palette uniform to MAX_PALETTE_STOPS', () => {
    expect(frag).toMatch(new RegExp(`uniform\\s+vec3\\s+uPalette\\[${MAX_PALETTE_STOPS}\\]`))
  })

  test('embeds the Bayer edge length', () => {
    expect(frag).toContain(`${BAYER_SIZE}.0`)
  })

  test('samples the dither grid from gl_FragCoord, not from UV', () => {
    // The whole printed-paper illusion depends on this. If the threshold is
    // ever derived from uv, the dots swim with the noise.
    const line = frag.split('\n').find((l) => l.includes('bayer('))
    expect(line).toBeDefined()
    expect(frag).toMatch(/bayer\s*\(\s*gl_FragCoord\.xy/)
  })

  test('bayer() takes its coordinate in device pixels and divides by cell size', () => {
    expect(frag).toMatch(/mod\s*\(\s*fragCoord\s*\/\s*cell/)
  })

  test('octave count is compiled in as a loop bound', () => {
    expect(buildFragmentShader(4)).toContain('i < 4')
    expect(buildFragmentShader(6)).toContain('i < 6')
  })

  test('rejects a nonsensical octave count', () => {
    expect(() => buildFragmentShader(0)).toThrow()
    expect(() => buildFragmentShader(12)).toThrow()
  })

  test('has balanced braces', () => {
    const open = (frag.match(/\{/g) ?? []).length
    const close = (frag.match(/\}/g) ?? []).length
    expect(open).toBe(close)
  })

  test('writes to a declared output', () => {
    expect(frag).toMatch(/out\s+vec4\s+(\w+)/)
    const name = /out\s+vec4\s+(\w+)/.exec(frag)![1]
    expect(frag).toContain(`${name} =`)
  })
})
