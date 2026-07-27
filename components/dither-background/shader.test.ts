import { describe, expect, test } from 'vitest'
import { UNIFORM_NAMES, VERTEX_SHADER, buildFragmentShader } from './shader'
import { BAYER_8, BAYER_SIZE } from './bayer'
import { MAX_PALETTE_STOPS } from './config'

const frag = buildFragmentShader()

describe('shader sources', () => {
  test('both declare GLSL ES 3.00 on the first line', () => {
    expect(VERTEX_SHADER.startsWith('#version 300 es')).toBe(true)
    expect(frag.startsWith('#version 300 es')).toBe(true)
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

  test('embeds the full Bayer matrix in order', () => {
    // A shuffled matrix would still pass a membership check but turns ordered
    // dither into random noise, so assert the exact joined literal.
    expect(frag).toContain(`float BAYER[${BAYER_8.length}]`)
    expect(frag).toContain(BAYER_8.map((v) => v.toFixed(6)).join(', '))
  })

  test('sizes the palette uniform to MAX_PALETTE_STOPS', () => {
    expect(frag).toMatch(new RegExp(`uniform\\s+vec3\\s+uPalette\\[${MAX_PALETTE_STOPS}\\]`))
  })

  test('indexes the Bayer array row-major with the correct edge length', () => {
    expect(frag).toContain(`int(c.y) * ${BAYER_SIZE} + int(c.x)`)
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

  test('applies a field gain before the contrast window', () => {
    // Cloud density clusters in a narrow band around its midpoint; without a
    // gain the palette stops never separate. This guards against silently
    // reverting that fix.
    expect(frag).toContain('const float FIELD_GAIN')
    expect(frag).toMatch(/1\.0 - density - 0\.5\) \* FIELD_GAIN \+ 0\.5/)
  })

  test('scales the pointer bend by a radial falloff in uv space', () => {
    // Without falloff, uPointer offsets every pixel equally and the pointer
    // re-shuffles the whole fold pattern instead of bending it locally.
    expect(frag).toContain('pointerFalloff')
    expect(frag).toMatch(/exp\(-4\.0 \* length\(uv - pointerUv\)\)/)
  })

  test('billow folds the noise with abs() to make convex lobes', () => {
    // |noise| is what turns smooth waves into outward-bulging cloud lobes.
    // Dropping the abs() silently turns billow back into ordinary fbm and the
    // cloud edges go smooth — indistinguishable from fluid.
    expect(frag).toMatch(/sum \+= amp \* abs\(snoise\(p \* freq\)\)/)
  })

  test('composites cloud banks far-to-near with a painter\'s algorithm', () => {
    // Depth is what makes this a picture of a sky rather than one posterized
    // field. Losing a bank, or compositing them in the wrong order, flattens
    // the stack back into texture without failing any other test.
    const banks = [...frag.matchAll(/cloudBank\(p,\s*(-?\d+\.\d+)/g)].map((m) => Number(m[1]))
    expect(banks.length).toBeGreaterThanOrEqual(4)
    // Baselines must descend: each nearer bank sits LOWER on screen.
    expect(banks).toEqual([...banks].sort((a, b) => b - a))
  })

  test('cloud banks translate rather than morphing in place', () => {
    // The single most important motion property. Feeding time into the noise's
    // z axis churns the field and reads as flowing liquid; offsetting the
    // sample coordinate by drift * t moves each bank as a rigid body.
    expect(frag).toMatch(/float x = \(uv\.x - drift \* t\) \* scale \+ seed;/)
    // Nothing inside a bank may depend on t except that one offset. Measure the
    // body only: skip past the signature (which declares `float t`) and strip
    // comments (the prose above the function discusses t at length).
    const start = frag.indexOf('float cloudBank(')
    const body = frag
      .slice(frag.indexOf('{', start), frag.indexOf('float cloudDensity('))
      .replace(/\/\/[^\n]*/g, '')
    const tUses = [...body.matchAll(/\bt\b/g)].length
    expect(tUses, 'cloud bank body should reference t exactly once').toBe(1)
  })

  test('nearer cloud banks drift faster than farther ones', () => {
    // Parallax is the depth cue that survives even when the palette is flat.
    const drifts = [...frag.matchAll(/cloudBank\(p,[^)]*?,\s*(0\.\d+),\s*t,/g)].map((m) => Number(m[1]))
    expect(drifts.length).toBeGreaterThanOrEqual(4)
    expect(drifts).toEqual([...drifts].sort((a, b) => a - b))
  })

  test('inverts density so dense cloud takes the palette light stop', () => {
    // Clouds are the cream end and open sky is the navy end. Losing the
    // inversion flips the whole image without failing any structural test.
    expect(frag).toMatch(/1\.0 - density/)
  })
})
