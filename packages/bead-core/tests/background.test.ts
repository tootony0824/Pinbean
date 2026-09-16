import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCommand,
  calculateStatistics,
  createBackgroundRemovalCommand,
  createGrid,
} from '../src/index.js';

test('background removal erases only the dominant edge-connected color and keeps a white subject', () => {
  const grid = createGrid(5, 5, [
    1, 1, 1, 1, 1,
    1, 2, 2, 2, 1,
    1, 2, 3, 2, 1,
    1, 2, 2, 2, 1,
    1, 1, 1, 1, 1,
  ]);
  const result = createBackgroundRemovalCommand(grid);
  const removed = applyCommand(grid, result.command);
  assert.equal(result.backgroundPaletteIndex, 1);
  assert.equal(result.removed, 16);
  assert.deepEqual(Array.from(removed.cells), [
    0, 0, 0, 0, 0,
    0, 2, 2, 2, 0,
    0, 2, 3, 2, 0,
    0, 2, 2, 2, 0,
    0, 0, 0, 0, 0,
  ]);
  assert.deepEqual(calculateStatistics(removed, 3), {
    total: 9,
    colors: [
      { paletteIndex: 2, count: 8 },
      { paletteIndex: 3, count: 1 },
    ],
  });
});

test('a closed hole matching the background color is retained', () => {
  const grid = createGrid(5, 5, [
    1, 1, 1, 1, 1,
    1, 2, 2, 2, 1,
    1, 2, 1, 2, 1,
    1, 2, 2, 2, 1,
    1, 1, 1, 1, 1,
  ]);
  const result = createBackgroundRemovalCommand(grid);
  const removed = applyCommand(grid, result.command);
  assert.equal(removed.cells[12], 1);
  assert.equal(result.removed, 16);
});

test('four different corner colors use deterministic border encounter order on a tie', () => {
  const grid = createGrid(2, 2, [1, 2, 3, 4]);
  const result = createBackgroundRemovalCommand(grid);
  assert.equal(result.backgroundPaletteIndex, 1);
  assert.equal(result.removed, 1);
});

test('an empty border produces a no-op command', () => {
  const grid = createGrid(3, 3, [
    0, 0, 0,
    0, 2, 0,
    0, 0, 0,
  ]);
  const result = createBackgroundRemovalCommand(grid);
  assert.equal(result.backgroundPaletteIndex, null);
  assert.equal(result.removed, 0);
  assert.equal(result.command.changes.length, 0);
});

test('V1 gradient backgrounds remove only the exact dominant palette index', () => {
  const grid = createGrid(4, 3, [
    1, 1, 2, 2,
    1, 3, 3, 2,
    1, 1, 2, 2,
  ]);
  const result = createBackgroundRemovalCommand(grid);
  const removed = applyCommand(grid, result.command);
  assert.equal(result.backgroundPaletteIndex, 1);
  assert.equal(result.removed, 5);
  assert.equal(Array.from(removed.cells).filter(cell => cell === 2).length, 5);
});
