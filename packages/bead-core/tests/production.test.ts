import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBoardPlan,
  buildCraftAssessment,
  buildMaterialList,
  createGrid,
  createProductionProgress,
  hashPattern,
  hashPatternContent,
  restoreProductionProgress,
  summarizeProductionProgress,
  toggleProductionBoard,
  toggleProductionColor,
  type BeadPattern,
  type GenerationConfig,
  type Palette,
} from '../src/index.js';

const palette: Palette = {
  id: 'test-palette',
  version: 'test-v1',
  colors: [
    { id: 'red', code: 'A01', rgb: { r: 255, g: 0, b: 0 }, hex: '#FF0000' },
    { id: 'blue', code: 'A02', rgb: { r: 0, g: 0, b: 255 }, hex: '#0000FF' },
    { id: 'white', code: 'H07', rgb: { r: 255, g: 255, b: 255 }, hex: '#FFFFFF' },
  ],
};

const config: GenerationConfig = {
  algorithmVersion: 2,
  mode: 'cartoon',
  targetGrid: { axis: 'width', size: 30 },
  sampling: { scale: 4 },
  paletteId: palette.id,
  paletteVersion: palette.version,
  similarityMerge: { enabled: true, threshold: 48 },
  alphaThreshold: 128,
};

function pattern(cells: readonly number[], width = 3): BeadPattern {
  return {
    grid: createGrid(width, Math.ceil(cells.length / width), cells),
    paletteId: palette.id,
    paletteVersion: palette.version,
    paletteTable: ['', 'red', 'blue', 'white'],
    generationConfig: config,
  };
}

test('material planning and board splitting are shared pure core models', () => {
  const p = pattern([1, 2, 0, 1, 3, 3]);
  const materials = buildMaterialList(p, palette, ['red']);
  assert.deepEqual(materials.map(item => [item.code, item.count, item.reserveCount, item.isCompleted]), [
    ['A1', 2, 3, true],
    ['A2', 1, 2, false],
    ['H7', 2, 3, false],
  ]);
  const plan = buildBoardPlan(p, palette, 2);
  assert.equal(plan.count, 2);
  assert.deepEqual(plan.pieces.map(piece => [piece.id, piece.sizeText, piece.total]), [
    ['1-1', '2×2', 4],
    ['1-2', '1×2', 1],
  ]);
  assert.equal(plan.pieces[0]?.colors[0]?.code, 'A1');
});

test('craft assessment and production progress use content hash, not unused palette entries', () => {
  const compact = {
    ...pattern([1, 2], 2),
    paletteTable: ['', 'red', 'blue'],
  };
  const withUnused = {
    ...compact,
    paletteTable: ['', 'red', 'blue', 'white'],
  };
  assert.notEqual(hashPattern(compact), hashPattern(withUnused));
  assert.equal(hashPatternContent(compact), hashPatternContent(withUnused));

  const plan = buildBoardPlan(withUnused, palette);
  const assessment = buildCraftAssessment(withUnused, palette, plan);
  assert.equal(assessment.level, '新手友好');

  let progress = createProductionProgress(withUnused, 100);
  progress = toggleProductionColor(progress, 'red', new Set(['red', 'blue']), 101);
  progress = toggleProductionBoard(progress, '1-1', new Set(['1-1']), 102);
  const summary = summarizeProductionProgress(compact, plan, progress);
  assert.equal(summary.completedColors, 1);
  assert.equal(summary.completedBoards, 1);
  const restored = restoreProductionProgress(progress, compact, new Set(['red', 'blue']), new Set(['1-1']));
  assert.equal(restored.patternHash, hashPatternContent(compact));
});

test('production progress and board summaries reject damaged identity and duplicate completion data', () => {
  const p = pattern([1, 2, 0, 1, 3, 3]);
  const plan = buildBoardPlan(p, palette, 2);
  const colorIds = new Set(['red', 'blue', 'white']);
  const boardIds = new Set(plan.pieces.map(piece => piece.id));
  const progress = createProductionProgress(p, 100);

  assert.throws(() => createProductionProgress(p, -1), /timestamp/);
  assert.throws(() => restoreProductionProgress({ ...progress, patternHash: undefined }, p, colorIds, boardIds), /pattern hash/);
  assert.throws(() => restoreProductionProgress({ ...progress, patternHash: '' }, p, colorIds, boardIds), /pattern hash/);
  assert.throws(() => restoreProductionProgress({ ...progress, completedBoardIds: ['1-1', '1-1'] }, p, colorIds, boardIds), /duplicates/);
  assert.throws(() => summarizeProductionProgress(p, plan, {
    ...progress,
    completedBoardIds: ['1-1', '1-1'],
  }), /duplicates/);
  assert.throws(() => summarizeProductionProgress(p, { ...plan, count: plan.count + 1 }, progress), /分板计划/);
  assert.throws(() => toggleProductionColor(progress, 'red', colorIds, -1), /timestamp/);
});

test('production exports reject malformed patterns before silently reading cells', () => {
  const malformed = {
    ...pattern([1, 2, 3]),
    paletteTable: ['', 'red'],
  };
  assert.throws(() => buildMaterialList(malformed, palette), /exceeds palette size/);
  assert.throws(() => buildBoardPlan(malformed, palette), /exceeds palette size/);
});
