import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWebCorePalette,
  generateWebPattern,
  patternToMappedPixels,
} from '../src/adapters/beadCoreAdapter';
import { PixelationMode, type PaletteColor } from '../src/utils/pixelation';

const palette: PaletteColor[] = [
  { key: 'T01', hex: '#FFFFFF', rgb: { r: 255, g: 255, b: 255 } },
  { key: 'H07', hex: '#000000', rgb: { r: 0, g: 0, b: 0 } },
];

test('Web adapter preserves color codes while core uses stable local indexes', () => {
  const result = generateWebPattern({
    image: {
      width: 4,
      height: 1,
      rgba: new Uint8ClampedArray([
        230, 230, 230, 255,
        0, 0, 0, 255,
        10, 10, 10, 255,
        20, 20, 20, 255,
      ]),
    },
    detailLevel: 1,
    similarityThreshold: 0,
    currentPalette: palette,
    mode: PixelationMode.Dominant,
    colorSystem: 'MARD',
  });
  assert.deepEqual(result.dimensions, { N: 1, M: 1 });
  assert.deepEqual(result.pattern.paletteTable, ['', 'pinbean:color:H07']);
  assert.deepEqual(result.mappedPixelData, [[{
    key: 'H07',
    color: '#000000',
    isExternal: false,
  }]]);
  assert.deepEqual(result.counts, { '#000000': { count: 1, color: '#000000' } });
  assert.equal(result.totalCount, 1);
});

test('Web adapter keeps transparent cells distinct from white beads', () => {
  const result = generateWebPattern({
    image: {
      width: 2,
      height: 1,
      rgba: new Uint8ClampedArray([
        255, 255, 255, 255,
        0, 0, 0, 0,
      ]),
    },
    detailLevel: 2,
    similarityThreshold: 0,
    currentPalette: palette,
    mode: PixelationMode.Average,
    colorSystem: 'MARD',
  });
  assert.equal(result.mappedPixelData[0]?.[0]?.key, 'T01');
  assert.equal(result.mappedPixelData[0]?.[0]?.isExternal, false);
  assert.equal(result.mappedPixelData[0]?.[1]?.key, 'ERASE');
  assert.equal(result.mappedPixelData[0]?.[1]?.isExternal, true);
  assert.equal(result.totalCount, 1);
});

test('missing project palette identity fails explicitly', () => {
  const corePalette = createWebCorePalette(palette, 'MARD');
  const result = generateWebPattern({
    image: { width: 1, height: 1, rgba: new Uint8ClampedArray([0, 0, 0, 255]) },
    detailLevel: 1,
    similarityThreshold: 0,
    currentPalette: palette,
    mode: PixelationMode.Dominant,
    colorSystem: 'MARD',
  });
  assert.throws(() => patternToMappedPixels(result.pattern, new Map()), /unavailable palette index/);
  assert.equal(corePalette.colorsById.size, 2);
});
