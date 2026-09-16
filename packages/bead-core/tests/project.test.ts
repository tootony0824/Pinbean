import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CURRENT_ALGORITHM_VERSION,
  CURRENT_SCHEMA_VERSION,
  createGrid,
  deserializeProject,
  serializeProject,
  type BeadProject,
  type GenerationConfig,
} from '../src/index.js';

const generationConfig: GenerationConfig = {
  algorithmVersion: CURRENT_ALGORITHM_VERSION,
  mode: 'cartoon',
  targetGrid: { axis: 'long-side', size: 32 },
  sampling: { scale: 4 },
  paletteId: 'mard',
  paletteVersion: 'mard-v1',
  similarityMerge: { enabled: true, threshold: 48 },
  alphaThreshold: 128,
};

const project: BeadProject = {
  id: 'project-1',
  schemaVersion: CURRENT_SCHEMA_VERSION,
  createdAt: 100,
  updatedAt: 200,
  name: '测试图纸',
  grid: createGrid(2, 2, [0, 1, 2, 1]),
  paletteId: 'mard',
  paletteVersion: 'mard-v1',
  paletteTable: ['', 'mard-A01', 'mard-B01'],
  generation: { sourceImageId: 'source-1', config: generationConfig },
};

test('project serialization keeps runtime TypedArray and readable persisted cells separate', () => {
  const serialized = serializeProject(project);
  assert.ok(Array.isArray(serialized.grid.cells));
  assert.deepEqual(serialized.grid.cells, [0, 1, 2, 1]);
  const restored = deserializeProject(JSON.parse(JSON.stringify(serialized)) as unknown);
  assert.ok(restored.grid.cells instanceof Uint16Array);
  assert.deepEqual(Array.from(restored.grid.cells), [0, 1, 2, 1]);
  assert.deepEqual(restored.generation?.config, generationConfig);
});

test('schema V0 migrates updatedAt deterministically from createdAt', () => {
  const legacy = {
    ...serializeProject(project),
    schemaVersion: 0,
  } as Record<string, unknown>;
  delete legacy.updatedAt;
  const restored = deserializeProject(legacy);
  assert.equal(restored.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(restored.createdAt, 100);
  assert.equal(restored.updatedAt, 100);
});

test('project loading rejects unknown schemas, invalid indexes and palette drift', () => {
  const serialized = serializeProject(project);
  assert.throws(() => deserializeProject({ ...serialized, schemaVersion: 99 }), /unsupported schema/);
  assert.throws(() => deserializeProject({
    ...serialized,
    grid: { ...serialized.grid, cells: [0, 1, 3, 1] },
  }), /exceeds palette size/);
  assert.throws(() => deserializeProject({
    ...serialized,
    generation: {
      ...serialized.generation,
      config: { ...generationConfig, paletteVersion: 'wrong' },
    },
  }), /does not match palette metadata/);
  assert.throws(() => deserializeProject({
    ...serialized,
    generation: {
      ...serialized.generation,
      config: { ...generationConfig, mode: 'unsupported' },
    },
  }), /unsupported generation mode/);
  assert.throws(() => deserializeProject({
    ...serialized,
    generation: {
      ...serialized.generation,
      config: { ...generationConfig, alphaThreshold: 300 },
    },
  }), /alphaThreshold/);
});

test('project metadata rejects malformed strings, sparse palette tables and invalid source ids', () => {
  const serialized = serializeProject(project);
  assert.throws(() => serializeProject({ ...project, id: '' }), /project id/);
  assert.throws(() => serializeProject({ ...project, paletteId: '' }), /paletteId/);
  assert.throws(() => serializeProject({
    ...project,
    generation: { sourceImageId: '', config: generationConfig },
  }), /sourceImageId/);
  const sparsePaletteTable = new Array<string>(4);
  sparsePaletteTable[0] = '';
  sparsePaletteTable[1] = 'mard-A01';
  sparsePaletteTable[3] = 'mard-B01';
  assert.throws(() => serializeProject({ ...project, paletteTable: sparsePaletteTable }), /must not be a hole/);
  assert.throws(() => deserializeProject({ ...serialized, updatedAt: 1 }), /updatedAt must not precede/);
});

test('project loading keeps known legacy algorithm versions readable', () => {
  const serialized = serializeProject(project);
  const restored = deserializeProject({
    ...serialized,
    generation: {
      ...serialized.generation,
      config: { ...generationConfig, algorithmVersion: 1 },
    },
  });
  assert.equal(restored.generation?.config.algorithmVersion, 1);
});

