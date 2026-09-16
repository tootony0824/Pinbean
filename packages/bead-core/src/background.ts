import { validateGrid } from './grid.js';
import { createEditCommand } from './editing.js';
import { EMPTY_CELL, type BeadGrid, type EditCommand } from './types.js';

export interface BackgroundRemovalResult {
  command: EditCommand;
  backgroundPaletteIndex: number | null;
  removed: number;
}

function borderIndexes(grid: BeadGrid): number[] {
  const indexes: number[] = [];
  for (let x = 0; x < grid.width; x += 1) {
    indexes.push(x);
    if (grid.height > 1) indexes.push((grid.height - 1) * grid.width + x);
  }
  for (let y = 1; y < grid.height - 1; y += 1) {
    indexes.push(y * grid.width);
    if (grid.width > 1) indexes.push(y * grid.width + grid.width - 1);
  }
  return indexes;
}

export function createBackgroundRemovalCommand(grid: BeadGrid): BackgroundRemovalResult {
  validateGrid(grid);
  const counts = new Map<number, number>();
  for (const index of borderIndexes(grid)) {
    const value = grid.cells[index] ?? EMPTY_CELL;
    if (value !== EMPTY_CELL) counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  let backgroundPaletteIndex: number | null = null;
  let highestCount = -1;
  for (const [paletteIndex, count] of counts) {
    if (count > highestCount) {
      backgroundPaletteIndex = paletteIndex;
      highestCount = count;
    }
  }
  if (backgroundPaletteIndex === null) {
    return { command: { type: 'background-remove', changes: [] }, backgroundPaletteIndex, removed: 0 };
  }

  const visited = new Uint8Array(grid.cells.length);
  const stack = borderIndexes(grid).filter(index => grid.cells[index] === backgroundPaletteIndex);
  const updates: Array<{ index: number; after: number }> = [];
  while (stack.length > 0) {
    const index = stack.pop();
    if (index === undefined || visited[index]) continue;
    visited[index] = 1;
    if (grid.cells[index] !== backgroundPaletteIndex) continue;
    updates.push({ index, after: EMPTY_CELL });
    const x = index % grid.width;
    const y = Math.floor(index / grid.width);
    if (x > 0) stack.push(index - 1);
    if (x + 1 < grid.width) stack.push(index + 1);
    if (y > 0) stack.push(index - grid.width);
    if (y + 1 < grid.height) stack.push(index + grid.width);
  }

  const command = createEditCommand(grid, 'background-remove', updates);
  return { command, backgroundPaletteIndex, removed: command.changes.length };
}

