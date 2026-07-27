'use client'

import { useEffect, useState } from 'react'
import {
  type DitherConfig,
  type PaletteName,
  PALETTES,
  PALETTE_NAMES,
} from '@/components/dither-background'

type Slider = {
  key: keyof DitherConfig
  label: string
  min: number
  max: number
  step: number
}

const SLIDERS: Slider[] = [
  // bandCount's max is overridden per-render to config.palette.length.
  { key: 'bandCount', label: 'Bands', min: 2, max: 6, step: 1 },
  { key: 'cellSize', label: 'Cell size (px)', min: 1, max: 16, step: 1 },
  { key: 'ditherStrength', label: 'Dither strength', min: 0, max: 1, step: 0.01 },
  { key: 'noiseScale', label: 'Noise scale', min: 0.2, max: 8, step: 0.1 },
  { key: 'warpStrength', label: 'Warp strength', min: 0, max: 12, step: 0.1 },
  { key: 'warpDetail', label: 'Warp detail', min: 0, max: 12, step: 0.1 },
  { key: 'speed', label: 'Speed', min: 0, max: 0.6, step: 0.005 },
  { key: 'pointerStrength', label: 'Pointer strength', min: 0, max: 3, step: 0.05 },
  { key: 'contrastLow', label: 'Contrast low', min: 0, max: 1, step: 0.01 },
  { key: 'contrastHigh', label: 'Contrast high', min: 0, max: 1, step: 0.01 },
  { key: 'grain', label: 'Grain', min: 0, max: 0.2, step: 0.005 },
]

export function ControlPanel({
  config,
  onChange,
}: {
  config: DitherConfig
  onChange: (next: Partial<DitherConfig>) => void
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  // Backtick toggles the panel — off by default so the page reads as a real
  // background, not a demo harness.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '`') {
        event.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  async function copyConfig() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(config, null, 2))
      setCopied(true)
    } catch {
      // Clipboard API is unavailable on insecure origins and can reject;
      // leave the button label unchanged rather than throwing.
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-50 rounded-full bg-black/60 px-3 py-1.5 font-mono text-xs text-white/70 backdrop-blur transition hover:text-white"
      >
        ` controls
      </button>
    )
  }

  return (
    <aside className="fixed bottom-4 right-4 z-50 max-h-[85vh] w-72 overflow-y-auto rounded-lg bg-black/75 p-4 font-mono text-xs text-white/90 backdrop-blur">
      <div className="mb-3 flex items-center justify-between">
        <span className="tracking-wide uppercase text-white/50">Controls</span>
        <button type="button" onClick={() => setOpen(false)} className="text-white/50 hover:text-white">
          close
        </button>
      </div>

      <label className="mb-3 block">
        <span className="mb-1 block text-white/50">Palette</span>
        <select
          value={PALETTE_NAMES.find((n) => PALETTES[n].join() === config.palette.join()) ?? ''}
          onChange={(e) => {
            const name = e.target.value as PaletteName
            const palette = [...PALETTES[name]]
            onChange({ palette, bandCount: Math.min(config.bandCount, palette.length) })
          }}
          className="w-full rounded bg-white/10 px-2 py-1"
        >
          <option value="">custom</option>
          {PALETTE_NAMES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>

      <div className="mb-3 flex gap-1">
        {config.palette.slice(0, config.bandCount).map((hex, i) => (
          <input
            key={i}
            type="color"
            value={hex}
            aria-label={`Palette stop ${i + 1}`}
            onChange={(e) => {
              const palette = [...config.palette]
              palette[i] = e.target.value.toUpperCase()
              onChange({ palette })
            }}
            className="h-7 w-full cursor-pointer rounded border border-white/20 bg-transparent"
          />
        ))}
      </div>

      {SLIDERS.map(({ key, label, min, max, step }) => (
        <label key={key} className="mb-2 block">
          <span className="flex justify-between text-white/50">
            {label}
            <span className="text-white/80">{Number(config[key]).toFixed(step < 1 ? 3 : 0)}</span>
          </span>
          <input
            type="range"
            min={min}
            // resolveConfig clamps bandCount to the palette length, so a static
            // max of 6 would leave the slider visually stuck on shorter palettes.
            max={key === 'bandCount' ? config.palette.length : max}
            step={step}
            value={Number(config[key])}
            onChange={(e) => onChange({ [key]: Number(e.target.value) } as Partial<DitherConfig>)}
            className="w-full accent-white/80"
          />
        </label>
      ))}

      <button
        type="button"
        onClick={copyConfig}
        className="mt-2 w-full rounded bg-white/15 py-1.5 transition hover:bg-white/25"
      >
        {copied ? 'copied' : 'copy config'}
      </button>
    </aside>
  )
}
