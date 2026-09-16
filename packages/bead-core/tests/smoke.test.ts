import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CURRENT_ALGORITHM_VERSION,
  calculateStatistics,
  generateBeadPattern,
  type Palette,
} from '../src/index.js';

test('80 by 80 generation smoke test stays within the intended V1 data shape', () => {
  const size = 320;
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let index = 0; index < size * size; index += 1) {
    const offset = index * 4;
    rgba[offset] = index % 256;
    rgba[offset + 1] = Math.floor(index / size) % 256;
    rgba[offset + 2] = (index * 13) % 256;
    rgba[offset + 3] = 255;
  }
  const palette: Palette = {
    id: 'smoke',
    version: 'v1',
    colors: Array.from({ length: 60 }, (_, index) => {
      const r = (index * 41) % 256;
      const g = (index * 73) % 256;
      const b = (index * 109) % 256;
      return {
        id: `smoke-${index}`,
        code: `S${index}`,
        rgb: { r, g, b },
        hex: `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
      };
    }),
  };
  const pattern = generateBeadPattern({ width: size, height: size, rgba }, palette, {
    algorithmVersion: CURRENT_ALGORITHM_VERSION,
    mode: 'cartoon',
    targetGrid: { axis: 'long-side', size: 80 },
    sampling: { scale: 4 },
    paletteId: palette.id,
    paletteVersion: palette.version,
    similarityMerge: { enabled: true, threshold: 48 },
    alphaThreshold: 128,
  });
  const stats = calculateStatistics(pattern.grid, pattern.paletteTable.length - 1);
  assert.equal(pattern.grid.width, 80);
  assert.equal(pattern.grid.height, 80);
  assert.equal(pattern.grid.cells.byteLength, 80 * 80 * Uint16Array.BYTES_PER_ELEMENT);
  assert.equal(stats.total, 6_400);
  assert.ok(stats.colors.length > 0);
});
