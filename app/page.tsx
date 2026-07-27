'use client'

import { useState } from 'react'
import { ControlPanel } from '@/components/control-panel'
import { DEFAULT_CONFIG, DitherBackground, type DitherConfig } from '@/components/dither-background'

export default function Home() {
  const [config, setConfig] = useState<DitherConfig>(DEFAULT_CONFIG)

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <DitherBackground config={config} />

      {/* Sample overlay content, composed like the reference, so legibility
          over the field is verifiable at a glance rather than assumed. */}
      <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center">
        <h1 className="text-6xl font-black tracking-tight text-white drop-shadow-lg sm:text-8xl">
          posterized
        </h1>
        <p className="mt-2 max-w-md text-lg font-semibold text-white/90 drop-shadow-md sm:text-xl">
          fluid noise with ordered halftone dithering
        </p>
      </div>

      <ControlPanel config={config} onChange={(next) => setConfig((c) => ({ ...c, ...next }))} />
    </main>
  )
}
