/**
 * Framework-agnostic engine surface. Everything re-exported here (and
 * everything it in turn imports) has zero React or Next.js imports — see
 * `portability.test.ts` — so this file is safe to import from a non-React
 * project without dragging React into its module graph.
 *
 * `index.ts` is the React-flavored entry point for consumers of
 * `<DitherBackground>`; import from here instead when lifting just the
 * rendering engine into another framework.
 */
export { createRenderer } from './renderer'
export type { DitherRenderer } from './renderer'

export {
  DEFAULT_CONFIG,
  MAX_PALETTE_STOPS,
  resampleIndices,
  resolveConfig,
} from './config'
export type { DitherConfig, DitherConfigInput } from './config'

export { PALETTES, PALETTE_NAMES } from './palettes'
export type { PaletteName } from './palettes'

export { shouldAnimate } from './animation-gate'
export type { AnimationGateInputs } from './animation-gate'

export { MAX_DPR, computeDrawingBufferSize, easeToward, normalizePointer } from './viewport'
