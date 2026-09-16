import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

import { calculateStatistics, hashPattern } from '@pinbean/bead-core';

import { generateWebPattern } from '../src/adapters/beadCoreAdapter';
import {
  createMardPalette,
  decodeFixture,
  realImageCases,
} from '../tests/support/realImageCases.mts';

const CELL_SIZE = 8;

function crc32(data: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const result = Buffer.alloc(12 + data.byteLength);
  result.writeUInt32BE(data.byteLength, 0);
  typeBytes.copy(result, 4);
  Buffer.from(data).copy(result, 8);
  result.writeUInt32BE(crc32(result.subarray(4, 8 + data.byteLength)), 8 + data.byteLength);
  return result;
}

function encodePreview(mappedPixels: ReturnType<typeof generateWebPattern>['mappedPixelData']): Buffer {
  const gridHeight = mappedPixels.length;
  const gridWidth = mappedPixels[0]?.length ?? 0;
  const width = gridWidth * CELL_SIZE;
  const height = gridHeight * CELL_SIZE;
  const rowLength = width * 4 + 1;
  const raw = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowLength;
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const cell = mappedPixels[Math.floor(y / CELL_SIZE)]?.[Math.floor(x / CELL_SIZE)];
      const pixelOffset = rowOffset + 1 + x * 4;
      if (!cell || cell.isExternal) {
        raw[pixelOffset + 3] = 0;
        continue;
      }
      const hex = cell.color.replace('#', '');
      raw[pixelOffset] = Number.parseInt(hex.slice(0, 2), 16);
      raw[pixelOffset + 1] = Number.parseInt(hex.slice(2, 4), 16);
      raw[pixelOffset + 2] = Number.parseInt(hex.slice(4, 6), 16);
      raw[pixelOffset + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', new Uint8Array()),
  ]);
}

const outputDirectory = resolve('tests/fixtures/real-images/expected');
mkdirSync(outputDirectory, { recursive: true });

for (const testCase of realImageCases) {
  const generated = generateWebPattern({
    image: decodeFixture(testCase.fixtureName),
    detailLevel: 32,
    similarityThreshold: 15,
    currentPalette: createMardPalette(),
    mode: testCase.mode,
    colorSystem: 'MARD',
  });
  const statistics = calculateStatistics(
    generated.pattern.grid,
    generated.pattern.paletteTable.length - 1,
  );
  const basename = `${testCase.fixtureName}-${testCase.mode}`;
  const expected = {
    name: basename,
    config: {
      detailLevel: 32,
      similarityThreshold: 15,
      mode: testCase.mode,
      colorSystem: 'MARD',
    },
    expected: {
      width: generated.pattern.grid.width,
      height: generated.pattern.grid.height,
      total: statistics.total,
      colorCount: statistics.colors.length,
      gridHash: hashPattern(generated.pattern),
      paletteTable: generated.pattern.paletteTable,
      statistics: statistics.colors,
      cells: Array.from(generated.pattern.grid.cells),
    },
  };
  const jsonPath = resolve(outputDirectory, `${basename}.json`);
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(expected, null, 2)}\n`);
  writeFileSync(resolve(outputDirectory, `${basename}-preview.png`), encodePreview(generated.mappedPixelData));
}

