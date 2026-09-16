import { colorDistance } from './color.js';
import { cloneGrid, validateGrid } from './grid.js';
import { EMPTY_CELL, type BeadGrid, type Palette } from './types.js';

export function mergeSimilarColors(grid: BeadGrid, palette: Palette, threshold: number): BeadGrid {
  validateGrid(grid, palette.colors.length);
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new RangeError('similarity threshold must be non-negative');
  }
  const counts = new Uint32Array(palette.colors.length + 1);
  const firstSeen = new Int32Array(palette.colors.length + 1);
  firstSeen.fill(-1);
  for (let cellIndex = 0; cellIndex < grid.cells.length; cellIndex += 1) {
    const paletteIndex = grid.cells[cellIndex] ?? EMPTY_CELL;
    if (paletteIndex === EMPTY_CELL) continue;
    counts[paletteIndex] = (counts[paletteIndex] ?? 0) + 1;
    if (firstSeen[paletteIndex] === -1) firstSeen[paletteIndex] = cellIndex;
  }
  const byFrequency = Array.from({ length: palette.colors.length }, (_, index) => index + 1)
    .filter(index => (counts[index] ?? 0) > 0)
    .sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0)
      || (firstSeen[a] ?? 0) - (firstSeen[b] ?? 0)
      || a - b);
  const replacement = new Uint16Array(palette.colors.length + 1);
  const replaced = new Uint8Array(palette.colors.length + 1);

  for (let i = 0; i < byFrequency.length; i += 1) {
    const frequentIndex = byFrequency[i];
    if (frequentIndex === undefined || replaced[frequentIndex]) continue;
    const frequentColor = palette.colors[frequentIndex - 1];
    if (!frequentColor) continue;
    for (let j = i + 1; j < byFrequency.length; j += 1) {
      const lowerIndex = byFrequency[j];
      if (lowerIndex === undefined || replaced[lowerIndex]) continue;
      const lowerColor = palette.colors[lowerIndex - 1];
      if (!lowerColor) continue;
      if (colorDistance(frequentColor.rgb, lowerColor.rgb) < threshold) {
        replaced[lowerIndex] = 1;
        replacement[lowerIndex] = frequentIndex;
      }
    }
  }
  const merged = cloneGrid(grid);
  for (let index = 0; index < merged.cells.length; index += 1) {
    const cell = merged.cells[index] ?? EMPTY_CELL;
    const target = replacement[cell] ?? EMPTY_CELL;
    if (target !== EMPTY_CELL) merged.cells[index] = target;
  }
  return merged;
}
