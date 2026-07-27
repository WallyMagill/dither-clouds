import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const DIR = join(process.cwd(), 'components/dither-background')

// The engine must stay liftable into a non-React project. If one of these
// files ever imports React, the portability claim quietly becomes false.
const ENGINE_FILES = [
  'animation-gate.ts',
  'bayer.ts',
  'config.ts',
  'engine.ts',
  'palettes.ts',
  'renderer.ts',
  'shader.ts',
  'viewport.ts',
]

// `index.ts` re-exports the React component from `dither-background.tsx`, so
// it is exempt from the no-React rule below — but it must still show up
// somewhere on this list, rather than being silently filtered out of the
// disk scan, so a stray new file can't hide from either check.
const REACT_ENTRY_FILES = ['index.ts']

describe('engine portability', () => {
  test('the engine file list matches what is on disk', () => {
    const onDisk = readdirSync(DIR)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .sort()
    expect(onDisk).toEqual([...ENGINE_FILES, ...REACT_ENTRY_FILES].sort())
  })

  test.each(ENGINE_FILES)('%s does not import react', (file) => {
    const source = readFileSync(join(DIR, file), 'utf8')
    expect(source).not.toMatch(/from\s+['"]react/)
    expect(source).not.toMatch(/require\(['"]react/)
  })

  test.each(ENGINE_FILES)('%s does not import next', (file) => {
    const source = readFileSync(join(DIR, file), 'utf8')
    expect(source).not.toMatch(/from\s+['"]next/)
  })
})
