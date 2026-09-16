import {
  CURRENT_ALGORITHM_VERSION,
  EMPTY_CELL,
  calculateStatistics,
  createGrid,
  generateBeadPattern,
  type BeadPattern,
  type GenerationConfig,
  type NormalizedImage,
  type Palette,
} from '@pinbean/bead-core';
import {
  getSupplierPaletteFromHexes,
  type ColorSystem,
} from '@pinbean/palette-data';

import {
  PixelationMode,
  type MappedPixel,
  type PaletteColor,
} from '../utils/pixelation';
import { transparentColorData } from '../utils/pixelEditingUtils';

interface WebCorePalette {
  palette: Palette;
  colorsById: Map<string, PaletteColor>;
}

export interface WebPatternView {
  counts: Record<string, { count: number; color: string }>;
  mappedPixelData: MappedPixel[][];
  totalCount: number;
}

export interface GenerateWebPatternInput {
  algorithmVersion?: 2 | 3;
  colorDistance?: GenerationConfig['colorDistance'];
  averageColorSpace?: GenerationConfig['averageColorSpace'];
  minimumCoverage?: number;
  maxColors?: number;
  image: NormalizedImage;
  detailLevel: number;
  similarityThreshold: number;
  currentPalette: PaletteColor[];
  mode: PixelationMode;
  colorSystem: ColorSystem;
}

export interface GenerateWebPatternResult {
  pattern: BeadPattern;
  mappedPixelData: MappedPixel[][];
  dimensions: { N: number; M: number };
  counts: Record<string, { count: number; color: string }>;
  totalCount: number;
}

export function createWebCorePalette(
  currentPalette: PaletteColor[],
  colorSystem: ColorSystem,
): WebCorePalette {
  const palette = getSupplierPaletteFromHexes(
    colorSystem,
    currentPalette.map(color => color.hex),
  );
  const colorsById = new Map<string, PaletteColor>();
  for (const color of palette.colors) {
    colorsById.set(color.id, {
      key: color.code,
      hex: color.hex,
      rgb: { ...color.rgb },
    });
  }
  return {
    palette,
    colorsById,
  };
}

export function imageDataToNormalizedImage(
  imageData: Pick<ImageData, 'width' | 'height' | 'data'>,
): NormalizedImage {
  return {
    width: imageData.width,
    height: imageData.height,
    rgba: imageData.data,
  };
}

export function patternToMappedPixels(
  pattern: BeadPattern,
  colorsById: ReadonlyMap<string, PaletteColor>,
): MappedPixel[][] {
  const rows: MappedPixel[][] = [];
  for (let row = 0; row < pattern.grid.height; row += 1) {
    const mappedRow: MappedPixel[] = [];
    for (let column = 0; column < pattern.grid.width; column += 1) {
      const paletteIndex = pattern.grid.cells[row * pattern.grid.width + column] ?? EMPTY_CELL;
      if (paletteIndex === EMPTY_CELL) {
        mappedRow.push({ ...transparentColorData });
        continue;
      }
      const colorId = pattern.paletteTable[paletteIndex];
      const color = colorId ? colorsById.get(colorId) : undefined;
      if (!color) {
        throw new Error(`Pattern references unavailable palette index ${paletteIndex}`);
      }
      mappedRow.push({ key: color.key, color: color.hex, isExternal: false });
    }
    rows.push(mappedRow);
  }
  return rows;
}

export function generateWebPattern(input: GenerateWebPatternInput): GenerateWebPatternResult {
  if (input.algorithmVersion !== 3 && (input.colorDistance !== undefined || input.averageColorSpace !== undefined || input.minimumCoverage !== undefined || input.maxColors !== undefined)) {
    throw new Error('V3 parameters require explicit algorithmVersion 3')
  }
  const webPalette = createWebCorePalette(input.currentPalette, input.colorSystem);
  const config: GenerationConfig = {
    algorithmVersion: input.algorithmVersion ?? CURRENT_ALGORITHM_VERSION,
    mode: input.mode === PixelationMode.Dominant ? 'cartoon' : 'realistic',
    targetGrid: { axis: 'width', size: input.detailLevel },
    sampling: input.algorithmVersion === 3 ? { scale: 1, strategy: 'area' } : { scale: 4 },
    paletteId: webPalette.palette.id,
    paletteVersion: webPalette.palette.version,
    similarityMerge: {
      enabled: input.maxColors === undefined,
      threshold: input.similarityThreshold,
    },
    alphaThreshold: 128,
    ...(input.algorithmVersion === 3 ? {
      colorDistance: input.colorDistance ?? 'rgb',
      averageColorSpace: input.averageColorSpace ?? 'srgb',
      minimumCoverage: input.minimumCoverage ?? 0,
    } : {}),
    ...(input.maxColors !== undefined ? { maxColors: input.maxColors } : {}),
  };
  const pattern = generateBeadPattern(input.image, webPalette.palette, config);
  const view = patternToWebView(pattern, input.currentPalette, input.colorSystem);
  return {
    pattern,
    mappedPixelData: view.mappedPixelData,
    dimensions: { N: pattern.grid.width, M: pattern.grid.height },
    counts: view.counts,
    totalCount: view.totalCount,
  };
}

export function mappedPixelsToWebPattern(
  mappedPixelData: MappedPixel[][],
  currentPalette: PaletteColor[],
  colorSystem: ColorSystem,
): GenerateWebPatternResult {
  const height = mappedPixelData.length;
  const width = mappedPixelData[0]?.length ?? 0;
  if (width <= 0 || height <= 0) throw new Error('Imported pattern must not be empty');
  if (mappedPixelData.some(row => row.length !== width)) throw new Error('Imported pattern rows must have a consistent width');
  const webPalette = createWebCorePalette(currentPalette, colorSystem);
  const colorIdByHex = new Map(webPalette.palette.colors.map(color => [color.hex.toUpperCase(), color.id]));
  const paletteTable = [''];
  const indexByColorId = new Map<string, number>();
  const cells: number[] = [];
  for (const row of mappedPixelData) {
    for (const cell of row) {
      if (!cell || cell.isExternal || cell.key === transparentColorData.key) {
        cells.push(EMPTY_CELL);
        continue;
      }
      const colorId = colorIdByHex.get(cell.color.toUpperCase());
      if (!colorId) throw new Error(`Imported CSV references an unavailable palette color: ${cell.color}`);
      let paletteIndex = indexByColorId.get(colorId);
      if (!paletteIndex) {
        paletteIndex = paletteTable.length;
        paletteTable.push(colorId);
        indexByColorId.set(colorId, paletteIndex);
      }
      cells.push(paletteIndex);
    }
  }
  const pattern: BeadPattern = {
    grid: createGrid(width, height, cells),
    paletteId: webPalette.palette.id,
    paletteVersion: webPalette.palette.version,
    paletteTable,
    generationConfig: {
      algorithmVersion: CURRENT_ALGORITHM_VERSION,
      mode: 'cartoon',
      targetGrid: { axis: 'width', size: width },
      sampling: { scale: 4 },
      paletteId: webPalette.palette.id,
      paletteVersion: webPalette.palette.version,
      similarityMerge: { enabled: false, threshold: 0 },
      alphaThreshold: 128,
    },
  };
  const view = patternToWebView(pattern, currentPalette, colorSystem);
  return {
    pattern,
    mappedPixelData: view.mappedPixelData,
    dimensions: { N: width, M: height },
    counts: view.counts,
    totalCount: view.totalCount,
  };
}

export function patternToWebView(
  pattern: BeadPattern,
  currentPalette: PaletteColor[],
  colorSystem: ColorSystem,
  palette?: Palette,
): WebPatternView {
  const webPalette = palette ? {
    palette,
    colorsById: new Map(palette.colors.map(color => [color.id, { key: color.code, hex: color.hex, rgb: color.rgb }])),
  } : createWebCorePalette(currentPalette, colorSystem);
  if (pattern.paletteId !== webPalette.palette.id || pattern.paletteVersion !== webPalette.palette.version) {
    throw new Error('Pattern palette identity does not match the current Web palette');
  }
  const mappedPixelData = patternToMappedPixels(pattern, webPalette.colorsById);
  const statistics = calculateStatistics(pattern.grid, pattern.paletteTable.length - 1);
  const counts: Record<string, { count: number; color: string }> = {};
  for (const item of statistics.colors) {
    const colorId = pattern.paletteTable[item.paletteIndex];
    const color = colorId ? webPalette.colorsById.get(colorId) : undefined;
    if (!color) throw new Error(`Statistics reference unavailable palette index ${item.paletteIndex}`);
    const hexKey = color.hex;
    const existing = counts[hexKey];
    if (existing) existing.count += item.count;
    else counts[hexKey] = { count: item.count, color: color.hex };
  }
  return {
    mappedPixelData,
    counts,
    totalCount: statistics.total,
  };
}
