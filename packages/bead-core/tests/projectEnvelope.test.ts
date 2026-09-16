import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createGrid, createPatternSession, paintPatternSessionCell, createCellProgress, restoreCellProgress,
  cellProgressToCompletedColorIds, syncCellProgressColors, createProductionProgress,
  storeProjectEnvelope, restoreProjectEnvelope, projectToPattern, encodeProjectEnvelope, parseProjectEnvelopeFile,
  type BeadProject, type Palette,
} from '../src/index.js';
const palette: Palette = { id: 'supplier', version: 'subset-v1', colors: [
  { id: 'red', code: 'R', hex: '#FF0000', rgb: { r: 255, g: 0, b: 0 } },
  { id: 'blue', code: 'B', hex: '#0000FF', rgb: { r: 0, g: 0, b: 255 } },
  { id: 'white', code: 'W', hex: '#FFFFFF', rgb: { r: 255, g: 255, b: 255 } },
] };
const project: BeadProject = { id: 'one', name: 'test', createdAt: 1, updatedAt: 2, schemaVersion: 1,
  grid: createGrid(4, 1, [1, 1, 0, 2]), paletteId: palette.id, paletteVersion: palette.version, paletteTable: ['', 'red', 'blue'] };
const pattern = projectToPattern(project);
const resolver = (system: string, ids?: readonly string[]): Palette => {
  assert.equal(system, 'supplier');
  if (ids) assert.deepEqual(ids, palette.colors.map(color => color.id));
  return palette;
};

test('envelope preserves full ordered unused selection, metadata and unknown provenance through editing', () => {
  const sidecar = createCellProgress(project.id, pattern, [0], 10);
  const stored = storeProjectEnvelope(project, 'supplier', palette, { cellProgress: sidecar, workflow: { formatVersion: 1, projectType: 'gift' } });
  assert.deepEqual(stored.selectedColorIds, ['red', 'blue', 'white']);
  const restored = parseProjectEnvelopeFile(encodeProjectEnvelope(stored, resolver), resolver);
  assert.equal(restored.pattern.sourceGeneration, null);
  assert.equal(restored.project.generation, undefined);
  assert.deepEqual(restored.cellProgress, sidecar);
  assert.deepEqual(restored.progress?.completedColorIds, []);
  const edited = paintPatternSessionCell(createPatternSession(restored.pattern, restored.palette), 2, 'white').session.pattern;
  assert.equal(edited.sourceGeneration, null);
  const saved = storeProjectEnvelope({ ...restored.project, grid: edited.grid, paletteTable: edited.paletteTable }, 'supplier', palette);
  assert.equal(saved.project.generation, undefined);
  assert.deepEqual(saved.selectedColorIds, stored.selectedColorIds);
  assert.deepEqual(saved.project.grid.cells, [1, 1, 3, 2]);
});

test('known generation source image survives envelope round-trip', () => {
  const sourced = { ...project, generation: { sourceImageId: 'image-one', config: pattern.generationConfig } };
  const restored = restoreProjectEnvelope(storeProjectEnvelope(sourced, 'supplier', palette), resolver);
  assert.equal(restored.pattern.sourceGeneration?.sourceImageId, 'image-one');
  assert.deepEqual(storeProjectEnvelope(restored.project, 'supplier', palette).project.generation, sourced.generation);
});

test('v1 accepts exact palette or explicit legacy whitelist, v2 rejects missing reordered duplicated unknown ids and versions', () => {
  const stored = storeProjectEnvelope(project, 'supplier', palette);
  const v1 = { ...stored, formatVersion: 1 };
  assert.equal(restoreProjectEnvelope(v1, resolver).palette.version, palette.version);
  const legacy = { ...v1, project: { ...stored.project, paletteVersion: 'legacy' } };
  assert.throws(() => restoreProjectEnvelope(legacy, resolver), /palette identity/);
  assert.equal(restoreProjectEnvelope(legacy, resolver, { legacyPaletteVersions: ['legacy'] }).project.paletteVersion, palette.version);
  assert.throws(() => restoreProjectEnvelope({ ...legacy, formatVersion: 2 }, resolver, { legacyPaletteVersions: ['legacy'] }), /palette identity/);
  for (const ids of [undefined, [], ['red', 'red'], ['blue', 'red', 'white'], ['unknown']]) {
    assert.throws(() => restoreProjectEnvelope({ ...stored, selectedColorIds: ids }, () => palette));
  }
  assert.throws(() => restoreProjectEnvelope({ ...stored, formatVersion: 9 }, resolver), /unsupported stored/);
  assert.throws(() => restoreProjectEnvelope({ ...v1, project: { ...stored.project, paletteVersion: 'unknown' } }, resolver, { legacyPaletteVersions: ['legacy'] }), /palette identity/);
});

test('cell progress is scoped, range checked, empty-safe, versioned and detached', () => {
  const indices = [1, 0];
  const sidecar = createCellProgress('one', pattern, indices, 3);
  indices.length = 0;
  assert.deepEqual(sidecar.completedCellIndices, [0, 1]);
  for (const invalid of [[-1], [4], [0.5], [2], [0, 0], [NaN]]) assert.throws(() => createCellProgress('one', pattern, invalid));
  for (const invalid of [{ ...sidecar, formatVersion: 9 }, { ...sidecar, projectId: 'two' }, { ...sidecar, patternHash: 'bad' }, { ...sidecar, updatedAt: -1 }, { ...sidecar, updatedAt: undefined }, { ...sidecar, completedCellIndices: undefined }]) {
    assert.throws(() => restoreCellProgress(invalid, 'one', pattern));
  }
  assert.throws(() => restoreCellProgress(sidecar, 'one', { ...pattern, grid: createGrid(4, 1, [1, 2, 0, 2]) }), /hash/);
  assert.deepEqual(restoreCellProgress(sidecar, 'one', { ...pattern, paletteTable: [...pattern.paletteTable, 'white'] }), sidecar);
});

test('whole colors require all cells; explicit color changes preserve unrelated partial work and never infer boards', () => {
  const partial = createCellProgress('one', pattern, [0], 3);
  assert.deepEqual(cellProgressToCompletedColorIds(partial, 'one', pattern), []);
  const blue = syncCellProgressColors(partial, 'one', pattern, [], ['blue'], 4);
  assert.deepEqual(blue.completedCellIndices, [0, 3]);
  const red = syncCellProgressColors(blue, 'one', pattern, ['blue'], ['blue', 'red'], 5);
  assert.deepEqual(cellProgressToCompletedColorIds(red, 'one', pattern), ['red', 'blue']);
  assert.deepEqual(syncCellProgressColors(red, 'one', pattern, ['blue', 'red'], ['blue'], 6).completedCellIndices, [3]);
  assert.deepEqual(syncCellProgressColors(undefined, 'one', pattern, ['red'], ['red'], 7).completedCellIndices, [0, 1]);
  const progress = { ...createProductionProgress(pattern, 3), completedBoardIds: ['1-1'] };
  const stored = storeProjectEnvelope(project, 'supplier', palette, { progress, cellProgress: partial });
  assert.deepEqual(restoreProjectEnvelope(stored, resolver).cellProgress?.completedCellIndices, [0]);
  assert.throws(() => storeProjectEnvelope(project, 'supplier', palette, { progress, cellProgress: red }), /inconsistent/);
  assert.throws(() => restoreProjectEnvelope({ ...stored, progress: { ...progress, projectId: 'two' } }, resolver), /project id/);
  const onlyCells = storeProjectEnvelope(project, 'supplier', palette, { cellProgress: red });
  assert.deepEqual(onlyCells.progress?.completedColorIds, ['red', 'blue']);
  assert.deepEqual(onlyCells.progress?.completedBoardIds, []);
});
