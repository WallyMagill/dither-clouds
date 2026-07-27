import { type DitherConfig, type DitherConfigInput, paletteToFloat32, resolveConfig } from './config'
import { UNIFORM_NAMES, VERTEX_SHADER, buildFragmentShader } from './shader'
import { computeDrawingBufferSize, easeToward } from './viewport'

export { normalizePointer } from './viewport'

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
    if (process.env.NODE_ENV !== 'production') {
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
    if (process.env.NODE_ENV !== 'production') {
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
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
  }) as WebGL2RenderingContext | null

  if (!gl) return null

  const program = linkProgram(gl, VERTEX_SHADER, buildFragmentShader())
  if (!program) return null

  // Cached once at construction. setConfig must never re-look-up locations —
  // that is the difference between a slider being free and a slider stalling
  // the pipeline.
  const locations = new Map<string, WebGLUniformLocation | null>()
  for (const name of UNIFORM_NAMES) {
    locations.set(name, gl.getUniformLocation(program, name))
  }
  const at = (name: string) => locations.get(name) ?? null

  // WebGL2 requires a bound VAO even when the shader reads no attributes.
  const vao = gl.createVertexArray()

  let config: DitherConfig = resolveConfig(input)
  let paletteBuffer = paletteToFloat32(config.palette, config.bandCount)

  let frame = 0
  let running = false
  let destroyed = false
  let contextLost = false

  let time = 0
  let lastTimestamp: number | null = null

  const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 }
  let width = 1
  let height = 1

  // Arrow functions, not function declarations: TypeScript does not carry the
  // `gl` null-narrowing from the early return above into hoisted function
  // declarations, only into closures defined after the narrowing point.
  const pushStaticUniforms = () => {
    gl.useProgram(program)
    gl.uniform3fv(at('uPalette'), paletteBuffer)
    gl.uniform1i(at('uBandCount'), config.bandCount)
    gl.uniform1f(at('uCellSize'), config.cellSize)
    gl.uniform1f(at('uDitherStrength'), config.ditherStrength)
    gl.uniform1f(at('uNoiseScale'), config.noiseScale)
    gl.uniform1f(at('uWarpStrength'), config.warpStrength)
    gl.uniform1f(at('uWarpDetail'), config.warpDetail)
    gl.uniform1f(at('uPointerStrength'), config.pointerStrength)
    gl.uniform1f(at('uContrastLow'), config.contrastLow)
    gl.uniform1f(at('uContrastHigh'), config.contrastHigh)
    gl.uniform1f(at('uGrain'), config.grain)
  }

  const draw = () => {
    if (destroyed || contextLost) return

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
    time += deltaSeconds * config.speed

    pointer.x = easeToward(pointer.x, pointer.targetX, config.pointerEase)
    pointer.y = easeToward(pointer.y, pointer.targetY, config.pointerEase)

    draw()
    frame = requestAnimationFrame(tick)
  }

  function handleContextLost(event: Event) {
    event.preventDefault()
    contextLost = true
    running = false
    cancelAnimationFrame(frame)
  }

  function handleContextRestored() {
    contextLost = false
    pushStaticUniforms()
    if (!destroyed) renderer.start()
  }

  canvas.addEventListener('webglcontextlost', handleContextLost)
  canvas.addEventListener('webglcontextrestored', handleContextRestored)

  gl.clearColor(0, 0, 0, 1)
  pushStaticUniforms()

  const renderer: DitherRenderer = {
    get running() {
      return running
    },

    setConfig(next: DitherConfigInput) {
      // resolveConfig validates first, so an invalid palette throws without
      // leaving GL state half-updated.
      const resolved = resolveConfig({ ...config, ...next })
      config = resolved
      paletteBuffer = paletteToFloat32(config.palette, config.bandCount)
      pushStaticUniforms()
    },

    start() {
      if (running || destroyed || contextLost) return
      running = true
      lastTimestamp = null
      frame = requestAnimationFrame(tick)
    },

    stop() {
      running = false
      lastTimestamp = null
      cancelAnimationFrame(frame)
    },

    resize(cssWidth: number, cssHeight: number, dpr: number) {
      const size = computeDrawingBufferSize(cssWidth, cssHeight, dpr)
      width = size.width
      height = size.height
      canvas.width = size.width
      canvas.height = size.height
      gl.viewport(0, 0, size.width, size.height)
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
      gl.deleteVertexArray(vao)
      gl.deleteProgram(program)
    },
  }

  return renderer
}
