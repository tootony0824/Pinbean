import { createGrid, validateGrid } from './grid.js';
import { validatePalette } from './color.js';
import {
  EMPTY_CELL,
  type BeadGrid,
  type BeadPattern,
  type GenerationConfig,
  type SerializedBeadProject,
  type SerializedBeadPattern,
  type Palette,
  isSupportedAlgorithmVersion,
} from './types.js';

export function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
}

function assertOptionalNonEmptyString(value: unknown, label: string): asserts value is string | undefined {
  if (value !== undefined && (typeof value !== 'string' || value.length === 0)) {
    throw new TypeError(`${label} must be a non-empty string when present`);
  }
}

function assertSafeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer`);
}

function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
}

function assertByteInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255) {
    throw new RangeError(`${label} must be an integer from 0 to 255`);
  }
}

function assertBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean`);
}

function assertFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError(`${label} must be a finite number`);
}

function cloneNumberArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value.map((cell, index) => {
    if (!Number.isInteger(cell) || cell < EMPTY_CELL || cell > 65_535) {
      throw new RangeError(`${label}[${index}] must be a Uint16 integer`);
    }
    return cell;
  });
}

export function parseSerializedGrid(value: unknown, label: string): { grid: BeadGrid; serialized: SerializedBeadPattern['grid'] } {
  assertRecord(value, label);
  assertPositiveInteger(value.width, `${label}.width`);
  assertPositiveInteger(value.height, `${label}.height`);
  const cells = cloneNumberArray(value.cells, `${label}.cells`);
  const grid = createGrid(value.width, value.height, cells);
  return {
    grid,
    serialized: {
      width: value.width,
      height: value.height,
      cells,
    },
  };
}

export function parsePaletteTable(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  if (value.length === 0 || value[0] !== '') throw new Error(`${label} index 0 must be EMPTY`);
  const table = Array.from({ length: value.length }, (_, index) => {
    if (!(index in value)) throw new TypeError(`${label}[${index}] must not be a hole`);
    const item = value[index];
    if (typeof item !== 'string') throw new TypeError(`${label}[${index}] must be a string`);
    return item;
  });
  const colorIds = table.slice(1);
  if (colorIds.some(id => !id)) throw new Error(`${label} contains an empty color id`);
  if (new Set(colorIds).size !== colorIds.length) throw new Error(`${label} contains duplicate color ids`);
  return table;
}

export function validateBeadPattern(pattern: BeadPattern, palette?: Palette): void {
  if (!pattern || typeof pattern !== 'object') throw new TypeError('pattern must be an object');
  if (typeof pattern.paletteId !== 'string' || pattern.paletteId.length === 0
    || typeof pattern.paletteVersion !== 'string' || pattern.paletteVersion.length === 0) {
    throw new TypeError('pattern palette metadata must be non-empty strings');
  }
  const paletteTable = parsePaletteTable(pattern.paletteTable, 'pattern palette table');
  validateGrid(pattern.grid, paletteTable.length - 1);
  parseGenerationConfig(pattern.generationConfig, {
    paletteId: pattern.paletteId,
    paletteVersion: pattern.paletteVersion,
  });
  if (palette) {
    validatePalette(palette);
    if (pattern.paletteId !== palette.id || pattern.paletteVersion !== palette.version) {
      throw new Error('pattern palette metadata does not match supplied palette');
    }
    const available = new Set(palette.colors.map(color => color.id));
    for (const colorId of paletteTable.slice(1)) {
      if (!available.has(colorId)) throw new Error(`pattern references unavailable palette color: ${colorId}`);
    }
  }
}

export function parseGenerationConfig(
  value: unknown,
  expectedPalette?: { paletteId: string; paletteVersion: string },
): GenerationConfig {
  assertRecord(value, 'generation config');
  if (!isSupportedAlgorithmVersion(value.algorithmVersion)) {
    throw new Error(`unsupported algorithm version: ${String(value.algorithmVersion)}`);
  }
  if (value.mode !== 'cartoon' && value.mode !== 'realistic') {
    throw new Error(`unsupported generation mode: ${String(value.mode)}`);
  }
  assertRecord(value.targetGrid, 'generation config targetGrid');
  if (value.targetGrid.axis !== 'width' && value.targetGrid.axis !== 'long-side') {
    throw new Error(`unsupported target grid axis: ${String(value.targetGrid.axis)}`);
  }
  assertPositiveInteger(value.targetGrid.size, 'generation config target grid size');
  assertRecord(value.sampling, 'generation config sampling');
  assertPositiveInteger(value.sampling.scale, 'generation config sampling scale');
  if (value.algorithmVersion === 3) {
    if (value.sampling.strategy !== 'area' || value.sampling.scale !== 1) {
      throw new Error('V3 sampling requires area strategy and scale 1');
    }
    if (value.colorDistance !== 'rgb' && value.colorDistance !== 'oklab') throw new Error('V3 colorDistance must be rgb or oklab');
    if (value.averageColorSpace !== 'srgb' && value.averageColorSpace !== 'linear') throw new Error('V3 averageColorSpace must be srgb or linear');
    if (value.maxColors !== undefined) {
      assertPositiveInteger(value.maxColors, 'generation config maxColors');
      if (value.maxColors > 65_535) throw new RangeError('maxColors exceeds palette capacity');
    }
    assertFiniteNumber(value.minimumCoverage, 'generation config minimumCoverage');
    if (value.minimumCoverage < 0 || value.minimumCoverage > 1) {
      throw new RangeError('minimumCoverage must be from 0 to 1');
    }
  } else if (value.minimumCoverage !== undefined || value.averageColorSpace !== undefined
    || value.colorDistance !== undefined || value.maxColors !== undefined
    || (value.sampling.strategy !== undefined && value.sampling.strategy !== 'nearest')) {
    throw new Error('legacy generation config cannot use V3 fields');
  }
  assertNonEmptyString(value.paletteId, 'generation config paletteId');
  assertNonEmptyString(value.paletteVersion, 'generation config paletteVersion');
  if (expectedPalette && (value.paletteId !== expectedPalette.paletteId || value.paletteVersion !== expectedPalette.paletteVersion)) {
    throw new Error('generation config does not match palette metadata');
  }
  assertRecord(value.similarityMerge, 'generation config similarityMerge');
  assertBoolean(value.similarityMerge.enabled, 'generation config similarityMerge.enabled');
  assertFiniteNumber(value.similarityMerge.threshold, 'generation config similarityMerge.threshold');
  if (value.similarityMerge.threshold < 0) throw new RangeError('generation config similarity threshold must be non-negative');
  if (value.maxColors !== undefined && value.similarityMerge.enabled) throw new Error('maxColors and similarityMerge are mutually exclusive');
  assertByteInteger(value.alphaThreshold, 'generation config alphaThreshold');
  return {
    algorithmVersion: value.algorithmVersion,
    mode: value.mode,
    targetGrid: {
      axis: value.targetGrid.axis,
      size: value.targetGrid.size,
    },
    sampling: {
      scale: value.sampling.scale,
      ...(value.sampling.strategy !== undefined ? { strategy: value.sampling.strategy } : {}),
    },
    paletteId: value.paletteId,
    paletteVersion: value.paletteVersion,
    similarityMerge: {
      enabled: value.similarityMerge.enabled,
      threshold: value.similarityMerge.threshold,
    },
    alphaThreshold: value.alphaThreshold,
    ...(value.minimumCoverage !== undefined ? { minimumCoverage: value.minimumCoverage } : {}),
    ...(value.averageColorSpace !== undefined ? { averageColorSpace: value.averageColorSpace } : {}),
    ...(value.colorDistance !== undefined ? { colorDistance: value.colorDistance } : {}),
    ...(value.maxColors !== undefined ? { maxColors: value.maxColors } : {}),
  };
}

export function parseSerializedPattern(value: unknown): SerializedBeadPattern {
  assertRecord(value, 'serialized pattern');
  assertSafeInteger(value.schemaVersion, 'serialized pattern schemaVersion');
  if (!isSupportedAlgorithmVersion(value.algorithmVersion)) {
    throw new Error(`unsupported algorithm version: ${String(value.algorithmVersion)}`);
  }
  assertNonEmptyString(value.paletteId, 'serialized pattern paletteId');
  assertNonEmptyString(value.paletteVersion, 'serialized pattern paletteVersion');
  const generationConfig = parseGenerationConfig(value.generationConfig, {
    paletteId: value.paletteId,
    paletteVersion: value.paletteVersion,
  });
  if (value.algorithmVersion !== generationConfig.algorithmVersion) {
    throw new Error('serialized algorithm version does not match generation config');
  }
  const paletteTable = parsePaletteTable(value.paletteTable, 'serialized pattern paletteTable');
  const { serialized: grid } = parseSerializedGrid(value.grid, 'serialized pattern grid');
  return {
    schemaVersion: value.schemaVersion,
    algorithmVersion: value.algorithmVersion,
    paletteId: value.paletteId,
    paletteVersion: value.paletteVersion,
    paletteTable,
    generationConfig,
    grid,
  };
}

export function parseSerializedProject(value: unknown): SerializedBeadProject {
  assertRecord(value, 'serialized project');
  assertSafeInteger(value.schemaVersion, 'serialized project schemaVersion');
  assertNonEmptyString(value.id, 'serialized project id');
  assertSafeInteger(value.createdAt, 'serialized project createdAt');
  assertSafeInteger(value.updatedAt, 'serialized project updatedAt');
  if (value.updatedAt < value.createdAt) throw new RangeError('updatedAt must not precede createdAt');
  assertNonEmptyString(value.name, 'serialized project name');
  assertNonEmptyString(value.paletteId, 'serialized project paletteId');
  assertNonEmptyString(value.paletteVersion, 'serialized project paletteVersion');
  const paletteTable = parsePaletteTable(value.paletteTable, 'serialized project paletteTable');
  const { serialized: grid } = parseSerializedGrid(value.grid, 'serialized project grid');
  let generation: SerializedBeadProject['generation'];
  if (value.generation !== undefined) {
    assertRecord(value.generation, 'serialized project generation');
    assertOptionalNonEmptyString(value.generation.sourceImageId, 'serialized project generation sourceImageId');
    const config = parseGenerationConfig(value.generation.config, {
      paletteId: value.paletteId,
      paletteVersion: value.paletteVersion,
    });
    generation = {
      ...(value.generation.sourceImageId ? { sourceImageId: value.generation.sourceImageId } : {}),
      config,
    };
  }
  return {
    id: value.id,
    schemaVersion: value.schemaVersion,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    name: value.name,
    grid,
    paletteId: value.paletteId,
    paletteVersion: value.paletteVersion,
    paletteTable,
    ...(generation ? { generation } : {}),
  };
}
