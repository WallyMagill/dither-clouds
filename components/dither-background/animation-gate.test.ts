import { describe, expect, test } from 'vitest'
import { type AnimationGateInputs, shouldAnimate } from './animation-gate'

const ALL_CLEAR: AnimationGateInputs = {
  visible: true,
  documentHidden: false,
  reduceMotion: false,
  paused: false,
}

// The value each input takes when it is the one doing the blocking.
// `visible` blocks by being false; the other three block by being true.
const BLOCKING_VALUE: Record<keyof AnimationGateInputs, boolean> = {
  visible: false,
  documentHidden: true,
  reduceMotion: true,
  paused: true,
}

const KEYS = Object.keys(BLOCKING_VALUE) as (keyof AnimationGateInputs)[]

const PAIRS = KEYS.flatMap((a, i) => KEYS.slice(i + 1).map((b) => [a, b] as const))

describe('shouldAnimate', () => {
  test('animates when every input is clear', () => {
    expect(shouldAnimate(ALL_CLEAR)).toBe(true)
  })

  test.each(KEYS)('blocks when only "%s" is blocking', (key) => {
    expect(shouldAnimate({ ...ALL_CLEAR, [key]: BLOCKING_VALUE[key] })).toBe(false)
  })

  // Every pairwise combination of blockers must still return false: no two
  // simultaneous blockers can cancel each other out.
  test.each(PAIRS)('blocks when both "%s" and "%s" are blocking', (a, b) => {
    expect(
      shouldAnimate({ ...ALL_CLEAR, [a]: BLOCKING_VALUE[a], [b]: BLOCKING_VALUE[b] }),
    ).toBe(false)
  })
})
