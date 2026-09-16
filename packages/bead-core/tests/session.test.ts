import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createGrid,
  executePatternSessionCommand,
  createPatternSession,
  erasePatternSessionCell,
  getPatternCellColorId,
  getPatternPaletteIndex,
  hashPattern,
  hashPatternContent,
  paintPatternSessionCell,
  redoPatternSessionEdit,
  replacePatternSessionColor,
  undoPatternSessionEdit,
  type BeadPattern,
  type GenerationConfig,
  type Palette,
} from '../src/index.js';

const palette: Palette = {
  id: 'test-palette',
  version: 'test-palette-v1',
  colors: [
    { id: 'red', code: 'R', rgb: { r: 255, g: 0, b: 0 }, hex: '#FF0000' },
    { id: 'blue', code: 'B', rgb: { r: 0, g: 0, b: 255 }, hex: '#0000FF' },
    { id: 'green', code: 'G', rgb: { r: 0, g: 255, b: 0 }, hex: '#00FF00' },
  ],
};

const generationConfig: GenerationConfig = {
  algorithmVersion: 2,
  mode: 'cartoon',
  targetGrid: { axis: 'width', size: 2 },
  sampling: { scale: 4 },
  paletteId: palette.id,
  paletteVersion: palette.version,
  similarityMerge: { enabled: true, threshold: 48 },
  alphaThreshold: 128,
};

function createPattern(cells: readonly number[], paletteTable = ['', 'red', 'blue']): BeadPattern {
  return {
    grid: createGrid(2, 1, cells),
    paletteId: palette.id,
    paletteVersion: palette.version,
    paletteTable,
    generationConfig,
  };
}

test('commands are detached and deeply frozen across execute undo and redo', () => {
  const session = createPatternSession(createPattern([1, 2]), palette);
  const change = { index: 0, beforeColorId: 'red', afterColorId: 'green' };
  const command = { type: 'paint' as const, changes: [change] };
  const executed = executePatternSessionCommand(session, command);
  change.afterColorId = 'blue';
  command.changes.length = 0;
  assert.equal(executed.command?.changes[0]?.afterColorId, 'green');
  for (const result of [executed, undoPatternSessionEdit(executed.session)]) {
    assert.ok(Object.isFrozen(result.command));
    assert.ok(Object.isFrozen(result.command?.changes));
    assert.ok(Object.isFrozen(result.command?.changes[0]));
    assert.ok(Object.isFrozen(result.session.history));
    assert.ok(Object.isFrozen(result.session.history.undoStack));
    const returnedCommand = result.command;
    const returnedChange = returnedCommand?.changes[0];
    assert.ok(returnedCommand && returnedChange);
    assert.throws(() => Object.assign(returnedChange, { afterColorId: 'blue' }), TypeError);
    assert.throws(() => Object.assign(returnedCommand, { type: 'erase' }), TypeError);
  }
  const undone = undoPatternSessionEdit(executed.session);
  assert.equal(getPatternCellColorId(undone.session.pattern, 0), 'red');
  const redone = redoPatternSessionEdit(undone.session);
  assert.ok(Object.isFrozen(redone.command?.changes[0]));
  const redoneChange = redone.command?.changes[0];
  assert.ok(redoneChange);
  assert.throws(() => Object.assign(redoneChange, { beforeColorId: 'blue' }), TypeError);
  assert.equal(getPatternCellColorId(redone.session.pattern, 0), 'green');
  assert.equal(getPatternCellColorId(undoPatternSessionEdit(redone.session).session.pattern, 0), 'red');
});

test('pattern session paints with stable color ids and keeps undo/redo valid across palette table changes', () => {
  const session = createPatternSession(createPattern([1, 2]), palette);
  const beforeContentHash = hashPatternContent(session.pattern);
  const beforeFullHash = hashPattern(session.pattern);

  const painted = paintPatternSessionCell(session, 0, 'green').session;
  assert.equal(getPatternCellColorId(painted.pattern, 0), 'green');
  assert.equal(getPatternCellColorId(painted.pattern, 1), 'blue');
  assert.equal(getPatternPaletteIndex(painted.pattern, 'red'), null);
  assert.notEqual(hashPatternContent(painted.pattern), beforeContentHash);

  const undone = undoPatternSessionEdit(painted).session;
  assert.equal(hashPatternContent(undone.pattern), beforeContentHash);
  assert.equal(hashPattern(undone.pattern), beforeFullHash);
  assert.deepEqual(undone.pattern.paletteTable, ['', 'red', 'blue']);

  const redone = redoPatternSessionEdit(undone).session;
  assert.equal(getPatternCellColorId(redone.pattern, 0), 'green');
  assert.equal(getPatternCellColorId(redone.pattern, 1), 'blue');
});

test('pattern content hash ignores unused palette table entries', () => {
  const compact = createPattern([1, 2]);
  const withUnused = createPattern([1, 2], ['', 'red', 'blue', 'green']);
  assert.notEqual(hashPattern(withUnused), hashPattern(compact));
  assert.equal(hashPatternContent(withUnused), hashPatternContent(compact));
});

test('pattern session replace and erase use color identity rather than numeric palette positions', () => {
  let session = createPatternSession(createPattern([1, 2]), palette);
  session = replacePatternSessionColor(session, 'red', 'green').session;
  assert.equal(getPatternCellColorId(session.pattern, 0), 'green');
  assert.equal(getPatternCellColorId(session.pattern, 1), 'blue');
  session = erasePatternSessionCell(session, 1).session;
  assert.equal(getPatternCellColorId(session.pattern, 1), null);
  session = undoPatternSessionEdit(session).session;
  assert.equal(getPatternCellColorId(session.pattern, 1), 'blue');
  session = undoPatternSessionEdit(session).session;
  assert.equal(getPatternCellColorId(session.pattern, 0), 'red');
});

test('pattern session validates malformed tables and config while keeping legacy algorithms readable', () => {
  assert.doesNotThrow(() => createPatternSession({
    ...createPattern([1, 2]),
    generationConfig: { ...generationConfig, algorithmVersion: 1 },
  }, palette));

  assert.throws(() => createPatternSession({
    ...createPattern([1, 2]),
    generationConfig: {
      ...generationConfig,
      similarityMerge: { ...generationConfig.similarityMerge, enabled: 'yes' as unknown as boolean },
    },
  }, palette), /similarityMerge\.enabled/);

  const sparseTable = new Array<string>(4);
  sparseTable[0] = '';
  sparseTable[1] = 'red';
  sparseTable[3] = 'blue';
  assert.throws(() => createPatternSession(createPattern([1, 3], sparseTable), palette), /must not be a hole/);
});
