'use client'

import { useEffect, useRef, useState } from 'react'
import { shouldAnimate } from './animation-gate'
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
export function fallbackGradient(config?: DitherConfigInput): string {
  // A palette with fewer than 2 stops can't make a ramp (and is exactly the
  // input that makes createRenderer return null), so this is the one case
  // where the fallback itself must not depend on the caller's palette.
  const palette = config?.palette && config.palette.length >= 2 ? config.palette : DEFAULT_CONFIG.palette
  const light = palette[0]
  const dark = palette[palette.length - 1]
  return `linear-gradient(160deg, ${light} 0%, ${dark} 100%)`
}

export function DitherBackground({ config, className, paused = false }: DitherBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<DitherRenderer | null>(null)
  // A context that was created but never drawn composites opaque black under
  // alpha:false, which would hide the fallback gradient underneath it. The
  // canvas stays hidden until the first real frame is ready to show.
  const [rendererReady, setRendererReady] = useState(false)

  // `paused` is written from the dedicated effect below (never during render
  // — that is the react-hooks/refs lint rule) and read by the gate on every
  // event, so a stale closure can no longer invert the pause contract.
  const pausedRef = useRef(paused)
  const updateLoopRef = useRef<() => void>(() => {})

  // Mount: create the renderer once. Config changes are pushed as uniforms by
  // the effect below, never by recreating the context.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const renderer = createRenderer(canvas, config)
    if (!renderer) return // fallback gradient on the wrapper stays visible
    rendererRef.current = renderer
    setRendererReady(true)

    const parent = canvas.parentElement
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

    const sync = () => {
      const rect = (parent ?? canvas).getBoundingClientRect()
      // resize() already redraws internally when the renderer is stopped, so
      // no extra renderOnce() here — the observer callback below covers the
      // gated-off case explicitly instead of drawing on every sync.
      renderer.resize(rect.width, rect.height, window.devicePixelRatio)
    }

    let visible = true
    const evaluateGate = () =>
      shouldAnimate({
        visible,
        documentHidden: document.hidden,
        reduceMotion: reduceMotion.matches,
        paused: pausedRef.current,
      })

    const updateLoop = () => {
      if (evaluateGate()) renderer.start()
      else {
        renderer.stop()
        renderer.renderOnce()
      }
    }
    updateLoopRef.current = updateLoop

    sync()
    updateLoop()

    const resizeObserver = new ResizeObserver(() => {
      sync()
      if (!evaluateGate()) renderer.renderOnce()
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
    // pointerleave does not bubble, so a window listener never fires for an
    // event targeted at a descendant. document still sees it via capture.
    document.addEventListener('pointerleave', onPointerLeave, { passive: true })

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      reduceMotion.removeEventListener('change', onMotionChange)
      window.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerleave', onPointerLeave)
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      renderer.destroy()
      rendererRef.current = null
      setRendererReady(false)
    }
    // `config` is read once, at construction; `paused` is read through
    // pausedRef, kept fresh by the dedicated effect below. Neither should
    // re-run this effect — recreating the WebGL context on every prop change
    // is exactly what this design avoids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Push config changes as uniforms. No relink, no remount, no restart.
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer || !config) return
    renderer.setConfig(config)
    // A stopped renderer owns no frame loop, so nothing would repaint it.
    if (!renderer.running) renderer.renderOnce()
  }, [config])

  useEffect(() => {
    pausedRef.current = paused
    updateLoopRef.current()
  }, [paused])

  return (
    <div
      className={className}
      style={{
        position: 'absolute',
        inset: 0,
        background: fallbackGradient(config),
        // Decoration only — never intercept clicks meant for real content
        // stacked above or below this absolutely-positioned wrapper.
        pointerEvents: 'none',
      }}
      aria-hidden="true"
    >
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          visibility: rendererReady ? 'visible' : 'hidden',
        }}
      />
    </div>
  )
}

export default DitherBackground
