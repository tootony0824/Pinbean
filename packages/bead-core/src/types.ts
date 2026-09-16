export const EMPTY_CELL = 0;
export const CURRENT_SCHEMA_VERSION = 1;
export const LEGACY_ALGORITHM_VERSION = 1;
// Default stays V2 until cross-platform quality acceptance.
export const CURRENT_ALGORITHM_VERSION = 2;
export const AREA_ALGORITHM_VERSION = 3;
export const SUPPORTED_ALGORITHM_VERSIONS = [LEGACY_ALGORITHM_VERSION, 2, AREA_ALGORITHM_VERSION] as const;

export function isSupportedAlgorithmVersion(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && (SUPPORTED_ALGORITHM_VERSIONS as readonly number[]).includes(value);
}

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface PaletteColor {
  id: string;
  code: string;
  name?: string;
  rgb: RgbColor;
  hex: string;
}

export interface Palette {
  id: string;
  version: string;
  colors: readonly PaletteColor[];
}

export interface NormalizedImage {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export interface BeadGrid {
  width: number;
  height: number;
  cells: Uint16Array;
}

export interface GenerationConfig {
  algorithmVersion: number;
  mode: 'cartoon' | 'realistic';
  targetGrid: {
    axis: 'width' | 'long-side';
    size: number;
  };
  sampling: {
    scale: number;
    strategy?: 'nearest' | 'area';
  };
  /** V3 palette matching metric; V2 remains RGB. */
  colorDistance?: 'rgb' | 'oklab';
  /** V3 realistic averaging space. */
  averageColorSpace?: 'srgb' | 'linear';
  /** V3 deterministic upper bound for used colors. */
  maxColors?: number;
  paletteId: string;
  paletteVersion: string;
  similarityMerge: {
    enabled: boolean;
    threshold: number;
  };
  alphaThreshold: number;
  /** Required for V3; effective alpha area / cell area, in [0, 1]. */
  minimumCoverage?: number;
}

export interface BeadPattern {
  grid: BeadGrid;
  paletteId: string;
  paletteVersion: string;
  paletteTable: readonly string[];
  generationConfig: GenerationConfig;
  /** null means unknown provenance; generationConfig then only supplies runtime defaults. */
  sourceGeneration?: BeadProject['generation'] | null;
}

export interface BeadStatistics {
  total: number;
  colors: Array<{
    paletteIndex: number;
    count: number;
  }>;
}

export type EditCommandType =
  | 'paint'
  | 'erase'
  | 'fill'
  | 'replace'
  | 'selection-fill'
  | 'background-remove';

export interface CellChange {
  index: number;
  before: number;
  after: number;
}

export interface EditCommand {
  type: EditCommandType;
  changes: readonly CellChange[];
}

export interface EditHistory {
  limit: number;
  undoStack: readonly EditCommand[];
  redoStack: readonly EditCommand[];
}

export interface BeadProject {
  id: string;
  schemaVersion: number;
  createdAt: number;
  updatedAt: number;
  name: string;
  grid: BeadGrid;
  paletteId: string;
  paletteVersion: string;
  paletteTable: readonly string[];
  generation?: {
    sourceImageId?: string;
    config: GenerationConfig;
  };
}

export interface SerializedBeadProject {
  id: string;
  schemaVersion: number;
  createdAt: number;
  updatedAt: number;
  name: string;
  grid: {
    width: number;
    height: number;
    cells: number[];
  };
  paletteId: string;
  paletteVersion: string;
  paletteTable: string[];
  generation?: {
    sourceImageId?: string;
    config: GenerationConfig;
  };
}

export interface SerializedBeadPattern {
  schemaVersion: number;
  algorithmVersion: number;
  paletteId: string;
  paletteVersion: string;
  paletteTable: string[];
  generationConfig: GenerationConfig;
  grid: {
    width: number;
    height: number;
    cells: number[];
  };
}
