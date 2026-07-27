'use client'

import { useState } from 'react'
import { ControlPanel } from '@/components/control-panel'
import { DEFAULT_CONFIG, DitherBackground, resolveConfig, type DitherConfig } from '@/components/dither-background'

export default function Home() {
  const [config, setConfig] = useState<DitherConfig>(DEFAULT_CONFIG)

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <DitherBackground config={config} />

      {/* Sample overlay content, composed like the reference, so legibility
          over the field is verifiable at a glance rather than assumed. */}
      <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center font-sans">
        {/* Darkening scrim behind the text block, matching how the reference
            image keeps its overlay legible over a light palette stop. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-1/2 h-[60vh] -translate-y-1/2 bg-gradient-to-b from-transparent via-black/45 to-transparent"
        />
        <h1 className="relative text-6xl font-black tracking-tight text-white [text-shadow:0_2px_12px_rgb(0_0_0_/_0.6)] sm:text-8xl">
          posterized
        </h1>
        <p className="relative mt-2 max-w-md text-lg font-semibold text-white/90 [text-shadow:0_2px_12px_rgb(0_0_0_/_0.6)] sm:text-xl">
          fluid noise with ordered halftone dithering
        </p>
      </div>

      <ControlPanel config={config} onChange={(next) => setConfig((c) => resolveConfig({ ...c, ...next }))} />
    </main>
  )
}
