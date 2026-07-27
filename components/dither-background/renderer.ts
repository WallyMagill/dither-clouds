import { type DitherConfig, type DitherConfigInput, paletteToFloat32, resolveConfig } from './config'
import { UNIFORM_NAMES, VERTEX_SHADER, buildFragmentShader } from './shader'
import { computeDrawingBufferSize, easeToward } from './viewport'

export type DitherRenderer = {
  setConfig(input: DitherConfigInput): void
  start(): void
  stop(): void
  resize(cssWidth: number, cssHeight: number, dpr: number): void
  setPointerTarget(x: number, y: number): void
  renderOnce(): void
  destroy(): void
  readonly running: boolean
}

// `process` is undefined in an unbundled raw-ESM host. This guard must never
// throw, including from inside compileShader's "must return null" path.
const isDev = typeof process !== 'undefined' && process.env.NODE_ENV !== 'production'

/** Prefixes each source line with its number so driver error logs are actionable. */
function numberSource(source: string): string {
  return source
    .split('\n')
    .map((line, i) => `${String(i + 1).padStart(4, ' ')} | ${line}`)
    .join('\n')
}

export function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    if (isDev) {
      console.error(
        `[dither-background] shader compile failed:\n${gl.getShaderInfoLog(shader)}\n\n${numberSource(source)}`,
      )
    }
    gl.deleteShader(shader)
    return null
  }
  return shader
}

export function linkProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram | null {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
  if (!vertex) return null

  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  if (!fragment) {
    gl.deleteShader(vertex)
    return null
  }

  const program = gl.createProgram()
  if (!program) {
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    return null
  }

  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)

  // Shaders are reference-counted by the program; detaching is unnecessary.
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    if (isDev) {
      console.error(`[dither-background] program link failed: ${gl.getProgramInfoLog(program)}`)
    }
    gl.deleteProgram(program)
    return null
  }
  return program
}

export function createRenderer(
  canvas: HTMLCanvasElement,
  input: DitherConfigInput = {},
): DitherRenderer | null {
  // Resolve and validate the config BEFORE allocating anything on the GPU.
  // An invalid palette must fall back to null exactly like a missing WebGL2
  // context or a shader failure — never propagate as an exception out of
  // construction, and never leak a linked program/VAO in the process.
  let config: DitherConfig
  try {
    config = resolveConfig(input)
  } catch (error) {
    if (isDev) {
      console.error('[dither-background] invalid config, falling back:', error)
    }
    return null
  }
  let paletteBuffer = paletteToFloat32(config.palette, config.bandCount)

  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
  }) as WebGL2RenderingContext | null

  if (!gl) return null

  // Program, VAO, and every cached uniform location die with the GL context
  // (webglcontextlost invalidates all of them), so these must be rebuildable
  // rather than built once. `setConfig` still never re-looks-up a location
  // or relinks — this only re-runs after an actual context loss.
  let program: WebGLProgram | null = null
  let vao: WebGLVertexArrayObject | null = null
  const locations = new Map<string, WebGLUniformLocation | null>()
  const at = (name: string) => locations.get(name) ?? null

  // Arrow function, not a function declaration: TypeScript does not carry the
  // `gl` null-narrowing from the early return above into hoisted function
  // declarations, only into closures defined after the narrowing point.
  const buildGlResources = (): boolean => {
    const nextProgram = linkProgram(gl, VERTEX_SHADER, buildFragmentShader())
    if (!nextProgram) return false

    const nextVao = gl.createVertexArray()
    if (!nextVao) {
      if (isDev) console.error('[dither-background] failed to create VAO')
      gl.deleteProgram(nextProgram)
      return false
    }

    program = nextProgram
    vao = nextVao

    locations.clear()
    for (const name of UNIFORM_NAMES) {
      locations.set(name, gl.getUniformLocation(nextProgram, name))
    }
    return true
  }

  if (!buildGlResources()) return null

  let frame = 0
  let running = false
  let destroyed = false
  let contextLost = false
  let wasRunningBeforeLoss = false

  let time = 0
  let lastTimestamp: number | null = null

  const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 }
  let width = 1
  let height = 1

  const pushStaticUniforms = () => {
    if (!program) return
    gl.useProgram(program)
    gl.uniform3fv(at('uPalette'), paletteBuffer)
    gl.uniform1i(at('uBandCount'), config.bandCount)
    gl.uniform1f(at('uCellSize'), config.cellSize)
    gl.uniform1f(at('uDitherStrength'), config.ditherStrength)
    gl.uniform1f(at('uCloudScale'), config.cloudScale)
    gl.uniform1f(at('uCoverage'), config.coverage)
    gl.uniform1f(at('uCrownDetail'), config.crownDetail)
    gl.uniform1f(at('uPointerStrength'), config.pointerStrength)
    gl.uniform1f(at('uContrastLow'), config.contrastLow)
    gl.uniform1f(at('uContrastHigh'), config.contrastHigh)
    gl.uniform1f(at('uGrain'), config.grain)
  }

  const draw = () => {
    if (destroyed || contextLost || !program || !vao) return

    gl.useProgram(program)
    gl.bindVertexArray(vao)

    gl.uniform2f(at('uResolution'), width, height)
    gl.uniform1f(at('uTime'), time)
    gl.uniform2f(at('uPointer'), pointer.x, pointer.y)

    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  function tick(timestamp: number) {
    if (!running || destroyed) return

    const deltaSeconds = lastTimestamp === null ? 0 : Math.min((timestamp - lastTimestamp) / 1000, 0.1)
    lastTimestamp = timestamp
    // `time` accumulates for the lifetime of the page with no wraparound. At
    // the default speed it takes roughly five days to reach a magnitude
    // where float precision visibly degrades. A modulo "fix" would be worse:
    // the underlying simplex field is not periodic in z, so wrapping it
    // produces a visible pop rather than a seamless loop.
    time += deltaSeconds * config.speed

    pointer.x = easeToward(pointer.x, pointer.targetX, config.pointerEase)
    pointer.y = easeToward(pointer.y, pointer.targetY, config.pointerEase)

    draw()
    frame = requestAnimationFrame(tick)
  }

  function handleContextLost(event: Event) {
    event.preventDefault()
    wasRunningBeforeLoss = running
    contextLost = true
    running = false
    cancelAnimationFrame(frame)
  }

  const handleContextRestored = () => {
    if (destroyed) return
    if (!buildGlResources()) {
      // Leave contextLost set: the guards in draw()/start() are the only
      // thing stopping a loop that would render nothing against dead GL
      // objects until the browser fires another webglcontextlost.
      program = null
      vao = null
      return
    }
    contextLost = false
    gl.viewport(0, 0, width, height)
    pushStaticUniforms()
    if (wasRunningBeforeLoss) {
      renderer.start()
    } else {
      draw()
    }
  }

  canvas.addEventListener('webglcontextlost', handleContextLost)
  canvas.addEventListener('webglcontextrestored', handleContextRestored)

  pushStaticUniforms()

  const renderer: DitherRenderer = {
    get running() {
      return running
    },

    setConfig(next: DitherConfigInput) {
      if (destroyed) return
      let resolved: DitherConfig
      try {
        resolved = resolveConfig({ ...config, ...next })
      } catch (error) {
        // Mount already falls back rather than throwing (see createRenderer). An
        // update must not be harsher: a consumer passing a transiently-invalid
        // palette should keep the last good frame, not unmount the page.
        if (isDev) console.error('[dither-background] ignoring invalid config update:', error)
        return
      }
      config = resolved
      paletteBuffer = paletteToFloat32(config.palette, config.bandCount)
      pushStaticUniforms()
    },

    start() {
      if (running || destroyed) return
      if (contextLost) {
        // The intent to run must survive the loss: the shell may call stop()
        // while the context is still lost (e.g. the visibility/intersection
        // gate toggling off then back on), and without recording this here the
        // restore handler would see wasRunningBeforeLoss=false and draw a
        // single static frame instead of resuming the loop.
        wasRunningBeforeLoss = true
        return
      }
      running = true
      lastTimestamp = null
      frame = requestAnimationFrame(tick)
    },

    stop() {
      running = false
      lastTimestamp = null
      wasRunningBeforeLoss = false
      cancelAnimationFrame(frame)
    },

    resize(cssWidth: number, cssHeight: number, dpr: number) {
      const size = computeDrawingBufferSize(cssWidth, cssHeight, dpr)
      width = size.width
      height = size.height
      canvas.width = size.width
      canvas.height = size.height
      gl.viewport(0, 0, size.width, size.height)

      // Re-assigning width/height reallocates and clears the drawing buffer.
      // The RAF loop repaints on its own; a stopped renderer would otherwise
      // stay blank until whatever external event resumes it.
      if (!running) draw()
    },

    setPointerTarget(x: number, y: number) {
      pointer.targetX = x
      pointer.targetY = y
    },

    renderOnce() {
      draw()
    },

    destroy() {
      renderer.stop()
      destroyed = true
      canvas.removeEventListener('webglcontextlost', handleContextLost)
      canvas.removeEventListener('webglcontextrestored', handleContextRestored)
      if (vao) gl.deleteVertexArray(vao)
      if (program) gl.deleteProgram(program)
    },
  }

  return renderer
}
