import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { getMardToHexMapping } from '../../src/utils/colorSystemUtils';
import { hexToRgb, PixelationMode, type PaletteColor } from '../../src/utils/pixelation';

export const realImageCases = [
  ...loadFixtureManifest().fixtures.flatMap(fixture => [
    { fixtureName: fixture.name, mode: PixelationMode.Dominant },
    { fixtureName: fixture.name, mode: PixelationMode.Average },
  ]),
];

export type RealImageCase = typeof realImageCases[number];

interface FixtureManifest {
  formatVersion: 1;
  fixtures: Array<{ height: number; name: string; width: number }>;
}

function loadFixtureManifest(): FixtureManifest {
  const path = fileURLToPath(new URL('../fixtures/real-images/manifest.json', import.meta.url));
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as FixtureManifest;
  assert.equal(manifest.formatVersion, 1, 'fixture manifest version must be supported');
  assert.ok(manifest.fixtures.length >= 5 && manifest.fixtures.length <= 8);
  assert.equal(new Set(manifest.fixtures.map(fixture => fixture.name)).size, manifest.fixtures.length);
  return manifest;
}

const fixtureDimensions = new Map(
  loadFixtureManifest().fixtures.map(fixture => [
    fixture.name,
    { height: fixture.height, width: fixture.width },
  ]),
);

export function createMardPalette(): PaletteColor[] {
  return Object.values(getMardToHexMapping()).map(hex => {
    const rgb = hexToRgb(hex);
    assert.ok(rgb, `Invalid MARD color ${hex}`);
    return { key: hex, hex, rgb };
  });
}

export function decodeFixture(name: string) {
  const path = fileURLToPath(new URL(`../fixtures/real-images/${name}.rgba.gz`, import.meta.url));
  const data = gunzipSync(readFileSync(path));
  const dimensions = fixtureDimensions.get(name);
  assert.ok(dimensions, `fixture dimensions must be declared for ${name}`);
  assert.equal(
    data.byteLength,
    dimensions.width * dimensions.height * 4,
    `${name} fixture must match its declared RGBA dimensions`,
  );
  return {
    ...dimensions,
    rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
  };
}

export function expectedPath(testCase: RealImageCase): string {
  return fileURLToPath(new URL(
    `../fixtures/real-images/expected/${testCase.fixtureName}-${testCase.mode}.json`,
    import.meta.url,
  ));
}
