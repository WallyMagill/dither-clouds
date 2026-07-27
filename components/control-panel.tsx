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
  /** Shown on hover — says which direction does what, where that isn't obvious. */
  hint?: string
}

/**
 * Grouped by what the control does to the PICTURE, not by which shader stage it
 * happens to feed. The previous flat list was named after the old noise-field
 * architecture ("warp detail", "noise scale"), which meant nobody could predict
 * what a slider did without reading the GLSL.
 *
 * Ranges are set from values that were actually dialled in, not guessed: the
 * tuned drift speed of 0.445 sat near the top of the old 0–0.6 track, so the
 * useful range clearly extended past it.
 */
const GROUPS: { title: string; sliders: Slider[] }[] = [
  {
    title: 'Composition',
    sliders: [
      {
        key: 'cloudScale',
        label: 'Cloud scale',
        min: 0.15,
        max: 2.5,
        step: 0.01,
        hint: 'Lower = fewer, larger cloud masses',
      },
      {
        key: 'coverage',
        label: 'Cloud coverage',
        min: 0,
        max: 1,
        step: 0.01,
        hint: 'How much of the sky is cloud. 0 dissolves the banks, 1 closes them into solid decks',
      },
      { key: 'contrastLow', label: 'Tone floor', min: 0, max: 1, step: 0.01 },
      { key: 'contrastHigh', label: 'Tone ceiling', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: 'Form',
    sliders: [
      {
        key: 'crownDetail',
        label: 'Crown bumpiness',
        min: 0,
        max: 1.5,
        step: 0.01,
        hint: 'Scallops the cloud tops into cauliflower lobes. At 0 they curve smoothly and read as fluid',
      },
    ],
  },
  {
    title: 'Motion',
    sliders: [
      {
        key: 'speed',
        label: 'Drift speed',
        min: 0,
        max: 1.5,
        step: 0.005,
        hint: 'Banks translate across the frame; nothing morphs in place',
      },
    ],
  },
  {
    title: 'Print',
    sliders: [
      // bandCount's max is overridden per-render to
      // min(MAX_PALETTE_STOPS, config.palette.length).
      { key: 'bandCount', label: 'Inks', min: 2, max: 6, step: 1 },
      { key: 'cellSize', label: 'Dot size (px)', min: 1, max: 12, step: 1 },
      { key: 'ditherStrength', label: 'Dither', min: 0, max: 1, step: 0.01 },
      { key: 'grain', label: 'Grain', min: 0, max: 0.2, step: 0.005 },
    ],
  },
]

/** Value pointer strength returns to when the toggle is switched back on. */
const POINTER_ON = 0.6

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

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-50 rounded-full bg-black/50 px-3 py-1.5 font-mono text-xs text-white/60 backdrop-blur transition hover:bg-black/70 hover:text-white"
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

      {GROUPS.map((group) => (
        <section key={group.title} className="mb-4">
          <h3 className="mb-1.5 border-b border-white/10 pb-1 tracking-wide uppercase text-white/40">
            {group.title}
          </h3>
          {group.sliders.map(({ key, label, min, max, step, hint }) => (
            <label key={key} className="mb-2 block" title={hint}>
              <span className="flex justify-between text-white/50">
                {label}
                <span className="text-white/80">
                  {Number(config[key]).toFixed(decimalsForStep(step))}
                </span>
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

          {group.title === 'Motion' && (
            // Pointer interaction is on or off in practice — nobody tunes its
            // magnitude — so it earns a checkbox rather than a slider.
            <label className="mt-1 flex cursor-pointer items-center gap-2 text-white/50">
              <input
                type="checkbox"
                checked={config.pointerStrength > 0}
                onChange={(e) => onChange({ pointerStrength: e.target.checked ? POINTER_ON : 0 })}
                className="cursor-pointer accent-white/80"
              />
              Pointer bends the clouds
            </label>
          )}
        </section>
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
