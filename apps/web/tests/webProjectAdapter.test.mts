import assert from 'node:assert/strict';
import test from 'node:test';
import { createGrid, projectToPattern, serializePattern, storeProjectEnvelope, createProductionProgress } from '@pinbean/bead-core';
import { getSupplierPalette } from '@pinbean/palette-data';
import { createWebProjectHistory, createWebProject, exportWebProject, importWebProject, loadWebProject, prepareWebProject, saveWebProject, updateWebProject, focusCompletedCells, updateFocusCells, WEB_PROJECT_STORAGE_KEY, LEGACY_FOCUS_STORAGE_KEY, webPaletteColors } from '../src/adapters/webProjectAdapter';
import { createWebEditingSession, executeWebEdit } from '../src/adapters/webEditingAdapter';

function fixture() {
  const full = getSupplierPalette('COCO');
  const palette = getSupplierPalette('COCO', full.colors.slice(0, 3).map(color => color.id));
  const project = { id: 'stable-id', name: 'My pattern', schemaVersion: 1, createdAt: 10, updatedAt: 20, grid: createGrid(3, 2, [1, 0, 1, 2, 1, 0]), paletteId: palette.id, paletteVersion: palette.version, paletteTable: ['', palette.colors[0].id, palette.colors[1].id] };
  return importWebProject(JSON.stringify(storeProjectEnvelope(project, 'COCO', palette)));
}
function storage() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}
test('project import/edit/export preserves ordered unused selection and unknown provenance', () => {
  const original = fixture();
  const colors = webPaletteColors(original.palette);
  const session = createWebEditingSession(original.pattern, 100, original.palette);
  const edited = executeWebEdit(session, { type: 'paint', index: 1, target: { key: colors[2].key, color: colors[2].hex } }, colors, 'COCO');
  const restored = importWebProject(exportWebProject(updateWebProject(original, edited.session.pattern, 30)));
  assert.deepEqual(restored.palette.colors.map(color => color.id), original.palette.colors.map(color => color.id));
  assert.equal(restored.project.id, 'stable-id');
  assert.equal(restored.project.createdAt, 10);
  assert.equal(restored.project.generation, undefined);
  assert.equal(restored.pattern.sourceGeneration, null);
  assert.equal(prepareWebProject(restored).view.totalCount, 5);
});
test('Focus partial, full-color, cancellation and reload use exact nonempty cell indices', () => {
  const original = fixture();
  const partial = updateFocusCells(original, new Set(['0,0']), 30);
  assert.deepEqual(partial.cellProgress?.completedCellIndices, [0]);
  assert.deepEqual(partial.progress?.completedColorIds, []);
  const store = storage(); saveWebProject(store, partial);
  assert.deepEqual(focusCompletedCells(loadWebProject(store)!), new Set(['0,0']));
  const full = updateFocusCells(partial, new Set(['0,0', '0,2', '1,1']), 40);
  assert.deepEqual(full.progress?.completedColorIds, [original.palette.colors[0].id]);
  const canceled = updateFocusCells(full, new Set(['0,0']), 50);
  assert.deepEqual(canceled.progress?.completedColorIds, []);
  assert.throws(() => updateFocusCells(original, new Set(['0,1'])));
  assert.throws(() => updateFocusCells(original, new Set(['0,3'])));
  assert.equal(canceled.project.updatedAt, 50);
});
test('Focus expands whole colors but never completed boards', () => {
  const original = fixture();
  const progress = { ...createProductionProgress(original.pattern), completedColorIds: [original.palette.colors[0].id], completedBoardIds: ['1-1'] };
  const restored = importWebProject(JSON.stringify(storeProjectEnvelope(original.project, 'COCO', original.palette, { progress })));
  assert.deepEqual(focusCompletedCells(restored), new Set(['0,0', '0,2', '1,1']));
});
test('pattern content changes isolate progress; unused table entries do not', () => {
  const original = updateFocusCells(fixture(), new Set(['0,0']), 30);
  const unused = { ...original.pattern, paletteTable: [...original.pattern.paletteTable, original.palette.colors[2].id] };
  assert.deepEqual(updateWebProject(original, unused).cellProgress?.completedCellIndices, [0]);
  const changed = { ...original.pattern, grid: createGrid(3, 2, [2, 0, 1, 2, 1, 0]) };
  assert.equal(updateWebProject(original, changed).cellProgress, undefined);
});
test('legacy Focus migration recalculates statistics and never removes original cache', () => {
  const original = fixture(); const store = storage();
  const legacy = JSON.stringify({ pattern: serializePattern(original.pattern), palette: webPaletteColors(original.palette), colorSystem: 'COCO', colorCounts: { bad: { count: 999 } } });
  store.data.set(LEGACY_FOCUS_STORAGE_KEY, legacy);
  assert.equal(prepareWebProject(loadWebProject(store)!).view.totalCount, 4);
  assert.equal(store.getItem(LEGACY_FOCUS_STORAGE_KEY), legacy);
  assert.ok(store.getItem(WEB_PROJECT_STORAGE_KEY));
  const broken = storage(); broken.data.set(LEGACY_FOCUS_STORAGE_KEY, '{');
  assert.throws(() => loadWebProject(broken)); assert.equal(broken.getItem(LEGACY_FOCUS_STORAGE_KEY), '{');
  const failure = { getItem: store.getItem, setItem() { throw new Error('quota'); } };
  assert.throws(() => saveWebProject(failure, original), /quota/);
});
test('malformed/unknown files reject without modifying current persisted project', () => {
  const original = fixture(); const store = storage(); saveWebProject(store, original);
  const before = store.getItem(WEB_PROJECT_STORAGE_KEY);
  assert.throws(() => importWebProject('{'));
  const envelope = JSON.parse(exportWebProject(original)); envelope.formatVersion = 99;
  assert.throws(() => importWebProject(JSON.stringify(envelope)));
  assert.equal(store.getItem(WEB_PROJECT_STORAGE_KEY), before);
});
test('metadata and version one full palette survive standard file exchange', () => {
  const original = fixture();
  original.workflow = { formatVersion: 1, projectType: 'photo' };
  original.publishReview = { formatVersion: 1, comments: 2, conversions: 1, favorites: 8, likes: 12, note: 'notes', publishedAt: 10, updatedAt: 20, topic: 'gift' };
  const restored = importWebProject(exportWebProject(original));
  assert.deepEqual(restored.workflow, original.workflow);
  assert.deepEqual(restored.publishReview, original.publishReview);
  const full = getSupplierPalette('COCO');
  const project = { ...original.project, paletteVersion: full.version };
  const v1 = { formatVersion: 1, colorSystem: 'COCO', project: { ...project, grid: { ...project.grid, cells: Array.from(project.grid.cells) } } };
  assert.equal(importWebProject(JSON.stringify(v1)).palette.colors.length, full.colors.length);
  v1.project.paletteVersion = 'color-system-mapping-v1';
  assert.throws(() => importWebProject(JSON.stringify(v1)));
});
test('in-memory history restores partial progress after undo and isolates projects', () => {
  const original = updateFocusCells(fixture(), new Set(['0,0']), 30);
  const update = createWebProjectHistory();
  const changed = { ...original.pattern, grid: createGrid(3, 2, [2, 0, 1, 2, 1, 0]) };
  const edited = update(original, changed, 40);
  assert.equal(edited.cellProgress, undefined);
  assert.deepEqual(update(edited, original.pattern, 50).cellProgress?.completedCellIndices, [0]);
  const separate = { ...edited, project: { ...edited.project, id: 'other' } };
  assert.equal(update(separate, original.pattern, 60).cellProgress, undefined);
});
test('source generation identity survives edit and export', () => {
  const original = fixture();
  const generated = createWebProject(projectToPattern(original.project), original.palette, 'COCO', 'generated', 'Generated', 30);
  generated.project.generation!.sourceImageId = 'original-image-id';
  const restored = importWebProject(exportWebProject(updateWebProject(generated, generated.pattern, 40)));
  assert.equal(restored.project.generation?.sourceImageId, 'original-image-id');
});
