import {
  CURRENT_ALGORITHM_VERSION,
  calculateStatistics,
  generateBeadPattern,
  type BeadPattern,
  type BeadStatistics,
  type GenerationConfig,
  type NormalizedImage,
  type Palette,
} from '@pinbean/bead-core'
import {
  getSupplierPalette,
  type ColorSystem,
} from '@pinbean/palette-data'

export type PatternMode = 'cartoon' | 'realistic'

export interface PatternSettings {
  algorithmVersion?: 2 | 3
  colorDistance?: GenerationConfig['colorDistance']
  averageColorSpace?: GenerationConfig['averageColorSpace']
  minimumCoverage?: number
  maxColors?: number
  colorSystem: ColorSystem
  gridSize: number
  mode: PatternMode
  similarityThreshold: number
  selectedColorIds?: readonly string[]
}

export interface PatternResult {
  palette: Palette
  pattern: BeadPattern
  statistics: BeadStatistics
}

export const MIN_PATTERN_GRID_SIZE = 15
export const MAX_PATTERN_GRID_SIZE = 80

export const DEFAULT_PATTERN_SETTINGS: Readonly<PatternSettings> = Object.freeze({
  colorSystem: 'MARD',
  gridSize: 50,
  mode: 'cartoon',
  similarityThreshold: 48,
})

export function generatePattern(
  image: NormalizedImage,
  settings: PatternSettings,
): PatternResult {
  if (
    !Number.isSafeInteger(settings.gridSize)
    || settings.gridSize < MIN_PATTERN_GRID_SIZE
    || settings.gridSize > MAX_PATTERN_GRID_SIZE
  ) {
    throw new RangeError(
      `图纸横向格数必须是 ${MIN_PATTERN_GRID_SIZE}–${MAX_PATTERN_GRID_SIZE} 的整数`,
    )
  }
  if (settings.algorithmVersion !== 3 && (settings.colorDistance !== undefined || settings.averageColorSpace !== undefined || settings.minimumCoverage !== undefined || settings.maxColors !== undefined)) {
    throw new Error('V3 parameters require explicit algorithmVersion 3')
  }
  const palette = getSupplierPalette(
    settings.colorSystem,
    settings.selectedColorIds,
  )
  const config: GenerationConfig = {
    algorithmVersion: settings.algorithmVersion ?? CURRENT_ALGORITHM_VERSION,
    mode: settings.mode,
    targetGrid: { axis: 'width', size: settings.gridSize },
    sampling: settings.algorithmVersion === 3 ? { scale: 1, strategy: 'area' } : { scale: 4 },
    paletteId: palette.id,
    paletteVersion: palette.version,
    similarityMerge: {
      enabled: settings.maxColors === undefined,
      threshold: settings.similarityThreshold,
    },
    alphaThreshold: 128,
    ...(settings.algorithmVersion === 3 ? {
      colorDistance: settings.colorDistance ?? 'rgb',
      averageColorSpace: settings.averageColorSpace ?? 'srgb',
      minimumCoverage: settings.minimumCoverage ?? 0,
    } : {}),
    ...(settings.maxColors !== undefined ? { maxColors: settings.maxColors } : {}),
  }
  const pattern = generateBeadPattern(image, palette, config)
  return {
    palette,
    pattern,
    statistics: calculateStatistics(pattern.grid, pattern.paletteTable.length - 1),
  }
}
