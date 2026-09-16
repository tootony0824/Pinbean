import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCommand,
  createEditCommand,
  createEditHistory,
  createEraseCommand,
  createFloodFillCommand,
  createGrid,
  createPaintCommand,
  createReplaceCommand,
  createSelectionFillCommand,
  executeCommand,
  redoCommand,
  undoCommand,
} from '../src/index.js';

test('paint and erase commands preserve before/after values without mutating the source grid', () => {
  const source = createGrid(2, 1, [1, 2]);
  const paint = createPaintCommand(source, 0, 3);
  assert.deepEqual(paint, { type: 'paint', changes: [{ index: 0, before: 1, after: 3 }] });
  const painted = applyCommand(source, paint);
  assert.deepEqual(Array.from(source.cells), [1, 2]);
  assert.deepEqual(Array.from(painted.cells), [3, 2]);

  const erase = createEraseCommand(painted, 1);
  assert.deepEqual(Array.from(applyCommand(painted, erase).cells), [3, 0]);
});

test('flood fill uses four-way connectivity and does not cross diagonal or different colors', () => {
  const grid = createGrid(3, 3, [
    1, 1, 2,
    1, 2, 1,
    2, 1, 1,
  ]);
  const command = createFloodFillCommand(grid, 0, 3);
  assert.deepEqual(command.changes.map(change => change.index).sort((a, b) => a - b), [0, 1, 3]);
  assert.deepEqual(Array.from(applyCommand(grid, command).cells), [
    3, 3, 2,
    3, 2, 1,
    2, 1, 1,
  ]);
});

test('replace and selection fill create compact commands and omit no-op cells', () => {
  const grid = createGrid(4, 1, [1, 2, 1, 3]);
  const replace = createReplaceCommand(grid, 1, 2);
  assert.deepEqual(replace.changes, [
    { index: 0, before: 1, after: 2 },
    { index: 2, before: 1, after: 2 },
  ]);
  const selection = createSelectionFillCommand(grid, [0, 1, 3], 3);
  assert.deepEqual(selection.changes, [
    { index: 0, before: 1, after: 3 },
    { index: 1, before: 2, after: 3 },
  ]);
});

test('stale and malformed commands fail atomically', () => {
  const grid = createGrid(2, 1, [1, 2]);
  const command = createPaintCommand(grid, 0, 3);
  const changedElsewhere = createGrid(2, 1, [4, 2]);
  assert.throws(() => applyCommand(changedElsewhere, command), /stale command/);
  assert.deepEqual(Array.from(changedElsewhere.cells), [4, 2]);
  assert.throws(() => createEditCommand(grid, 'paint', [
    { index: 0, after: 2 },
    { index: 0, after: 3 },
  ]), /duplicate change index/);
  assert.throws(() => applyCommand(grid, {
    type: 'paint',
    changes: [{ index: 0, before: 1, after: 1 }],
  }), /no-op/);
  assert.throws(() => applyCommand(grid, {
    type: 'invalid' as never,
    changes: [{ index: 0, before: 1, after: 2 }],
  }), /unsupported edit command type/);
  assert.throws(() => applyCommand(grid, command, 'sideways' as never), /unsupported command direction/);
});

test('one history handles execute, undo, redo, branch clearing and limits', () => {
  let grid = createGrid(3, 1, [1, 1, 1]);
  let history = createEditHistory(2);

  ({ grid, history } = executeCommand(grid, history, createPaintCommand(grid, 0, 2)));
  ({ grid, history } = executeCommand(grid, history, createPaintCommand(grid, 1, 3)));
  ({ grid, history } = executeCommand(grid, history, createPaintCommand(grid, 2, 4)));
  assert.deepEqual(Array.from(grid.cells), [2, 3, 4]);
  assert.equal(history.undoStack.length, 2);

  ({ grid, history } = undoCommand(grid, history));
  assert.deepEqual(Array.from(grid.cells), [2, 3, 1]);
  assert.equal(history.redoStack.length, 1);
  ({ grid, history } = redoCommand(grid, history));
  assert.deepEqual(Array.from(grid.cells), [2, 3, 4]);

  ({ grid, history } = undoCommand(grid, history));
  ({ grid, history } = executeCommand(grid, history, createEraseCommand(grid, 1)));
  assert.deepEqual(Array.from(grid.cells), [2, 0, 1]);
  assert.equal(history.redoStack.length, 0);
});

