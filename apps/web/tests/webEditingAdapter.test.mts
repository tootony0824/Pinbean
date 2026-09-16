import assert from 'node:assert/strict';
import test from 'node:test';

import { generateWebPattern } from '../src/adapters/beadCoreAdapter';
import {
  createWebEditingSession,
  executeWebEdit,
  redoWebEdit,
  undoWebEdit,
} from '../src/adapters/webEditingAdapter';
import { PixelationMode, type PaletteColor } from '../src/utils/pixelation';

const palette: PaletteColor[] = [
  { key: 'T01', hex: '#FFFFFF', rgb: { r: 255, g: 255, b: 255 } },
  { key: 'H07', hex: '#000000', rgb: { r: 0, g: 0, b: 0 } },
  { key: 'A01', hex: '#FAF4C8', rgb: { r: 250, g: 244, b: 200 } },
];

function generatedSession() {
  const generated = generateWebPattern({
    image: {
      width: 3,
      height: 3,
      rgba: new Uint8ClampedArray([
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
      ]),
    },
    detailLevel: 3,
    similarityThreshold: 0,
    currentPalette: palette,
    mode: PixelationMode.Average,
    colorSystem: 'MARD',
  });
  return createWebEditingSession(generated.pattern);
}

test('Web edit adapter executes core paint, fill, replace and background commands', () => {
  let session = generatedSession();
  const red = { key: 'A01', color: '#FAF4C8' };
  let result = executeWebEdit(session, { index: 4, target: red, type: 'paint' }, palette, 'MARD');
  assert.equal(result.changed, 1);
  assert.equal(result.mappedPixelData[1]?.[1]?.key, 'A01');
  assert.equal(result.counts['#FAF4C8']?.count, 1);
  session = result.session;

  result = executeWebEdit(session, { index: 0, target: red, type: 'fill' }, palette, 'MARD');
  assert.equal(result.changed, 8);
  assert.equal(result.totalCount, 9);
  session = result.session;

  result = executeWebEdit(session, {
    source: red,
    target: { key: 'H07', color: '#000000' },
    type: 'replace',
  }, palette, 'MARD');
  assert.equal(result.changed, 9);
  assert.equal(result.counts['#000000']?.count, 9);
  session = result.session;

  result = executeWebEdit(session, { type: 'background-remove' }, palette, 'MARD');
  assert.equal(result.changed, 9);
  assert.equal(result.totalCount, 0);
});

test('Web edit adapter keeps one core undo and redo history across tools', () => {
  const initial = generatedSession();
  const painted = executeWebEdit(initial, {
    index: 4,
    target: { key: 'A01', color: '#FAF4C8' },
    type: 'paint',
  }, palette, 'MARD');
  const undone = undoWebEdit(painted.session, palette, 'MARD');
  assert.equal(undone.mappedPixelData[1]?.[1]?.key, 'H07');
  assert.equal(undone.session.history.redoStack.length, 1);
  const redone = redoWebEdit(undone.session, palette, 'MARD');
  assert.equal(redone.mappedPixelData[1]?.[1]?.key, 'A01');
  assert.equal(redone.session.history.undoStack.length, 1);
});

test('Web edit adapter rejects colors outside the generation palette identity', () => {
  const session = generatedSession();
  assert.throws(() => executeWebEdit(session, {
    index: 0,
    target: { key: 'missing', color: '#123456' },
    type: 'paint',
  }, palette, 'MARD'), /unavailable/);
  assert.throws(() => executeWebEdit(session, {
    index: 0,
    target: { key: 'A01', color: '#FAF4C8' },
    type: 'paint',
  }, palette.slice(0, 2), 'MARD'), /palette identity/);
});

test('cumulative stroke remains one undo entry with stable colors and complete erase/redo', () => {
  const base = generatedSession();
  const target = { key: 'A01', color: '#FAF4C8' };
  executeWebEdit(base, { type: 'stroke', indexes: [0], target }, palette, 'MARD');
  const painted = executeWebEdit(base, { type: 'stroke', indexes: [0, 1, 2, 1], target }, palette, 'MARD');
  assert.equal(painted.changed, 3);
  assert.equal(painted.session.history.undoStack.length, 1);
  assert.deepEqual(undoWebEdit(painted.session, palette, 'MARD').session.pattern, base.pattern);
  const erased = executeWebEdit(painted.session, { type: 'stroke', indexes: [0, 1, 2], target: { key: 'ERASE', color: '#FFFFFF' } }, palette, 'MARD');
  assert.equal(erased.totalCount, 6);
  const undone = undoWebEdit(erased.session, palette, 'MARD');
  assert.deepEqual(undone.session.pattern, painted.session.pattern);
  assert.deepEqual(redoWebEdit(undone.session, palette, 'MARD').session.pattern, erased.session.pattern);
});
