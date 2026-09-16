import assert from 'node:assert/strict';
import test from 'node:test';
import { generateWebPattern, createWebCorePalette } from '../src/adapters/beadCoreAdapter';
import { generatePattern } from '../../miniapp-uni/src/services/generation';
import { createMardPalette, decodeFixture } from './support/realImageCases.mts';
import { PixelationMode } from '../src/utils/pixelation';

test('explicit V3 services agree on RGBA, configuration, and restricted allowed palette', () => {
  const image = decodeFixture('line-art');
  const currentPalette = createMardPalette().slice(0, 20);
  const allowedIds = createWebCorePalette(currentPalette, 'MARD').palette.colors.map(c => c.id);
  for (const mode of [PixelationMode.Dominant, PixelationMode.Average]) {
    for (const averageColorSpace of ['srgb', 'linear'] as const) {
      const options = { algorithmVersion: 3 as const, colorDistance: 'oklab' as const, averageColorSpace, minimumCoverage: 0.25, maxColors: 4, similarityThreshold: 48, colorSystem: 'MARD' as const };
      const web = generateWebPattern({ ...options, image, currentPalette, detailLevel: 32, mode });
      const uni = generatePattern(image, { ...options, gridSize: 32, mode: mode === PixelationMode.Dominant ? 'cartoon' : 'realistic', selectedColorIds: allowedIds });
      assert.deepEqual(uni.pattern, web.pattern);
      assert.ok(web.pattern.paletteTable.length <= 5);
    }
  }
});
