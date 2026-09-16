import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { calculateStatistics, hashPattern } from '@pinbean/bead-core';

import { generateWebPattern } from '../src/adapters/beadCoreAdapter';
import {
  createMardPalette,
  decodeFixture,
  expectedPath,
  realImageCases,
} from './support/realImageCases.mts';

interface ExpectedFixture {
  name: string;
  config: {
    detailLevel: number;
    similarityThreshold: number;
    mode: 'dominant' | 'average';
    colorSystem: string;
  };
  expected: {
    width: number;
    height: number;
    total: number;
    colorCount: number;
    gridHash: string;
    paletteTable: string[];
    statistics: Array<{ paletteIndex: number; count: number }>;
    cells: number[];
  };
}

for (const testCase of realImageCases) {
  test(`real image regression: ${testCase.fixtureName} / ${testCase.mode}`, () => {
      const expected = JSON.parse(readFileSync(expectedPath(testCase), 'utf8')) as ExpectedFixture;
      const image = decodeFixture(testCase.fixtureName);
      const input = {
        image,
        detailLevel: expected.config.detailLevel,
        similarityThreshold: expected.config.similarityThreshold,
        currentPalette: createMardPalette(),
        mode: testCase.mode,
        colorSystem: expected.config.colorSystem,
      };
      const first = generateWebPattern(input);
      const second = generateWebPattern(input);
      const hash = hashPattern(first.pattern);
      const statistics = calculateStatistics(first.pattern.grid, first.pattern.paletteTable.length - 1);

      assert.equal(hashPattern(second.pattern), hash, 'same input must remain deterministic');
      assert.deepEqual(first.dimensions, { N: expected.expected.width, M: expected.expected.height });
      assert.equal(first.totalCount, expected.expected.total);
      assert.equal(statistics.colors.length, expected.expected.colorCount);
      assert.deepEqual(statistics.colors, expected.expected.statistics);
      assert.deepEqual(first.pattern.paletteTable, expected.expected.paletteTable);
      assert.deepEqual(Array.from(first.pattern.grid.cells), expected.expected.cells);
      assert.equal(hash, expected.expected.gridHash);
  });
}
