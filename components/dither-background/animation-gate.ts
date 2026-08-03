export type AnimationGateInputs = {
  /** Canvas intersects the viewport. */
  visible: boolean
  /** document.hidden — the tab is backgrounded. */
  documentHidden: boolean
  /** prefers-reduced-motion: reduce is active. */
  reduceMotion: boolean
  /** Consumer explicitly paused the component. */
  paused: boolean
}

/**
 * Whether the RAF loop should be running. Every input is passed explicitly
 * rather than closed over, so a caller cannot accidentally gate on a stale
 * value — which is exactly how a frozen `paused` once inverted this contract.
 */
export function shouldAnimate({
  visible,
  documentHidden,
  reduceMotion,
  paused,
}: AnimationGateInputs): boolean {
  return visible && !documentHidden && !reduceMotion && !paused
}
