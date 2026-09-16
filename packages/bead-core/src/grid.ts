import { EMPTY_CELL, type BeadGrid } from './types.js';

export const MAX_GRID_CELLS = 1_000_000;

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
}

export function createGrid(width: number, height: number, cells?: ArrayLike<number>): BeadGrid {
  assertPositiveInteger(width, 'width');
  assertPositiveInteger(height, 'height');
  const length = width * height;
  if (!Number.isSafeInteger(length) || length > MAX_GRID_CELLS) {
    throw new RangeError(`grid exceeds ${MAX_GRID_CELLS} cells`);
  }
  if (cells && cells.length !== length) {
    throw new RangeError(`cells length must be ${length}`);
  }
  if (cells) {
    for (let index = 0; index < cells.length; index += 1) {
      const value = cells[index];
      if (value === undefined || !Number.isInteger(value) || value < 0 || value > 65_535) {
        throw new RangeError(`cell at index ${index} must be a Uint16 integer`);
      }
    }
  }
  return {
    width,
    height,
    cells: cells ? Uint16Array.from(cells) : new Uint16Array(length),
  };
}

export function gridIndex(grid: BeadGrid, x: number, y: number): number {
  if (!Number.isInteger(x) || !Number.isInteger(y)
    || x < 0 || x >= grid.width || y < 0 || y >= grid.height) {
    throw new RangeError(`grid coordinate out of bounds: ${x},${y}`);
  }
  return y * grid.width + x;
}

export function getCell(grid: BeadGrid, x: number, y: number): number {
  return grid.cells[gridIndex(grid, x, y)] ?? EMPTY_CELL;
}

export function cloneGrid(grid: BeadGrid): BeadGrid {
  return createGrid(grid.width, grid.height, grid.cells);
}

export function validateGrid(grid: BeadGrid, paletteSize?: number): void {
  assertPositiveInteger(grid.width, 'grid.width');
  assertPositiveInteger(grid.height, 'grid.height');
  const length = grid.width * grid.height;
  if (!Number.isSafeInteger(length) || length > MAX_GRID_CELLS) {
    throw new RangeError(`grid exceeds ${MAX_GRID_CELLS} cells`);
  }
  if (grid.cells.length !== length) {
    throw new RangeError('grid cells length does not match its dimensions');
  }
  if (paletteSize !== undefined && (!Number.isInteger(paletteSize) || paletteSize < 0 || paletteSize > 65_535)) {
    throw new RangeError('palette size must be an integer from 0 to 65535');
  }
  if (paletteSize !== undefined) {
    for (const cell of grid.cells) {
      if (cell > paletteSize) {
        throw new RangeError(`palette index ${cell} exceeds palette size ${paletteSize}`);
      }
    }
  }
}
