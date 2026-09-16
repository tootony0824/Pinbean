import type { BeadGrid, BeadPattern } from './types.js';
import { validateGrid } from './grid.js';
import { parsePaletteTable } from './validation.js';

function updateFnv1a(hash: number, byte: number): number {
  return Math.imul((hash ^ byte) >>> 0, 0x01000193) >>> 0;
}

export function hashGrid(grid: BeadGrid): string {
  validateGrid(grid);
  let hash = 0x811c9dc5;
  const header = [
    grid.width & 0xff,
    (grid.width >>> 8) & 0xff,
    (grid.width >>> 16) & 0xff,
    (grid.width >>> 24) & 0xff,
    grid.height & 0xff,
    (grid.height >>> 8) & 0xff,
    (grid.height >>> 16) & 0xff,
    (grid.height >>> 24) & 0xff,
  ];
  for (const byte of header) hash = updateFnv1a(hash, byte);
  for (const cell of grid.cells) {
    hash = updateFnv1a(hash, cell & 0xff);
    hash = updateFnv1a(hash, (cell >>> 8) & 0xff);
  }
  return hash.toString(16).padStart(8, '0');
}

function updateString(hash: number, value: string): number {
  let updated = hash;
  updated = updateFnv1a(updated, value.length & 0xff);
  updated = updateFnv1a(updated, (value.length >>> 8) & 0xff);
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    updated = updateFnv1a(updated, codeUnit & 0xff);
    updated = updateFnv1a(updated, (codeUnit >>> 8) & 0xff);
  }
  return updated;
}

export function hashPattern(pattern: BeadPattern): string {
  const paletteTable = parsePaletteTable(pattern.paletteTable, 'pattern palette table');
  validateGrid(pattern.grid, paletteTable.length - 1);
  let hash = Number.parseInt(hashGrid(pattern.grid), 16) >>> 0;
  for (const id of paletteTable) {
    hash = updateString(hash, id);
  }
  return hash.toString(16).padStart(8, '0');
}

export function hashPatternContent(pattern: BeadPattern): string {
  const paletteTable = parsePaletteTable(pattern.paletteTable, 'pattern palette table');
  validateGrid(pattern.grid, paletteTable.length - 1);
  let hash = 0x811c9dc5;
  const header = [
    pattern.grid.width & 0xff,
    (pattern.grid.width >>> 8) & 0xff,
    (pattern.grid.width >>> 16) & 0xff,
    (pattern.grid.width >>> 24) & 0xff,
    pattern.grid.height & 0xff,
    (pattern.grid.height >>> 8) & 0xff,
    (pattern.grid.height >>> 16) & 0xff,
    (pattern.grid.height >>> 24) & 0xff,
  ];
  for (const byte of header) hash = updateFnv1a(hash, byte);
  for (const paletteIndex of pattern.grid.cells) {
    const colorId = paletteIndex === 0 ? '' : paletteTable[paletteIndex];
    if (colorId === undefined) throw new Error(`pattern references unavailable palette index ${paletteIndex}`);
    hash = updateString(hash, colorId);
  }
  return hash.toString(16).padStart(8, '0');
}
