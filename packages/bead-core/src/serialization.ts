import { cloneGenerationConfig } from './generation.js';
import { createGrid, validateGrid } from './grid.js';
import {
  CURRENT_SCHEMA_VERSION,
  type BeadPattern,
  type SerializedBeadPattern,
  isSupportedAlgorithmVersion,
} from './types.js';
import { parseGenerationConfig, parsePaletteTable, parseSerializedPattern } from './validation.js';

function validatePattern(pattern: BeadPattern): { config: BeadPattern['generationConfig']; paletteTable: string[] } {
  const paletteTable = parsePaletteTable(pattern.paletteTable, 'pattern paletteTable');
  validateGrid(pattern.grid, paletteTable.length - 1);
  if (!isSupportedAlgorithmVersion(pattern.generationConfig.algorithmVersion)) {
    throw new Error(`unsupported algorithm version: ${pattern.generationConfig.algorithmVersion}`);
  }
  const config = parseGenerationConfig(pattern.generationConfig, {
    paletteId: pattern.paletteId,
    paletteVersion: pattern.paletteVersion,
  });
  return { config, paletteTable };
}

export function serializePattern(pattern: BeadPattern): SerializedBeadPattern {
  const { config, paletteTable } = validatePattern(pattern);
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    algorithmVersion: config.algorithmVersion,
    paletteId: pattern.paletteId,
    paletteVersion: pattern.paletteVersion,
    paletteTable,
    generationConfig: cloneGenerationConfig(config),
    grid: {
      width: pattern.grid.width,
      height: pattern.grid.height,
      cells: Array.from(pattern.grid.cells),
    },
  };
}

export function deserializePattern(input: unknown): BeadPattern {
  const serialized = parseSerializedPattern(input);
  if (serialized.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(`unsupported schema version: ${serialized.schemaVersion}`);
  }
  const grid = createGrid(serialized.grid.width, serialized.grid.height, serialized.grid.cells);
  validateGrid(grid, serialized.paletteTable.length - 1);
  return {
    grid,
    paletteId: serialized.paletteId,
    paletteVersion: serialized.paletteVersion,
    paletteTable: [...serialized.paletteTable],
    generationConfig: cloneGenerationConfig(serialized.generationConfig),
  };
}
