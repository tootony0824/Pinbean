import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CURRENT_ALGORITHM_VERSION,
  deserializeProject,
  serializeProject,
  cloneGenerationConfig,
  parseGenerationConfig,
  EMPTY_CELL,
  MAX_GRID_CELLS,
  MAX_IMAGE_PIXELS,
  calculateGridDimensions,
  calculateStatistics,
  colorDistance,
  createGrid,
  createPaletteTable,
  deserializePattern,
  findClosestPaletteIndex,
  generateBeadPattern,
  getCell,
  gridIndex,
  hashGrid,
  mergeSimilarColors,
  resizeNearestNeighbor,
  serializePattern,
  validatePalette,
  type GenerationConfig,
  type Palette,
} from '../src/index.js';

const palette: Palette = {
  id: 'test',
  version: 'test-v1',
  colors: [
    { id: 'test-gray', code: 'G1', rgb: { r: 100, g: 100, b: 100 }, hex: '#646464' },
    { id: 'test-black', code: 'B1', rgb: { r: 0, g: 0, b: 0 }, hex: '#000000' },
    { id: 'test-near-gray', code: 'G2', rgb: { r: 110, g: 110, b: 110 }, hex: '#6E6E6E' },
    { id: 'test-white', code: 'W1', rgb: { r: 255, g: 255, b: 255 }, hex: '#FFFFFF' },
  ],
};

const config: GenerationConfig = {
  algorithmVersion: 2,
  mode: 'cartoon',
  targetGrid: { axis: 'width', size: 1 },
  sampling: { scale: 4 },
  paletteId: palette.id,
  paletteVersion: palette.version,
  similarityMerge: { enabled: false, threshold: 48 },
  alphaThreshold: 128,
};

test('numeric grid reserves zero for EMPTY and validates coordinates', () => {
  const grid = createGrid(2, 2, [EMPTY_CELL, 1, 2, 3]);
  assert.equal(gridIndex(grid, 1, 1), 3);
  assert.equal(getCell(grid, 0, 0), EMPTY_CELL);
  assert.equal(getCell(grid, 1, 1), 3);
  assert.throws(() => getCell(grid, 2, 0), /out of bounds/);
  assert.throws(() => createGrid(2, 2, [1]), /cells length/);
  assert.throws(() => createGrid(1, 1, [65_536]), /Uint16/);
  assert.throws(() => createGrid(1, 1, [-1]), /Uint16/);
});

test('resource guards reject impossible grid and image allocations before allocating', () => {
  assert.throws(() => createGrid(MAX_GRID_CELLS + 1, 1), /grid exceeds/);
  assert.throws(() => resizeNearestNeighbor({
    width: 1,
    height: 1,
    rgba: new Uint8ClampedArray([0, 0, 0, 255]),
  }, MAX_IMAGE_PIXELS + 1, 1), /target image exceeds/);
});

test('palette validation rejects malformed identity and RGB Hex drift', () => {
  assert.throws(() => validatePalette({ ...palette, id: '' }), /palette id/);
  assert.throws(() => validatePalette({
    ...palette,
    colors: [{ id: 'bad', code: 'B', rgb: { r: 1, g: 2, b: 3 }, hex: '#000000' }],
  }), /rgb and hex do not match/);
});

test('width and long-side grid semantics are explicit', () => {
  assert.deepEqual(calculateGridDimensions(300, 400, { axis: 'width', size: 40 }), {
    width: 40,
    height: 53,
  });
  assert.deepEqual(calculateGridDimensions(300, 400, { axis: 'long-side', size: 40 }), {
    width: 30,
    height: 40,
  });
  assert.throws(() => calculateGridDimensions(300, 400, {
    axis: 'invalid' as 'width',
    size: 40,
  }), /unsupported target grid axis/);
});

test('nearest-neighbor resize uses floor mapping and includes boundaries', () => {
  const resized = resizeNearestNeighbor({
    width: 2,
    height: 1,
    rgba: new Uint8ClampedArray([
      10, 20, 30, 255,
      200, 210, 220, 128,
    ]),
  }, 4, 1);
  assert.deepEqual(Array.from(resized.rgba), [
    10, 20, 30, 255,
    10, 20, 30, 255,
    200, 210, 220, 128,
    200, 210, 220, 128,
  ]);
});

test('RGB distance and palette ties are deterministic', () => {
  assert.equal(colorDistance({ r: 0, g: 0, b: 0 }, { r: 3, g: 4, b: 0 }), 5);
  assert.equal(findClosestPaletteIndex({ r: 105, g: 105, b: 105 }, palette.colors), 1);
  assert.deepEqual(createPaletteTable(palette), [
    '',
    'test-gray',
    'test-black',
    'test-near-gray',
    'test-white',
  ]);
});

test('cartoon sampling keeps the first seen palette index when final vote counts tie', () => {
  const tiePalette: Palette = {
    id: 'tie',
    version: 'tie-v1',
    colors: [
      { id: 'red', code: 'R', rgb: { r: 255, g: 0, b: 0 }, hex: '#FF0000' },
      { id: 'blue', code: 'B', rgb: { r: 0, g: 0, b: 255 }, hex: '#0000FF' },
    ],
  };
  const tieConfig: GenerationConfig = {
    ...config,
    paletteId: tiePalette.id,
    paletteVersion: tiePalette.version,
    similarityMerge: { enabled: false, threshold: 48 },
  };
  const pattern = generateBeadPattern({
    width: 4,
    height: 1,
    rgba: Uint8ClampedArray.from([
      255, 0, 0, 255,
      0, 0, 255, 255,
      0, 0, 255, 255,
      255, 0, 0, 255,
    ]),
  }, tiePalette, tieConfig);
  assert.deepEqual(Array.from(pattern.grid.cells), [1]);
  assert.deepEqual(pattern.paletteTable, ['', 'red']);
});

test('similar colors merge from lower frequency into higher frequency', () => {
  const grid = createGrid(5, 1, [1, 1, 1, 3, 2]);
  const merged = mergeSimilarColors(grid, palette, 48);
  assert.deepEqual(Array.from(merged.cells), [1, 1, 1, 1, 2]);
  assert.deepEqual(calculateStatistics(merged, palette.colors.length), {
    total: 5,
    colors: [
      { paletteIndex: 1, count: 4 },
      { paletteIndex: 2, count: 1 },
    ],
  });
});

test('similarity threshold is strict and does not merge equal distance', () => {
  const exactThresholdPalette: Palette = {
    id: 'strict-threshold',
    version: 'v1',
    colors: [
      { id: 'a', code: 'A', rgb: { r: 0, g: 0, b: 0 }, hex: '#000000' },
      { id: 'b', code: 'B', rgb: { r: 48, g: 0, b: 0 }, hex: '#300000' },
    ],
  };
  const merged = mergeSimilarColors(createGrid(2, 1, [1, 2]), exactThresholdPalette, 48);
  assert.deepEqual(Array.from(merged.cells), [1, 2]);
});

test('fully transparent samples remain EMPTY and do not enter project palette', () => {
  const pattern = generateBeadPattern({
    width: 1,
    height: 1,
    rgba: new Uint8ClampedArray([255, 255, 255, 0]),
  }, palette, config);
  assert.deepEqual(Array.from(pattern.grid.cells), [EMPTY_CELL]);
  assert.deepEqual(pattern.paletteTable, ['']);
  assert.deepEqual(calculateStatistics(pattern.grid, 0), { total: 0, colors: [] });
});

test('generation rejects mismatched palette metadata and unknown algorithms', () => {
  const image = {
    width: 1,
    height: 1,
    rgba: new Uint8ClampedArray([0, 0, 0, 255]),
  };
  assert.throws(() => generateBeadPattern(image, palette, {
    ...config,
    paletteVersion: 'wrong',
  }), /does not match/);
  assert.throws(() => generateBeadPattern(image, palette, {
    ...config,
    similarityMerge: { ...config.similarityMerge, enabled: 'yes' as unknown as boolean },
  }), /similarity merge enabled/);
});

test('serialization preserves numeric grid, config and version fields', () => {
  const pattern = {
    grid: createGrid(2, 1, [0, 4]),
    paletteId: palette.id,
    paletteVersion: palette.version,
    paletteTable: createPaletteTable(palette),
    generationConfig: config,
  };
  const serialized = serializePattern(pattern);
  const restored = deserializePattern(serialized);
  assert.equal(serialized.schemaVersion, 1);
  assert.equal(serialized.algorithmVersion, CURRENT_ALGORITHM_VERSION);
  assert.deepEqual(Array.from(restored.grid.cells), [0, 4]);
  assert.deepEqual(restored.generationConfig, config);
  assert.equal(hashGrid(restored.grid), hashGrid(pattern.grid));
});

const areaConfig: GenerationConfig = {
  ...config, algorithmVersion: 3, sampling: { strategy: 'area', scale: 1 },
  minimumCoverage: 0, averageColorSpace: 'srgb', colorDistance: 'rgb', alphaThreshold: 0,
};
const grayPalette: Palette = {
  id: palette.id, version: palette.version,
  colors: Array.from({ length: 256 }, (_, value) => ({
    id: `gray-${value}`, code: `${value}`, rgb: { r: value, g: value, b: value },
    hex: `#${value.toString(16).padStart(2, '0').repeat(3)}`,
  })),
};
function grayImage(values: number[], alphas = values.map(() => 255), height = 1) {
  return { width: values.length / height, height,
    rgba: Uint8ClampedArray.from(values.flatMap((value, index) => [value, value, value, alphas[index] ?? 255])),
  };
}
function areaIds(values: number[], alphas?: number[], overrides: Partial<GenerationConfig> = {}) {
  const base = overrides.algorithmVersion === 2 ? config : areaConfig;
  const result = generateBeadPattern(grayImage(values, alphas), grayPalette, { ...base, ...overrides });
  return Array.from(result.grid.cells, index => result.paletteTable[index]);
}

test('V3 exact odd-ratio areas and upsampling use original pixels', () => {
  assert.deepEqual(areaIds([0, 255, 0], undefined, {
    mode: 'realistic', targetGrid: { axis: 'width', size: 2 },
  }), ['gray-85', 'gray-85']);
  const expanded = generateBeadPattern(grayImage([0, 255]), grayPalette, {
    ...areaConfig, targetGrid: { axis: 'width', size: 3 }, mode: 'realistic',
  });
  assert.deepEqual(Array.from(expanded.grid.cells, index => expanded.paletteTable[index]),
    ['gray-0', 'gray-128', 'gray-255', 'gray-0', 'gray-128', 'gray-255']);
  const checker = generateBeadPattern(grayImage([0, 255, 255, 0], undefined, 2), grayPalette,
    { ...areaConfig, mode: 'realistic' });
  assert.deepEqual(checker.paletteTable, ['', 'gray-128']);
});

test('V3 alpha weights votes and sRGB averages; hidden RGB never contributes', () => {
  assert.deepEqual(areaIds([0, 255], [64, 255]), ['gray-255']);
  assert.deepEqual(areaIds([0, 255], [64, 255], { mode: 'realistic' }), ['gray-204']);
  for (const mode of ['cartoon', 'realistic'] as const) {
    assert.deepEqual(areaIds([0, 255], [0, 255], { mode }), ['gray-255']);
    assert.deepEqual(areaIds([255, 0], [0, 0], { mode }), ['']);
    assert.deepEqual(areaIds([0, 255], [127, 128], { mode, alphaThreshold: 128 }), ['gray-255']);
  }
});

test('V3 final weighted ties use first source encounter rather than palette order', () => {
  assert.deepEqual(areaIds([255, 0, 0, 255]), ['gray-255']);
  assert.deepEqual(areaIds([255, 0, 0], [128, 64, 64]), ['gray-255']);
});

test('V3 coverage uses effective alpha area and keeps equality and thin lines', () => {
  for (const mode of ['cartoon', 'realistic'] as const) {
    assert.deepEqual(areaIds([255, 0, 0, 0], [255, 0, 0, 0], { mode, minimumCoverage: 0.25 }), ['gray-255']);
    assert.deepEqual(areaIds([255, 0, 0, 0], [255, 0, 0, 0], { mode, minimumCoverage: 0.250001 }), ['']);
    assert.deepEqual(areaIds([255], [128], { mode, minimumCoverage: 128 / 255 }), ['gray-255']);
    assert.deepEqual(areaIds([255], [128], { mode, minimumCoverage: 0.51 }), ['']);
    assert.deepEqual(areaIds([255], [255], { mode, minimumCoverage: 1 }), ['gray-255']);
    assert.deepEqual(areaIds([255], [254], { mode, minimumCoverage: 1 }), ['']);
  }
});

test('V3 config is detached through clone, pattern and project persistence; V1/V2 stay unchanged', () => {
  for (const algorithmVersion of [1, 2, 3]) {
    const generationConfig = algorithmVersion === 3 ? areaConfig : { ...config, algorithmVersion };
    const pattern = { grid: createGrid(1, 1, [1]), paletteTable: ['', 'test-gray'],
      paletteId: palette.id, paletteVersion: palette.version, generationConfig };
    const clone = cloneGenerationConfig(generationConfig);
    assert.deepEqual(clone, generationConfig);
    assert.notEqual(clone.sampling, generationConfig.sampling);
    assert.deepEqual(deserializePattern(serializePattern(pattern)).generationConfig, generationConfig);
    const project = { id: 'area', name: 'Area', schemaVersion: 1, createdAt: 1, updatedAt: 1,
      grid: pattern.grid, paletteTable: pattern.paletteTable, paletteId: palette.id,
      paletteVersion: palette.version, generation: { sourceImageId: 'source', config: generationConfig } };
    const restored = deserializeProject(JSON.parse(JSON.stringify(serializeProject(project))));
    assert.deepEqual(restored, project);
    assert.notEqual(restored.generation?.config.sampling, generationConfig.sampling);
  }
});

test('V3 validation rejects missing or incompatible fields at generation and decode boundaries', () => {
  for (const invalid of [
    { minimumCoverage: undefined }, { minimumCoverage: NaN }, { minimumCoverage: -0.1 },
    { minimumCoverage: 1.01 }, { averageColorSpace: undefined }, { averageColorSpace: 'invalid' },
    { sampling: { scale: 4, strategy: 'area' } }, { sampling: { scale: 1 } },
    { algorithmVersion: 99 }, { alphaThreshold: 256 },
  ]) {
    const bad = { ...areaConfig, ...invalid } as GenerationConfig;
    assert.throws(() => parseGenerationConfig(bad));
    assert.throws(() => generateBeadPattern(grayImage([0]), grayPalette, bad));
  }
  assert.throws(() => parseGenerationConfig({ ...areaConfig, algorithmVersion: 2 }), /legacy/);
  assert.throws(() => generateBeadPattern(grayImage([0]), grayPalette,
    { ...config, algorithmVersion: 1 }), /unsupported/);
});

test('generation rejects grid, sampling and palette budgets before reading pixels', () => {
  const image = grayImage([0]);
  const trapped = { ...image, rgba: new Proxy(image.rgba, {
    get(target, key) {
      if (key !== 'length') throw new Error('pixels accessed before budget validation');
      return target.length;
    },
  }) };
  assert.throws(() => generateBeadPattern(trapped, grayPalette,
    { ...areaConfig, targetGrid: { axis: 'width', size: 1001 } }), /cell budget/);
  assert.throws(() => generateBeadPattern(trapped, grayPalette,
    { ...config, sampling: { scale: Number.MAX_SAFE_INTEGER } }), /sampling budget/);
  assert.throws(() => generateBeadPattern(trapped, grayPalette,
    { ...config, targetGrid: { axis: 'width', size: 1000 } }), /comparison budget/);
  assert.throws(() => generateBeadPattern({ ...image, width: Number.MAX_SAFE_INTEGER }, grayPalette, areaConfig), /image exceeds/);
});

test('V2 keeps nearest sampling and unweighted alpha behavior with explicit version', () => {
  assert.deepEqual(areaIds([0, 255], [64, 255], {
    ...config, algorithmVersion: 2, alphaThreshold: 0,
  }), ['gray-0']);
  assert.deepEqual(areaIds([0, 255], [64, 255], {
    ...config, algorithmVersion: 2, alphaThreshold: 0, mode: 'realistic',
  }), ['gray-128']);
});

test('V3 linear averaging and perceptual matching preserve deterministic constraints', () => {
  assert.deepEqual(areaIds([0, 255], undefined, { mode: 'realistic', averageColorSpace: 'linear' }), ['gray-188']);
  assert.deepEqual(areaIds([0, 255], undefined, { mode: 'realistic', averageColorSpace: 'srgb' }), ['gray-128']);
  for (const colorDistance of ['rgb', 'oklab'] as const) {
    for (const maxColors of [1, 2, 4]) {
      const options: GenerationConfig = { ...areaConfig, colorDistance, averageColorSpace: 'linear', maxColors, targetGrid: { axis: 'width', size: 4 } };
      const first = generateBeadPattern(grayImage([0, 100, 110, 255]), palette, options);
      assert.ok(first.paletteTable.length - 1 <= maxColors);
      assert.ok(first.paletteTable.slice(1).every(id => palette.colors.some(c => c.id === id)));
      assert.deepEqual(generateBeadPattern(grayImage([0, 100, 110, 255]), palette, options), first);
      assert.deepEqual(deserializePattern(serializePattern(first)), first);
      assert.deepEqual(cloneGenerationConfig(options), options);
      assert.deepEqual(parseGenerationConfig(options), options);
    }
  }
  assert.throws(() => parseGenerationConfig({ ...areaConfig, maxColors: 0 }));
  assert.throws(() => parseGenerationConfig({ ...areaConfig, maxColors: 2, similarityMerge: { enabled: true, threshold: 0.1 } }), /mutually exclusive/);
  assert.deepEqual(areaIds([0, 255], [0, 0], { maxColors: 1 }), ['']);
});
