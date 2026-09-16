import { cloneGrid, validateGrid } from './grid.js';
import {
  EMPTY_CELL,
  type BeadGrid,
  type CellChange,
  type EditCommand,
  type EditCommandType,
  type EditHistory,
} from './types.js';

export interface EditResult {
  grid: BeadGrid;
  history: EditHistory;
  command?: EditCommand;
}

function assertCellValue(value: number, label: string): void {
  if (!Number.isInteger(value) || value < EMPTY_CELL || value > 65_535) {
    throw new RangeError(`${label} must be a Uint16 integer`);
  }
}

function validateCommand(grid: BeadGrid, command: EditCommand): void {
  validateGrid(grid);
  if (!['paint', 'erase', 'fill', 'replace', 'selection-fill', 'background-remove'].includes(command.type)) {
    throw new Error(`unsupported edit command type: ${String(command.type)}`);
  }
  const indexes = new Set<number>();
  for (const change of command.changes) {
    if (!Number.isInteger(change.index) || change.index < 0 || change.index >= grid.cells.length) {
      throw new RangeError(`change index out of bounds: ${change.index}`);
    }
    if (indexes.has(change.index)) throw new Error(`duplicate change index: ${change.index}`);
    indexes.add(change.index);
    assertCellValue(change.before, 'change.before');
    assertCellValue(change.after, 'change.after');
    if (change.before === change.after) throw new Error(`change at index ${change.index} is a no-op`);
  }
}

export function createEditCommand(
  grid: BeadGrid,
  type: EditCommandType,
  updates: readonly { index: number; after: number }[],
): EditCommand {
  validateGrid(grid);
  const indexes = new Set<number>();
  const changes: CellChange[] = [];
  for (const update of updates) {
    if (!Number.isInteger(update.index) || update.index < 0 || update.index >= grid.cells.length) {
      throw new RangeError(`change index out of bounds: ${update.index}`);
    }
    if (indexes.has(update.index)) throw new Error(`duplicate change index: ${update.index}`);
    indexes.add(update.index);
    assertCellValue(update.after, 'change.after');
    const before = grid.cells[update.index] ?? EMPTY_CELL;
    if (before !== update.after) changes.push({ index: update.index, before, after: update.after });
  }
  return { type, changes };
}

export function createPaintCommand(grid: BeadGrid, index: number, paletteIndex: number): EditCommand {
  if (paletteIndex === EMPTY_CELL) throw new RangeError('paint palette index must be non-zero');
  return createEditCommand(grid, 'paint', [{ index, after: paletteIndex }]);
}

export function createEraseCommand(grid: BeadGrid, index: number): EditCommand {
  return createEditCommand(grid, 'erase', [{ index, after: EMPTY_CELL }]);
}

export function createSelectionFillCommand(
  grid: BeadGrid,
  indexes: readonly number[],
  paletteIndex: number,
): EditCommand {
  return createEditCommand(grid, 'selection-fill', indexes.map(index => ({ index, after: paletteIndex })));
}

export function createReplaceCommand(
  grid: BeadGrid,
  sourcePaletteIndex: number,
  targetPaletteIndex: number,
): EditCommand {
  assertCellValue(sourcePaletteIndex, 'source palette index');
  assertCellValue(targetPaletteIndex, 'target palette index');
  const updates: Array<{ index: number; after: number }> = [];
  grid.cells.forEach((cell, index) => {
    if (cell === sourcePaletteIndex) updates.push({ index, after: targetPaletteIndex });
  });
  return createEditCommand(grid, 'replace', updates);
}

export function createFloodFillCommand(
  grid: BeadGrid,
  startIndex: number,
  targetPaletteIndex: number,
): EditCommand {
  validateGrid(grid);
  assertCellValue(targetPaletteIndex, 'target palette index');
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= grid.cells.length) {
    throw new RangeError(`start index out of bounds: ${startIndex}`);
  }
  const sourcePaletteIndex = grid.cells[startIndex] ?? EMPTY_CELL;
  if (sourcePaletteIndex === targetPaletteIndex) return { type: 'fill', changes: [] };

  const visited = new Uint8Array(grid.cells.length);
  const stack = [startIndex];
  const updates: Array<{ index: number; after: number }> = [];
  while (stack.length > 0) {
    const index = stack.pop();
    if (index === undefined || visited[index]) continue;
    visited[index] = 1;
    if (grid.cells[index] !== sourcePaletteIndex) continue;
    updates.push({ index, after: targetPaletteIndex });
    const x = index % grid.width;
    const y = Math.floor(index / grid.width);
    if (x > 0) stack.push(index - 1);
    if (x + 1 < grid.width) stack.push(index + 1);
    if (y > 0) stack.push(index - grid.width);
    if (y + 1 < grid.height) stack.push(index + grid.width);
  }
  return createEditCommand(grid, 'fill', updates);
}

export function applyCommand(
  grid: BeadGrid,
  command: EditCommand,
  direction: 'forward' | 'reverse' = 'forward',
): BeadGrid {
  if (direction !== 'forward' && direction !== 'reverse') {
    throw new Error(`unsupported command direction: ${String(direction)}`);
  }
  validateCommand(grid, command);
  for (const change of command.changes) {
    const expected = direction === 'forward' ? change.before : change.after;
    if (grid.cells[change.index] !== expected) {
      throw new Error(`stale command at index ${change.index}: expected ${expected}, got ${grid.cells[change.index]}`);
    }
  }
  const next = cloneGrid(grid);
  for (const change of command.changes) {
    next.cells[change.index] = direction === 'forward' ? change.after : change.before;
  }
  return next;
}

export function createEditHistory(limit = 100): EditHistory {
  if (!Number.isInteger(limit) || limit <= 0) throw new RangeError('history limit must be a positive integer');
  return { limit, undoStack: [], redoStack: [] };
}

export function executeCommand(grid: BeadGrid, history: EditHistory, command: EditCommand): EditResult {
  if (command.changes.length === 0) return { grid, history };
  const nextGrid = applyCommand(grid, command);
  return {
    grid: nextGrid,
    history: {
      limit: history.limit,
      undoStack: [...history.undoStack, command].slice(-history.limit),
      redoStack: [],
    },
    command,
  };
}

export function undoCommand(grid: BeadGrid, history: EditHistory): EditResult {
  const command = history.undoStack[history.undoStack.length - 1];
  if (!command) return { grid, history };
  return {
    grid: applyCommand(grid, command, 'reverse'),
    history: {
      limit: history.limit,
      undoStack: history.undoStack.slice(0, -1),
      redoStack: [...history.redoStack, command].slice(-history.limit),
    },
    command,
  };
}

export function redoCommand(grid: BeadGrid, history: EditHistory): EditResult {
  const command = history.redoStack[history.redoStack.length - 1];
  if (!command) return { grid, history };
  return {
    grid: applyCommand(grid, command),
    history: {
      limit: history.limit,
      undoStack: [...history.undoStack, command].slice(-history.limit),
      redoStack: history.redoStack.slice(0, -1),
    },
    command,
  };
}
