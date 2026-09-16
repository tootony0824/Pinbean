import { parseGenerationConfig } from './validation.js';
import { colorDistance, rgbToOklab, compactPaletteTable, findClosestPaletteIndex, validatePalette } from './color.js';
import { createGrid } from './grid.js';
import { resizeNearestNeighbor, validateImage } from './image.js';
import { mergeSimilarColors } from './merge.js';
import {
  AREA_ALGORITHM_VERSION,
  type BeadPattern,
  type BeadGrid,
  type GenerationConfig,
  type NormalizedImage,
  type Palette,
  type RgbColor,
} from './types.js';

export function cloneGenerationConfig(config: GenerationConfig): GenerationConfig {
  return {
    algorithmVersion: config.algorithmVersion,
    mode: config.mode,
    targetGrid: { ...config.targetGrid },
    sampling: { ...config.sampling },
    paletteId: config.paletteId,
    paletteVersion: config.paletteVersion,
    similarityMerge: { ...config.similarityMerge },
    alphaThreshold: config.alphaThreshold,
    ...(config.minimumCoverage !== undefined ? { minimumCoverage: config.minimumCoverage } : {}),
    ...(config.averageColorSpace !== undefined ? { averageColorSpace: config.averageColorSpace } : {}),
    ...(config.colorDistance !== undefined ? { colorDistance: config.colorDistance } : {}),
    ...(config.maxColors !== undefined ? { maxColors: config.maxColors } : {}),
  };
}

export function calculateGridDimensions(
  imageWidth: number,
  imageHeight: number,
  target: GenerationConfig['targetGrid'],
): { width: number; height: number } {
  if (!Number.isFinite(imageWidth) || imageWidth <= 0
    || !Number.isFinite(imageHeight) || imageHeight <= 0) {
    throw new RangeError('image dimensions must be positive');
  }
  if (!Number.isInteger(target.size) || target.size <= 0) {
    throw new RangeError('target grid size must be a positive integer');
  }
  if (target.axis !== 'width' && target.axis !== 'long-side') {
    throw new Error(`unsupported target grid axis: ${String(target.axis)}`);
  }
  if (target.axis === 'width') {
    return {
      width: target.size,
      height: Math.max(1, Math.round(target.size * imageHeight / imageWidth)),
    };
  }
  if (imageWidth >= imageHeight) {
    return {
      width: target.size,
      height: Math.max(1, Math.round(target.size * imageHeight / imageWidth)),
    };
  }
  return {
    width: Math.max(1, Math.round(target.size * imageWidth / imageHeight)),
    height: target.size,
  };
}

export function validateGenerationConfig(config: GenerationConfig, palette: Palette): void {
  if (config.similarityMerge && typeof config.similarityMerge.enabled !== 'boolean') {
    throw new TypeError('similarity merge enabled must be a boolean');
  }
  parseGenerationConfig(config, { paletteId: palette.id, paletteVersion: palette.version });
  if (config.algorithmVersion !== 2 && config.algorithmVersion !== AREA_ALGORITHM_VERSION) {
    throw new Error(`unsupported generation algorithm version: ${config.algorithmVersion}`);
  }
}

function rgbCacheKey(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}

export function generateBeadPattern(
  image: NormalizedImage,
  palette: Palette,
  config: GenerationConfig,
): BeadPattern {
  validateImage(image);
  validatePalette(palette);
  validateGenerationConfig(config, palette);
  const dimensions = calculateGridDimensions(image.width, image.height, config.targetGrid);
  const scale = config.sampling.scale;
  validateGenerationBudget(image, dimensions, config, palette.colors.length);
  const sampled = config.algorithmVersion === 2
    ? resizeNearestNeighbor(image, dimensions.width * scale, dimensions.height * scale)
    : image;
  const grid = createGrid(dimensions.width, dimensions.height);
  const rgbToPaletteIndex = new Map<number, number>();

  const perceptual = config.algorithmVersion === 3 && config.colorDistance === 'oklab';
  const mappedPalette = perceptual ? palette.colors.map(color => ({ ...color, rgb: rgbToOklab(color.rgb) })) : palette.colors;
  const mapRgb = (rgb: RgbColor): number => {
    const key = rgbCacheKey(rgb.r, rgb.g, rgb.b);
    const cached = rgbToPaletteIndex.get(key);
    if (cached !== undefined) return cached;
    const paletteIndex = findClosestPaletteIndex(perceptual ? rgbToOklab(rgb) : rgb, mappedPalette);
    if (rgbToPaletteIndex.size < 65_536) rgbToPaletteIndex.set(key, paletteIndex);
    return paletteIndex;
  };

  for (let gridY = 0; gridY < dimensions.height; gridY += 1) {
    for (let gridX = 0; gridX < dimensions.width; gridX += 1) {
      if (config.algorithmVersion === AREA_ALGORITHM_VERSION) {
        grid.cells[gridY * dimensions.width + gridX] = sampleAreaCell(
          image, dimensions, gridX, gridY, config, mapRgb,
        );
        continue;
      }
      let opaqueCount = 0;
      let redTotal = 0;
      let greenTotal = 0;
      let blueTotal = 0;
      const counts = config.mode === 'cartoon' ? new Map<number, number>() : undefined;
      let selectedIndex = 0;

      for (let sampleY = 0; sampleY < scale; sampleY += 1) {
        for (let sampleX = 0; sampleX < scale; sampleX += 1) {
          const x = gridX * scale + sampleX;
          const y = gridY * scale + sampleY;
          const offset = (y * sampled.width + x) * 4;
          const alpha = sampled.rgba[offset + 3] ?? 0;
          if (alpha < config.alphaThreshold) continue;
          const r = sampled.rgba[offset] ?? 0;
          const g = sampled.rgba[offset + 1] ?? 0;
          const b = sampled.rgba[offset + 2] ?? 0;
          opaqueCount += 1;

          if (config.mode === 'realistic') {
            redTotal += r;
            greenTotal += g;
            blueTotal += b;
          } else if (counts) {
            const paletteIndex = mapRgb({ r, g, b });
            counts.set(paletteIndex, (counts.get(paletteIndex) ?? 0) + 1);
          }
        }
      }

      if (opaqueCount > 0) {
        if (config.mode === 'realistic') {
          selectedIndex = mapRgb({
            r: Math.round(redTotal / opaqueCount),
            g: Math.round(greenTotal / opaqueCount),
            b: Math.round(blueTotal / opaqueCount),
          });
        } else if (counts) {
          let selectedCount = 0;
          for (const [paletteIndex, count] of counts) {
            if (count > selectedCount) {
              selectedCount = count;
              selectedIndex = paletteIndex;
            }
          }
        }
        grid.cells[gridY * dimensions.width + gridX] = selectedIndex;
      }
    }
  }

  const mergedGrid = config.similarityMerge.enabled
    ? mergeSimilarColors(grid, { ...palette, colors: mappedPalette }, config.similarityMerge.threshold)
    : grid;
  const limitedGrid = config.maxColors === undefined ? mergedGrid : limitColors(grid, mappedPalette.map(c => c.rgb), config.maxColors);
  const compacted = compactPaletteTable(limitedGrid, palette);
  return {
    grid: compacted.grid,
    paletteId: palette.id,
    paletteVersion: palette.version,
    paletteTable: compacted.paletteTable,
    generationConfig: cloneGenerationConfig(config),
  };
}

// Limits bound allocations and worst-case palette comparisons, independently of cache hits.
export const MAX_GENERATION_CELLS = 1_000_000;
export const MAX_GENERATION_VISITS = 32_000_000;
export const MAX_GENERATION_COMPARISONS = 500_000_000;

function validateGenerationBudget(
  image: NormalizedImage, dimensions: { width: number; height: number },
  config: GenerationConfig, paletteSize: number,
): void {
  const cells = dimensions.width * dimensions.height;
  if (!Number.isSafeInteger(cells) || cells > MAX_GENERATION_CELLS) {
    throw new RangeError('generation grid exceeds cell budget');
  }
  // Each source/grid boundary can add at most one interval per axis.
  const visits = config.algorithmVersion === 2
    ? cells * config.sampling.scale ** 2
    : (image.width + dimensions.width - 1) * (image.height + dimensions.height - 1);
  if (!Number.isSafeInteger(visits) || visits > MAX_GENERATION_VISITS
    || (config.algorithmVersion === 2 && visits > 16_000_000)) {
    throw new RangeError('generation exceeds sampling budget');
  }
  const comparisons = (config.mode === 'cartoon' ? visits : cells) * paletteSize
    + (config.similarityMerge.enabled ? paletteSize ** 2 : 0)
    + (config.maxColors !== undefined ? Math.min(config.maxColors, paletteSize) * paletteSize ** 2 : 0);
  if (comparisons > MAX_GENERATION_COMPARISONS) {
    throw new RangeError('generation exceeds palette comparison budget');
  }
}

function sampleAreaCell(
  image: NormalizedImage, dimensions: { width: number; height: number },
  gridX: number, gridY: number, config: GenerationConfig,
  mapRgb: (rgb: RgbColor) => number,
): number {
  // Integer scaled boundaries avoid fractional boundary drift and preserve exact ties.
  const left = gridX * image.width;
  const right = left + image.width;
  const top = gridY * image.height;
  const bottom = top + image.height;
  let weight = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  const votes = new Map<number, number>();
  for (let y = Math.floor(top / dimensions.height); y < Math.ceil(bottom / dimensions.height); y += 1) {
    const dy = Math.min(bottom, (y + 1) * dimensions.height) - Math.max(top, y * dimensions.height);
    for (let x = Math.floor(left / dimensions.width); x < Math.ceil(right / dimensions.width); x += 1) {
      const dx = Math.min(right, (x + 1) * dimensions.width) - Math.max(left, x * dimensions.width);
      const offset = (y * image.width + x) * 4;
      const alpha = image.rgba[offset + 3] ?? 0;
      if (alpha === 0 || alpha < config.alphaThreshold) continue;
      const contribution = dx * dy * alpha;
      const r = image.rgba[offset] ?? 0;
      const g = image.rgba[offset + 1] ?? 0;
      const b = image.rgba[offset + 2] ?? 0;
      weight += contribution;
      if (config.mode === 'cartoon') {
        const index = mapRgb({ r, g, b });
        votes.set(index, (votes.get(index) ?? 0) + contribution);
      } else {
        const channel = config.averageColorSpace === 'linear' ? toLinear : (v: number) => v;
        red += channel(r) * contribution;
        green += channel(g) * contribution;
        blue += channel(b) * contribution;
      }
    }
  }
  const coverage = weight / (image.width * image.height * 255);
  if (weight === 0 || coverage < (config.minimumCoverage ?? 0)) return 0;
  if (config.mode === 'realistic') {
    const channel = config.averageColorSpace === 'linear' ? fromLinear : Math.round;
    return mapRgb({ r: channel(red / weight), g: channel(green / weight), b: channel(blue / weight) });
  }
  let selected = 0;
  let maximum = 0;
  for (const [index, count] of votes) {
    if (count > maximum) { selected = index; maximum = count; }
  }
  return selected;
}

function toLinear(v: number): number { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }
function fromLinear(v: number): number { return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)); }

// Weighted medoid selection: boundary cells contribute extra error, including isolated accents.
// Candidate order and strict comparisons make ties deterministic. EMPTY is never remapped.
function limitColors(grid: BeadGrid, colors: RgbColor[], maximum: number): BeadGrid {
  const weights = new Float64Array(colors.length);
  for (let i = 0; i < grid.cells.length; i += 1) {
    const value = grid.cells[i] ?? 0;
    if (!value) continue;
    let boundary = 0;
    const x = i % grid.width;
    const neighbors = [x > 0 ? i - 1 : -1, x + 1 < grid.width ? i + 1 : -1, i - grid.width, i + grid.width];
    for (const n of neighbors) if (n >= 0 && n < grid.cells.length && grid.cells[n] !== value) boundary += 1;
    weights[value - 1] = (weights[value - 1] ?? 0) + 1 + boundary;
  }
  const used = colors.map((_, i) => i).filter(i => (weights[i] ?? 0) > 0);
  if (used.length <= maximum) return grid;
  const nearest = new Float64Array(colors.length); nearest.fill(Infinity);
  const targets = new Uint16Array(colors.length);
  const selected = new Set<number>();
  for (let step = 0; step < maximum; step += 1) {
    let best = -1, loss = Infinity;
    for (const candidate of used) {
      if (selected.has(candidate)) continue;
      let score = 0;
      for (const source of used) {
        const a = colors[source], b = colors[candidate];
        if (!a || !b) continue;
        const d = colorDistance(a, b);
        score += (weights[source] ?? 0) * Math.min(nearest[source] ?? Infinity, d * d);
      }
      if (score < loss) { best = candidate; loss = score; }
    }
    if (best < 0) break;
    selected.add(best);
    for (const source of used) {
      const a = colors[source], b = colors[best];
      if (!a || !b) continue;
      const d = colorDistance(a, b); const squared = d * d;
      if (squared < (nearest[source] ?? Infinity)) { nearest[source] = squared; targets[source] = best + 1; }
    }
  }
  return { ...grid, cells: Uint16Array.from(grid.cells, value => value ? targets[value - 1] ?? 0 : 0) };
}
