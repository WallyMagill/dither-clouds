/**
 * Recursive Bayer (ordered dither) matrix generation.
 *
 * M(1) = [[0, 2], [3, 1]]
 * M(n) is built from M(n-1) by scaling each entry by 4 and adding the M(1)
 * offset for the corresponding quadrant.
 *
 * Values are returned normalized to (0, 1) via (v + 0.5) / count, which centers
 * the thresholds so the matrix mean is exactly 0.5 — an unbiased matrix, so
 * dithering does not darken or lighten the field overall.
 */
export function generateBayer(order: number): number[] {
  if (!Number.isInteger(order) || order < 1) {
    throw new Error(`Bayer order must be an integer >= 1, received ${order}`)
  }

  let matrix = [
    [0, 2],
    [3, 1],
  ]

  for (let step = 1; step < order; step++) {
    const size = matrix.length
    const next: number[][] = Array.from({ length: size * 2 }, () => new Array(size * 2).fill(0))
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const base = matrix[y][x] * 4
        next[y][x] = base + 0
        next[y][x + size] = base + 2
        next[y + size][x] = base + 3
        next[y + size][x + size] = base + 1
      }
    }
    matrix = next
  }

  const flat = matrix.flat()
  const count = flat.length
  return flat.map((v) => (v + 0.5) / count)
}

export const BAYER_4 = generateBayer(2)
export const BAYER_8 = generateBayer(3)
