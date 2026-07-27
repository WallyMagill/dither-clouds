'use client'

import { useEffect, useRef } from 'react'
import { type DitherConfigInput, DEFAULT_CONFIG } from './config'
import { type DitherRenderer, createRenderer } from './renderer'
import { normalizePointer } from './viewport'

export type DitherBackgroundProps = {
  config?: DitherConfigInput
  className?: string
  /** Render a single frame and skip the animation loop. */
  paused?: boolean
}

/** Endpoint colors of the default palette, used for the no-WebGL fallback. */
function fallbackGradient(config?: DitherConfigInput): string {
  const palette = config?.palette ?? DEFAULT_CONFIG.palette
  const light = palette[0]
  const dark = palette[palette.length - 1]
  return `linear-gradient(160deg, ${light} 0%, ${dark} 100%)`
}

export function DitherBackground({ config, className, paused = false }: DitherBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<DitherRenderer | null>(null)

  // Config is read once, inside the mount effect below, which never re-runs.
  // The `useRef` initializer alone captures the value present at first
  // render — nothing may write `configRef.current` during render itself
  // (the `react-hooks/refs` rule forbids it, and nothing here ever reads
  // this ref again after the mount effect consumes it).
  const configRef = useRef(config)

  // Mount: create the renderer once. Config changes are pushed as uniforms by
  // the effect below, never by recreating the context.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const renderer = createRenderer(canvas, configRef.current)
    if (!renderer) return // fallback gradient on the wrapper stays visible
    rendererRef.current = renderer

    const parent = canvas.parentElement
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

    const sync = () => {
      const rect = (parent ?? canvas).getBoundingClientRect()
      renderer.resize(rect.width, rect.height, window.devicePixelRatio)
      renderer.renderOnce()
    }

    let visible = true
    const shouldAnimate = () =>
      visible && !document.hidden && !reduceMotion.matches && !paused

    const updateLoop = () => {
      if (shouldAnimate()) renderer.start()
      else {
        renderer.stop()
        renderer.renderOnce()
      }
    }

    sync()
    updateLoop()

    const resizeObserver = new ResizeObserver(() => {
      sync()
      if (!shouldAnimate()) renderer.renderOnce()
    })
    resizeObserver.observe(parent ?? canvas)

    // Stop burning GPU when scrolled out of view or on a hidden tab.
    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        visible = entries.some((entry) => entry.isIntersecting)
        updateLoop()
      },
      { threshold: 0 },
    )
    intersectionObserver.observe(canvas)

    const onVisibility = () => updateLoop()
    const onMotionChange = () => updateLoop()

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const [x, y] = normalizePointer(event.clientX, event.clientY, rect)
      renderer.setPointerTarget(x, y)
    }

    const onPointerLeave = () => renderer.setPointerTarget(0, 0)

    document.addEventListener('visibilitychange', onVisibility)
    reduceMotion.addEventListener('change', onMotionChange)
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerleave', onPointerLeave, { passive: true })

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      reduceMotion.removeEventListener('change', onMotionChange)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerleave', onPointerLeave)
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      renderer.destroy()
      rendererRef.current = null
    }
    // `paused` is read through shouldAnimate on each event; the dedicated
    // effect below handles changes to it without tearing down the context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Push config changes as uniforms. No relink, no remount, no restart.
  useEffect(() => {
    if (config) rendererRef.current?.setConfig(config)
  }, [config])

  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer) return
    if (paused) {
      renderer.stop()
      renderer.renderOnce()
    } else if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      renderer.start()
    }
  }, [paused])

  return (
    <div
      className={className}
      style={{ position: 'absolute', inset: 0, background: fallbackGradient(config) }}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
    </div>
  )
}

export default DitherBackground
