import { hashPatternContent } from './hash.js';
import { assertRecord, validateBeadPattern } from './validation.js';
import type { BeadPattern } from './types.js';

export const CELL_PROGRESS_FORMAT_VERSION = 1;
export interface CellProgress {
  formatVersion: typeof CELL_PROGRESS_FORMAT_VERSION;
  projectId: string;
  patternHash: string;
  completedCellIndices: number[];
  updatedAt: number;
}
export function createCellProgress(
  projectId: string, pattern: BeadPattern, completedCellIndices: readonly number[] = [], updatedAt = 0,
): CellProgress {
  validateBeadPattern(pattern);
  if (typeof projectId !== 'string' || !projectId) throw new TypeError('cell progress project id is required');
  if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) throw new RangeError('cell progress timestamp must be a non-negative safe integer');
  if (!Array.isArray(completedCellIndices)) throw new TypeError('completed cell indices must be an array');
  const seen = new Set<number>();
  for (const index of completedCellIndices) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= pattern.grid.cells.length) throw new RangeError('cell progress index out of bounds');
    if (!pattern.grid.cells[index]) throw new Error('cell progress cannot complete an empty cell');
    if (seen.has(index)) throw new Error('duplicate cell progress index');
    seen.add(index);
  }
  return { formatVersion: CELL_PROGRESS_FORMAT_VERSION, projectId, patternHash: hashPatternContent(pattern), completedCellIndices: [...seen].sort((a, b) => a - b), updatedAt };
}
export function restoreCellProgress(input: unknown, projectId: string, pattern: BeadPattern): CellProgress {
  assertRecord(input, 'cell progress');
  if (input.formatVersion !== CELL_PROGRESS_FORMAT_VERSION) throw new Error(`unsupported cell progress format: ${String(input.formatVersion)}`);
  if (input.projectId !== projectId || input.patternHash !== hashPatternContent(pattern)) throw new Error('cell progress does not match project or pattern hash');
  if (!Array.isArray(input.completedCellIndices)) throw new TypeError('completed cell indices must be an array');
  if (!Number.isSafeInteger(input.updatedAt) || Number(input.updatedAt) < 0) throw new RangeError('cell progress timestamp must be a non-negative safe integer');
  return createCellProgress(projectId, pattern, input.completedCellIndices as number[], input.updatedAt as number);
}
export function cellProgressToCompletedColorIds(sidecar: CellProgress, projectId: string, pattern: BeadPattern): string[] {
  const completed = new Set(restoreCellProgress(sidecar, projectId, pattern).completedCellIndices);
  const states = new Map<string, boolean>();
  for (let index = 0; index < pattern.grid.cells.length; index += 1) {
    const colorId = pattern.paletteTable[pattern.grid.cells[index] ?? 0];
    if (colorId) states.set(colorId, (states.get(colorId) ?? true) && completed.has(index));
  }
  return pattern.paletteTable.filter(id => id && states.get(id) === true);
}
/** Only explicitly changed whole-color states overwrite partial progress. Boards are independent. */
export function syncCellProgressColors(
  sidecar: CellProgress | undefined, projectId: string, pattern: BeadPattern,
  previousCompletedColorIds: readonly string[], nextCompletedColorIds: readonly string[], updatedAt: number,
): CellProgress {
  const validIds = new Set(Array.from(pattern.grid.cells, cell => pattern.paletteTable[cell]).filter(Boolean));
  for (const id of [...previousCompletedColorIds, ...nextCompletedColorIds]) {
    if (!validIds.has(id)) throw new Error(`cell progress references unavailable color: ${id}`);
  }
  const previous = new Set(sidecar ? previousCompletedColorIds : []);
  const next = new Set(nextCompletedColorIds);
  const completed = new Set(sidecar ? restoreCellProgress(sidecar, projectId, pattern).completedCellIndices : []);
  for (let index = 0; index < pattern.grid.cells.length; index += 1) {
    const id = pattern.paletteTable[pattern.grid.cells[index] ?? 0];
    if (!id || previous.has(id) === next.has(id)) continue;
    if (next.has(id)) completed.add(index);
    else completed.delete(index);
  }
  return createCellProgress(projectId, pattern, [...completed], updatedAt);
}
