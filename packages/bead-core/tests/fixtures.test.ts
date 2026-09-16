import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  CURRENT_ALGORITHM_VERSION,
  calculateStatistics,
  generateBeadPattern,
  hashPattern,
  type GenerationConfig,
  type Palette,
} from '../src/index.js';

interface Fixture {
  name: string;
  image: { width: number; height: number; rgba: number[] };
  config: Omit<GenerationConfig, 'algorithmVersion' | 'paletteId' | 'paletteVersion'>;
  expected: {
    width: number;
    height: number;
    cells: number[];
    total: number;
    colorCount: number;
    paletteTable: string[];
    gridHash: string;
  };
}

const fixturePalette: Palette = {
  id: 'fixture-gray',
  version: 'fixture-gray-v1',
  colors: [
    { id: 'fixture-gray-mid', code: 'G1', rgb: { r: 100, g: 100, b: 100 }, hex: '#646464' },
    { id: 'fixture-black', code: 'B1', rgb: { r: 0, g: 0, b: 0 }, hex: '#000000' },
    { id: 'fixture-white', code: 'W1', rgb: { r: 255, g: 255, b: 255 }, hex: '#FFFFFF' },
  ],
};

for (const filename of ['cartoon-vote.json', 'realistic-alpha.json']) {
  test(`synthetic fixture: ${filename}`, () => {
    const fixture = JSON.parse(readFileSync(
      new URL(`../fixtures/synthetic/${filename}`, import.meta.url),
      'utf8',
    )) as Fixture;
    const generationConfig: GenerationConfig = {
      ...fixture.config,
      algorithmVersion: CURRENT_ALGORITHM_VERSION,
      paletteId: fixturePalette.id,
      paletteVersion: fixturePalette.version,
    };
    const pattern = generateBeadPattern({
      width: fixture.image.width,
      height: fixture.image.height,
      rgba: Uint8ClampedArray.from(fixture.image.rgba),
    }, fixturePalette, generationConfig);
    const stats = calculateStatistics(pattern.grid, pattern.paletteTable.length - 1);
    assert.equal(pattern.grid.width, fixture.expected.width, fixture.name);
    assert.equal(pattern.grid.height, fixture.expected.height, fixture.name);
    assert.deepEqual(Array.from(pattern.grid.cells), fixture.expected.cells, fixture.name);
    assert.equal(stats.total, fixture.expected.total, fixture.name);
    assert.equal(stats.colors.length, fixture.expected.colorCount, fixture.name);
    assert.deepEqual(pattern.paletteTable, fixture.expected.paletteTable, fixture.name);
    assert.equal(hashPattern(pattern), fixture.expected.gridHash, fixture.name);
  });
}
