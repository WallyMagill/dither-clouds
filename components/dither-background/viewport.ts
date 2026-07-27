/** Rendering above 2x costs fill rate with no visible benefit at this dot pitch. */
export const MAX_DPR = 2

export function computeDrawingBufferSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): { width: number; height: number } {
  const dpr =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? Math.min(devicePixelRatio, MAX_DPR)
      : 1
  const width = Number.isFinite(cssWidth) ? cssWidth : 1
  const height = Number.isFinite(cssHeight) ? cssHeight : 1

  return {
    width: Math.max(1, Math.round(width * dpr)),
    height: Math.max(1, Math.round(height * dpr)),
  }
}

/** Frame-rate-naive exponential ease. Factor is the fraction of remaining distance covered per call. */
export function easeToward(current: number, target: number, factor: number): number {
  return current + (target - current) * factor
}

/**
 * Maps a client-space pointer position to -1..1 on both axes, y flipped so
 * positive is up — matching gl_FragCoord's origin-at-bottom-left convention,
 * so pointer motion in the shader agrees with what the user sees.
 */
export function normalizePointer(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): [number, number] {
  const width = rect.width || 1
  const height = rect.height || 1
  const x = ((clientX - rect.left) / width) * 2 - 1
  // Written as `1 - t * 2` rather than `-(t * 2 - 1)` so the exact-center
  // case (t = 0.5) yields +0 instead of -0; negating zero would make it
  // fail a strict equality check against the origin.
  const y = 1 - ((clientY - rect.top) / height) * 2
  return [x, y]
}
