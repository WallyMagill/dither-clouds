import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const DIR = join(process.cwd(), 'components/dither-background')

// The engine must stay liftable into a non-React project. If one of these
// files ever imports React, the portability claim quietly becomes false.
const ENGINE_FILES = ['bayer.ts', 'config.ts', 'palettes.ts', 'renderer.ts', 'shader.ts', 'viewport.ts']

describe('engine portability', () => {
  test('the engine file list matches what is on disk', () => {
    const onDisk = readdirSync(DIR)
      // `index.ts` (Task 8) is the public entry point that re-exports the
      // React component from `dither-background.tsx` — it is deliberately
      // not part of the portable engine and is excluded the same way the
      // `.tsx` file is excluded by the `.ts`-only filter below.
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'index.ts')
      .sort()
    expect(onDisk).toEqual([...ENGINE_FILES].sort())
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
