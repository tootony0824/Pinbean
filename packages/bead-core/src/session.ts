import { createBackgroundRemovalCommand } from './background.js';
import { createGrid } from './grid.js';
import { calculateStatistics } from './statistics.js';
import { validateBeadPattern } from './validation.js';
import {
  EMPTY_CELL,
  type BeadPattern,
  type BeadStatistics,
  type EditCommandType,
  type Palette,
} from './types.js';

export type PatternCellColorId = string | null;

export interface PatternCellChange {
  readonly index: number;
  readonly beforeColorId: PatternCellColorId;
  readonly afterColorId: PatternCellColorId;
}

export interface PatternEditCommand {
  readonly type: EditCommandType;
  readonly changes: readonly PatternCellChange[];
}

export interface PatternEditHistory {
  readonly limit: number;
  readonly undoStack: readonly PatternEditCommand[];
  readonly redoStack: readonly PatternEditCommand[];
}

export interface PatternSession {
  history: PatternEditHistory;
  palette: Palette;
  pattern: BeadPattern;
  statistics: BeadStatistics;
}

export interface PatternSessionResult {
  changed: number;
  command?: PatternEditCommand;
  session: PatternSession;
}

export interface PatternBackgroundRemovalResult extends PatternSessionResult {
  backgroundColorId: string | null;
  backgroundPaletteIndex: number | null;
}

function assertGridIndex(pattern: BeadPattern, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= pattern.grid.cells.length) {
    throw new RangeError(`cell index out of bounds: ${index}`);
  }
}

function assertHistoryLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit <= 0) throw new RangeError('history limit must be a positive integer');
}

function paletteColorIds(palette: Palette): Set<string> {
  return new Set(palette.colors.map(color => color.id));
}

function assertPatternPalette(pattern: BeadPattern, palette: Palette): void {
  validateBeadPattern(pattern, palette);
}

function cellColorId(pattern: BeadPattern, index: number): PatternCellColorId {
  assertGridIndex(pattern, index);
  const paletteIndex = pattern.grid.cells[index] ?? EMPTY_CELL;
  if (paletteIndex === EMPTY_CELL) return null;
  const colorId = pattern.paletteTable[paletteIndex];
  if (!colorId) throw new Error(`pattern references unavailable palette index: ${paletteIndex}`);
  return colorId;
}

export function getPatternCellColorId(pattern: BeadPattern, index: number): PatternCellColorId {
  return cellColorId(pattern, index);
}

export function getPatternPaletteIndex(pattern: BeadPattern, colorId: string): number | null {
  if (!colorId) throw new Error('color id must not be empty');
  const index = pattern.paletteTable.indexOf(colorId);
  return index > 0 ? index : null;
}

export function createPatternEditHistory(limit = 100): PatternEditHistory {
  assertHistoryLimit(limit);
  return freezeHistory({ limit, undoStack: [], redoStack: [] });
}

function snapshotCommand(command: PatternEditCommand): PatternEditCommand {
  return Object.freeze({ type: command.type, changes: Object.freeze(command.changes.map(change => Object.freeze({ ...change }))) });
}

function freezeHistory(history: PatternEditHistory): PatternEditHistory {
  return Object.freeze({ limit: history.limit, undoStack: Object.freeze(history.undoStack.map(snapshotCommand)), redoStack: Object.freeze(history.redoStack.map(snapshotCommand)) });
}

export function createPatternSession(
  pattern: BeadPattern,
  palette: Palette,
  historyLimit = 100,
): PatternSession {
  assertPatternPalette(pattern, palette);
  return {
    history: createPatternEditHistory(historyLimit),
    palette,
    pattern,
    statistics: calculateStatistics(pattern.grid, pattern.paletteTable.length - 1),
  };
}

export function assertPatternSessionColor(session: PatternSession, colorId: string): void {
  if (!colorId) throw new Error('color id must not be empty');
  if (!session.palette.colors.some(color => color.id === colorId)) {
    throw new Error(`color is unavailable in the current palette: ${colorId}`);
  }
}

function validatePatternCommand(session: PatternSession, command: PatternEditCommand): void {
  assertPatternPalette(session.pattern, session.palette);
  const indexes = new Set<number>();
  const availableIds = paletteColorIds(session.palette);
  for (const change of command.changes) {
    assertGridIndex(session.pattern, change.index);
    if (indexes.has(change.index)) throw new Error(`duplicate change index: ${change.index}`);
    indexes.add(change.index);
    for (const colorId of [change.beforeColorId, change.afterColorId]) {
      if (colorId !== null && !availableIds.has(colorId)) {
        throw new Error(`command references unavailable color: ${colorId}`);
      }
    }
    if (change.beforeColorId === change.afterColorId) throw new Error(`change at index ${change.index} is a no-op`);
  }
}

function paletteTableWithUsedColors(palette: Palette, usedIds: ReadonlySet<string>): string[] {
  const table = [''];
  for (const color of palette.colors) {
    if (usedIds.has(color.id)) table.push(color.id);
  }
  return table;
}

function applyPatternCommand(
  session: PatternSession,
  command: PatternEditCommand,
  direction: 'forward' | 'reverse' = 'forward',
): BeadPattern {
  validatePatternCommand(session, command);
  const currentColorIds: PatternCellColorId[] = Array.from(
    { length: session.pattern.grid.cells.length },
    (_, index) => cellColorId(session.pattern, index),
  );
  for (const change of command.changes) {
    const expected = direction === 'forward' ? change.beforeColorId : change.afterColorId;
    if (currentColorIds[change.index] !== expected) {
      throw new Error(`stale pattern command at index ${change.index}`);
    }
  }
  const nextColorIds = [...currentColorIds];
  for (const change of command.changes) {
    nextColorIds[change.index] = direction === 'forward' ? change.afterColorId : change.beforeColorId;
  }
  const usedIds = new Set<string>();
  for (const colorId of nextColorIds) if (colorId) usedIds.add(colorId);
  const paletteTable = paletteTableWithUsedColors(session.palette, usedIds);
  const indexById = new Map(paletteTable.map((id, index) => [id, index]));
  const cells = nextColorIds.map(colorId => {
    if (!colorId) return EMPTY_CELL;
    const paletteIndex = indexById.get(colorId);
    if (!paletteIndex) throw new Error(`color was not assigned to palette table: ${colorId}`);
    return paletteIndex;
  });
  return {
    ...session.pattern,
    grid: createGrid(session.pattern.grid.width, session.pattern.grid.height, cells),
    paletteTable,
  };
}

function rebuildSession(session: PatternSession, pattern: BeadPattern, history: PatternEditHistory): PatternSession {
  return {
    history: freezeHistory(history),
    palette: session.palette,
    pattern,
    statistics: calculateStatistics(pattern.grid, pattern.paletteTable.length - 1),
  };
}

export function executePatternSessionCommand(
  session: PatternSession,
  command: PatternEditCommand,
): PatternSessionResult {
  if (command.changes.length === 0) return { changed: 0, session };
  command = snapshotCommand(command);
  const pattern = applyPatternCommand(session, command);
  const nextSession = rebuildSession(session, pattern, {
    limit: session.history.limit,
    undoStack: [...session.history.undoStack, command].slice(-session.history.limit),
    redoStack: [],
  });
  return { changed: command.changes.length, command, session: nextSession };
}

export function undoPatternSessionEdit(session: PatternSession): PatternSessionResult {
  const command = session.history.undoStack[session.history.undoStack.length - 1];
  if (!command) return { changed: 0, session };
  const pattern = applyPatternCommand(session, command, 'reverse');
  const nextSession = rebuildSession(session, pattern, {
    limit: session.history.limit,
    undoStack: session.history.undoStack.slice(0, -1),
    redoStack: [...session.history.redoStack, command].slice(-session.history.limit),
  });
  return { changed: command.changes.length, command, session: nextSession };
}

export function redoPatternSessionEdit(session: PatternSession): PatternSessionResult {
  const command = session.history.redoStack[session.history.redoStack.length - 1];
  if (!command) return { changed: 0, session };
  const pattern = applyPatternCommand(session, command);
  const nextSession = rebuildSession(session, pattern, {
    limit: session.history.limit,
    undoStack: [...session.history.undoStack, command].slice(-session.history.limit),
    redoStack: session.history.redoStack.slice(0, -1),
  });
  return { changed: command.changes.length, command, session: nextSession };
}

function createSingleCellCommand(
  session: PatternSession,
  type: EditCommandType,
  index: number,
  afterColorId: PatternCellColorId,
): PatternEditCommand {
  assertGridIndex(session.pattern, index);
  if (afterColorId) assertPatternSessionColor(session, afterColorId);
  const beforeColorId = cellColorId(session.pattern, index);
  if (beforeColorId === afterColorId) return { type, changes: [] };
  return { type, changes: [{ index, beforeColorId, afterColorId }] };
}

export function paintPatternSessionCell(
  session: PatternSession,
  index: number,
  colorId: string,
): PatternSessionResult {
  return executePatternSessionCommand(session, createSingleCellCommand(session, 'paint', index, colorId));
}

export function erasePatternSessionCell(session: PatternSession, index: number): PatternSessionResult {
  return executePatternSessionCommand(session, createSingleCellCommand(session, 'erase', index, null));
}

export function fillPatternSessionRegion(
  session: PatternSession,
  startIndex: number,
  colorId: PatternCellColorId,
): PatternSessionResult {
  assertGridIndex(session.pattern, startIndex);
  if (colorId) assertPatternSessionColor(session, colorId);
  const sourceColorId = cellColorId(session.pattern, startIndex);
  if (sourceColorId === colorId) return { changed: 0, session };
  const visited = new Uint8Array(session.pattern.grid.cells.length);
  const stack = [startIndex];
  const changes: PatternCellChange[] = [];
  while (stack.length > 0) {
    const index = stack.pop();
    if (index === undefined || visited[index]) continue;
    visited[index] = 1;
    if (cellColorId(session.pattern, index) !== sourceColorId) continue;
    changes.push({ index, beforeColorId: sourceColorId, afterColorId: colorId });
    const x = index % session.pattern.grid.width;
    const y = Math.floor(index / session.pattern.grid.width);
    if (x > 0) stack.push(index - 1);
    if (x + 1 < session.pattern.grid.width) stack.push(index + 1);
    if (y > 0) stack.push(index - session.pattern.grid.width);
    if (y + 1 < session.pattern.grid.height) stack.push(index + session.pattern.grid.width);
  }
  return executePatternSessionCommand(session, { type: 'fill', changes });
}

export function replacePatternSessionColor(
  session: PatternSession,
  sourceColorId: string,
  targetColorId: PatternCellColorId,
): PatternSessionResult {
  assertPatternSessionColor(session, sourceColorId);
  if (targetColorId) assertPatternSessionColor(session, targetColorId);
  if (sourceColorId === targetColorId) return { changed: 0, session };
  const changes: PatternCellChange[] = [];
  for (let index = 0; index < session.pattern.grid.cells.length; index += 1) {
    if (cellColorId(session.pattern, index) === sourceColorId) {
      changes.push({ index, beforeColorId: sourceColorId, afterColorId: targetColorId });
    }
  }
  return executePatternSessionCommand(session, { type: 'replace', changes });
}

export function removePatternSessionBackground(session: PatternSession): PatternBackgroundRemovalResult {
  const removal = createBackgroundRemovalCommand(session.pattern.grid);
  const backgroundPaletteIndex = removal.backgroundPaletteIndex;
  const backgroundColorId = backgroundPaletteIndex === null
    ? null
    : session.pattern.paletteTable[backgroundPaletteIndex] ?? null;
  const changes = removal.command.changes.map(change => ({
    index: change.index,
    beforeColorId: cellColorId(session.pattern, change.index),
    afterColorId: null,
  }));
  const result = executePatternSessionCommand(session, { type: 'background-remove', changes });
  return {
    ...result,
    backgroundColorId,
    backgroundPaletteIndex,
  };
}
