'use client'

import { useState } from 'react'
import { ControlPanel } from '@/components/control-panel'
import { DEFAULT_CONFIG, DitherBackground, resolveConfig, type DitherConfig } from '@/components/dither-background'

export default function Home() {
  const [config, setConfig] = useState<DitherConfig>(DEFAULT_CONFIG)

  // Full-bleed background and nothing else — no headline, no scrim, no visible
  // chrome. The control panel is still here but renders nothing until the
  // backtick key opens it, so the page reads as the finished artwork.
  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <DitherBackground config={config} />
      <ControlPanel config={config} onChange={(next) => setConfig((c) => resolveConfig({ ...c, ...next }))} />
    </main>
  )
}
