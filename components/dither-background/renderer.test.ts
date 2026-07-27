import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createRenderer } from './renderer'
import { UNIFORM_NAMES } from './shader'

/** Minimal recording fake of the subset of WebGL2 the renderer touches. */
function createFakeGl(options: { failCompile?: boolean; failLink?: boolean } = {}) {
  const calls: string[] = []
  const uniformLocations = new Map<string, object>()

  const gl = {
    calls,
    uniformLocations,
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    COMPILE_STATUS: 35713,
    LINK_STATUS: 35714,
    TRIANGLES: 4,

    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => !options.failCompile),
    getShaderInfoLog: vi.fn(() => 'fake compile error'),
    deleteShader: vi.fn(),

    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(() => calls.push('linkProgram')),
    getProgramParameter: vi.fn(() => !options.failLink),
    getProgramInfoLog: vi.fn(() => 'fake link error'),
    deleteProgram: vi.fn(),
    useProgram: vi.fn(),

    createVertexArray: vi.fn(() => ({})),
    bindVertexArray: vi.fn(),
    deleteVertexArray: vi.fn(),

    getUniformLocation: vi.fn((_p: unknown, name: string) => {
      calls.push(`getUniformLocation:${name}`)
      if (!uniformLocations.has(name)) uniformLocations.set(name, { name })
      return uniformLocations.get(name)!
    }),

    uniform1f: vi.fn(),
    uniform1i: vi.fn(),
    uniform2f: vi.fn(),
    uniform3fv: vi.fn(),

    viewport: vi.fn((...args: number[]) => calls.push(`viewport:${args.join(',')}`)),
    drawArrays: vi.fn(() => calls.push('drawArrays')),
    getExtension: vi.fn(() => null),
  }
  return gl
}

function createFakeCanvas(gl: unknown) {
  const listeners = new Map<string, EventListener>()
  return {
    gl,
    listeners,
    width: 0,
    height: 0,
    getContext: vi.fn((kind: string) => (kind === 'webgl2' ? gl : null)),
    addEventListener: vi.fn((type: string, fn: EventListener) => listeners.set(type, fn)),
    removeEventListener: vi.fn((type: string) => listeners.delete(type)),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  } as unknown as HTMLCanvasElement & { gl: ReturnType<typeof createFakeGl>; listeners: Map<string, EventListener> }
}

/** Fires the given lost/restored listener with a stubbed preventDefault. */
function fireContextLost(canvas: ReturnType<typeof createFakeCanvas>) {
  const handler = canvas.listeners.get('webglcontextlost')!
  handler({ preventDefault: vi.fn() } as unknown as Event)
}

function fireContextRestored(canvas: ReturnType<typeof createFakeCanvas>) {
  const handler = canvas.listeners.get('webglcontextrestored')!
  handler({} as Event)
}

// Queued rAF callbacks, driven manually via stepFrame so the loop's time
// accumulation, delta clamp, and pointer easing are actually exercised
// instead of being permanently unreachable behind a stub that never calls
// back.
let rafCallbacks: FrameRequestCallback[] = []

beforeEach(() => {
  rafCallbacks = []
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    }),
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

/** Runs exactly the frames queued so far, at the given timestamp. */
function stepFrame(timestamp: number) {
  const pending = rafCallbacks
  rafCallbacks = []
  for (const cb of pending) cb(timestamp)
}

describe('createRenderer', () => {
  test('returns null when webgl2 is unavailable', () => {
    const canvas = { getContext: () => null, addEventListener: vi.fn() } as unknown as HTMLCanvasElement
    expect(createRenderer(canvas)).toBeNull()
  })

  test('returns null when shader compilation fails', () => {
    const canvas = createFakeCanvas(createFakeGl({ failCompile: true }))
    expect(createRenderer(canvas)).toBeNull()
  })

  test('returns null when program linking fails', () => {
    const canvas = createFakeCanvas(createFakeGl({ failLink: true }))
    expect(createRenderer(canvas)).toBeNull()
  })

  test('caches a location for every uniform exactly once', () => {
    const canvas = createFakeCanvas(createFakeGl())
    createRenderer(canvas)
    const lookups = canvas.gl.calls.filter((c) => c.startsWith('getUniformLocation:'))
    expect(lookups.length).toBe(UNIFORM_NAMES.length)
    expect(new Set(lookups).size).toBe(UNIFORM_NAMES.length)
  })

  test('setConfig does not relink the program', () => {
    const canvas = createFakeCanvas(createFakeGl())
    const renderer = createRenderer(canvas)!
    const linksBefore = canvas.gl.calls.filter((c) => c === 'linkProgram').length

    renderer.setConfig({ speed: 0.5, bandCount: 6, cellSize: 9 })

    const linksAfter = canvas.gl.calls.filter((c) => c === 'linkProgram').length
    expect(linksAfter).toBe(linksBefore)
  })

  test('setConfig does not re-look-up uniform locations', () => {
    const canvas = createFakeCanvas(createFakeGl())
    const renderer = createRenderer(canvas)!
    const before = canvas.gl.calls.filter((c) => c.startsWith('getUniformLocation:')).length

    renderer.setConfig({ speed: 0.5 })

    const after = canvas.gl.calls.filter((c) => c.startsWith('getUniformLocation:')).length
    expect(after).toBe(before)
  })

  test('resize sets the drawing buffer and gl viewport with capped dpr', () => {
    const canvas = createFakeCanvas(createFakeGl())
    const renderer = createRenderer(canvas)!

    renderer.resize(800, 600, 3)

    expect(canvas.width).toBe(1600)
    expect(canvas.height).toBe(1200)
    expect(canvas.gl.calls).toContain('viewport:0,0,1600,1200')
  })

  test('renderOnce issues a draw call', () => {
    const canvas = createFakeCanvas(createFakeGl())
    const renderer = createRenderer(canvas)!
    renderer.renderOnce()
    expect(canvas.gl.calls).toContain('drawArrays')
    expect(canvas.gl.drawArrays).toHaveBeenCalledWith(canvas.gl.TRIANGLES, 0, 3)
  })

  test('start sets running and stop clears it', () => {
    const canvas = createFakeCanvas(createFakeGl())
    const renderer = createRenderer(canvas)!

    expect(renderer.running).toBe(false)
    renderer.start()
    expect(renderer.running).toBe(true)
    renderer.stop()
    expect(renderer.running).toBe(false)
  })

  test('start is idempotent — a second call schedules no extra frame', () => {
    const canvas = createFakeCanvas(createFakeGl())
    const renderer = createRenderer(canvas)!
    renderer.start()
    const count = (requestAnimationFrame as unknown as ReturnType<typeof vi.fn>).mock.calls.length
    renderer.start()
    expect(
      (requestAnimationFrame as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(count)
  })

  test('registers a webglcontextlost handler that prevents default', () => {
    const canvas = createFakeCanvas(createFakeGl())
    createRenderer(canvas)

    const handler = canvas.listeners.get('webglcontextlost')
    expect(handler).toBeDefined()

    const preventDefault = vi.fn()
    handler!({ preventDefault } as unknown as Event)
    expect(preventDefault).toHaveBeenCalled()
  })

  test('destroy stops the loop and releases GL objects', () => {
    const canvas = createFakeCanvas(createFakeGl())
    const renderer = createRenderer(canvas)!
    renderer.start()
    renderer.destroy()

    expect(renderer.running).toBe(false)
    expect(canvas.gl.deleteProgram).toHaveBeenCalled()
    expect(canvas.gl.deleteVertexArray).toHaveBeenCalled()
    expect(canvas.removeEventListener).toHaveBeenCalled()
  })

  test('renderOnce after destroy is a no-op rather than a crash', () => {
    const canvas = createFakeCanvas(createFakeGl())
    const renderer = createRenderer(canvas)!
    renderer.destroy()
    const before = canvas.gl.calls.filter((c) => c === 'drawArrays').length
    expect(() => renderer.renderOnce()).not.toThrow()
    expect(canvas.gl.calls.filter((c) => c === 'drawArrays').length).toBe(before)
  })

  test('an invalid config throws before touching GL state', () => {
    const canvas = createFakeCanvas(createFakeGl())
    const renderer = createRenderer(canvas)!
    expect(() => renderer.setConfig({ palette: ['#000000'], bandCount: 4 })).toThrow()
  })

  // --- Context loss / restoration -------------------------------------

  test('webglcontextrestored relinks the program and re-caches every uniform location', () => {
    const canvas = createFakeCanvas(createFakeGl())
    createRenderer(canvas)

    const linksBefore = canvas.gl.calls.filter((c) => c === 'linkProgram').length
    const lookupsBefore = canvas.gl.calls.filter((c) => c.startsWith('getUniformLocation:')).length

    fireContextRestored(canvas)

    const linksAfter = canvas.gl.calls.filter((c) => c === 'linkProgram').length
    const lookupsAfter = canvas.gl.calls.filter((c) => c.startsWith('getUniformLocation:')).length

    expect(linksAfter).toBe(linksBefore + 1)
    expect(lookupsAfter).toBe(lookupsBefore + UNIFORM_NAMES.length)
  })

  test('restore resumes the loop only if it was running at the moment of loss', () => {
    const canvas = createFakeCanvas(createFakeGl())
    const renderer = createRenderer(canvas)!
    renderer.start()

    fireContextLost(canvas)
    expect(renderer.running).toBe(false)

    fireContextRestored(canvas)
    expect(renderer.running).toBe(true)
  })

  test('restore stays stopped and draws exactly once if it was stopped at the moment of loss', () => {
    const canvas = createFakeCanvas(createFakeGl())
    const renderer = createRenderer(canvas)!
    // never started

    fireContextLost(canvas)

    const drawsBefore = canvas.gl.calls.filter((c) => c === 'drawArrays').length
    fireContextRestored(canvas)
    const drawsAfter = canvas.gl.calls.filter((c) => c === 'drawArrays').length

    expect(renderer.running).toBe(false)
    expect(drawsAfter - drawsBefore).toBe(1)
  })

  // --- Invalid config at construction ----------------------------------

  test('createRenderer returns null rather than throwing for an invalid initial config', () => {
    const canvas = createFakeCanvas(createFakeGl())
    let result: ReturnType<typeof createRenderer> | undefined
    expect(() => {
      result = createRenderer(canvas, { palette: ['#000000'] })
    }).not.toThrow()
    expect(result).toBeNull()
    expect(canvas.gl.createProgram).not.toHaveBeenCalled()
  })

  // --- resize while stopped vs running ----------------------------------

  test('resize while stopped issues a draw so the canvas does not go blank', () => {
    const canvas = createFakeCanvas(createFakeGl())
    const renderer = createRenderer(canvas)!
    const before = canvas.gl.calls.filter((c) => c === 'drawArrays').length

    renderer.resize(800, 600, 1)

    const after = canvas.gl.calls.filter((c) => c === 'drawArrays').length
    expect(after - before).toBe(1)
  })

  test('resize while running does not add an extra draw beyond the loop', () => {
    const canvas = createFakeCanvas(createFakeGl())
    const renderer = createRenderer(canvas)!
    renderer.start()
    const before = canvas.gl.calls.filter((c) => c === 'drawArrays').length

    renderer.resize(800, 600, 1)

    const after = canvas.gl.calls.filter((c) => c === 'drawArrays').length
    expect(after - before).toBe(0)
  })

  // --- setConfig after destroy -------------------------------------------

  test('setConfig after destroy is a no-op and does not throw', () => {
    const canvas = createFakeCanvas(createFakeGl())
    const renderer = createRenderer(canvas)!
    renderer.destroy()

    expect(() => renderer.setConfig({ palette: ['#000000'] })).not.toThrow()
  })

  // --- Frame loop: time accumulation and pointer easing ------------------

  test('advancing frames accumulates uTime scaled by speed, with the delta clamped at 100ms', () => {
    const canvas = createFakeCanvas(createFakeGl())
    const renderer = createRenderer(canvas, { speed: 2 })!
    renderer.start()

    stepFrame(0) // first frame: no prior timestamp, contributes 0
    stepFrame(50) // 50ms delta -> 0.05s * speed 2 = 0.1
    stepFrame(9999) // huge delta, clamped to 100ms -> 0.1s * speed 2 = 0.2

    const uTimeLocation = canvas.gl.uniformLocations.get('uTime')
    const uTimeCalls = (canvas.gl.uniform1f as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([location]) => location === uTimeLocation,
    )
    const lastValue = uTimeCalls[uTimeCalls.length - 1][1]

    expect(lastValue).toBeCloseTo(0.3, 5)
  })

  test('pointer eases toward its target without reaching it in one frame', () => {
    const canvas = createFakeCanvas(createFakeGl())
    const renderer = createRenderer(canvas, { pointerEase: 0.1 })!
    renderer.setPointerTarget(1, 0)
    renderer.start()

    stepFrame(0)
    stepFrame(16)

    const uPointerLocation = canvas.gl.uniformLocations.get('uPointer')
    const pointerCalls = (canvas.gl.uniform2f as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([location]) => location === uPointerLocation,
    )
    const lastX = pointerCalls[pointerCalls.length - 1][1]

    expect(lastX).toBeGreaterThan(0)
    expect(lastX).toBeLessThan(1)
  })
})
