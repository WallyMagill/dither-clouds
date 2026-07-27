'use client'

import { useEffect, useState } from 'react'
import {
  type DitherConfig,
  type PaletteName,
  MAX_PALETTE_STOPS,
  PALETTES,
  PALETTE_NAMES,
  resampleIndices,
} from '@/components/dither-background'

// Only the numeric fields of DitherConfig are slider-able — excludes
// `palette` (string[]) so a slider can never be wired to write a number into
// the palette slot, and the `as Partial<DitherConfig>` cast below stays sound.
type NumericConfigKey = {
  [K in keyof DitherConfig]: DitherConfig[K] extends number ? K : never
}[keyof DitherConfig]

type Slider = {
  key: NumericConfigKey
  label: string
  min: number
  max: number
  step: number
}

const SLIDERS: Slider[] = [
  // bandCount's max is overridden per-render to
  // min(MAX_PALETTE_STOPS, config.palette.length).
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

// Displays exactly as many decimals as the slider's own step carries, so a
// step-0.1 slider reads "2.2" rather than a hardcoded-precision "2.200".
function decimalsForStep(step: number): number {
  const s = step.toString()
  const i = s.indexOf('.')
  return i === -1 ? 0 : s.length - i - 1
}

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
      if (event.key !== '`') return
      // Ignore Cmd/Ctrl/Alt+` (browser/OS shortcuts) and key-repeat from a
      // held key, which would otherwise flicker the panel open/closed.
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return
      event.preventDefault()
      setOpen((v) => !v)
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

  // Closed means invisible, not a small affordance. The page is meant to read as
  // the finished artwork with no chrome whatsoever; the backtick key is the only
  // way in, which is documented in the README.
  if (!open) return null

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
            // "custom" (value="") is a display-only state; selecting it must
            // be inert, not throw — PALETTES[''] is undefined.
            if (!name || !(name in PALETTES)) return
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
        {/* One swatch per stop the engine actually samples (resampleIndices),
            not the first bandCount raw stops — those can differ once
            paletteToFloat32 resamples across the full ramp. */}
        {resampleIndices(config.palette.length, config.bandCount).map((sourceIndex, i) => (
          <input
            key={i}
            type="color"
            value={config.palette[sourceIndex]}
            aria-label={`Palette stop ${i + 1} of ${config.bandCount}`}
            onChange={(e) => {
              const palette = [...config.palette]
              palette[sourceIndex] = e.target.value.toUpperCase()
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
            <span className="text-white/80">{Number(config[key]).toFixed(decimalsForStep(step))}</span>
          </span>
          <input
            type="range"
            min={min}
            // resolveConfig clamps bandCount to min(MAX_PALETTE_STOPS,
            // palette.length), so a static max of 6 would leave the slider
            // visually stuck on shorter palettes (and wrong again above 6).
            max={key === 'bandCount' ? Math.min(MAX_PALETTE_STOPS, config.palette.length) : max}
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
