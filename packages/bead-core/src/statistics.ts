import { validateGrid } from './grid.js';
import { EMPTY_CELL, type BeadGrid, type BeadStatistics } from './types.js';

export function calculateStatistics(grid: BeadGrid, paletteSize: number): BeadStatistics {
  if (!Number.isInteger(paletteSize) || paletteSize < 0) {
    throw new RangeError('palette size must be a non-negative integer');
  }
  validateGrid(grid, paletteSize);
  const counts = new Uint32Array(paletteSize + 1);
  let total = 0;
  for (const paletteIndex of grid.cells) {
    if (paletteIndex === EMPTY_CELL) continue;
    counts[paletteIndex] = (counts[paletteIndex] ?? 0) + 1;
    total += 1;
  }
  const colors = Array.from({ length: paletteSize }, (_, index) => index + 1)
    .filter(paletteIndex => (counts[paletteIndex] ?? 0) > 0)
    .map(paletteIndex => ({ paletteIndex, count: counts[paletteIndex] ?? 0 }))
    .sort((a, b) => b.count - a.count || a.paletteIndex - b.paletteIndex);
  return { total, colors };
}
