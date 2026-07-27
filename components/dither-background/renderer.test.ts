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
    COLOR_BUFFER_BIT: 16384,
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
    clearColor: vi.fn(),
    clear: vi.fn(),
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

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

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
})
