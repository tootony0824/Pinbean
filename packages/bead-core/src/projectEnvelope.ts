import { validatePalette } from './color.js';
import { cellProgressToCompletedColorIds, restoreCellProgress, type CellProgress } from './cellProgress.js';
import { hashPattern } from './hash.js';
import { buildBoardPlan, createProductionProgress, restoreProductionProgress, type ProductionProgress } from './production.js';
import { restoreProjectWorkflow, type ProjectWorkflow } from './publishing.js';
import { restorePublishReview, type PublishReview } from './publishReview.js';
import { deserializeProject, serializeProject } from './project.js';
import { calculateStatistics } from './statistics.js';
import { assertRecord, validateBeadPattern } from './validation.js';
import { CURRENT_ALGORITHM_VERSION, type BeadPattern, type BeadProject, type BeadStatistics, type Palette, type SerializedBeadProject } from './types.js';

export const STORED_PROJECT_FORMAT_VERSION = 2;
export const PROJECT_FILE_EXTENSION = '.pinbean.json';
export const MAX_PROJECT_FILE_CHARACTERS = 5_000_000;
export interface ProjectEnvelopeMetadata {
  progress?: ProductionProgress;
  cellProgress?: CellProgress;
  workflow?: ProjectWorkflow;
  publishReview?: PublishReview;
}
export interface StoredPatternProject extends ProjectEnvelopeMetadata {
  formatVersion: typeof STORED_PROJECT_FORMAT_VERSION;
  colorSystem: string;
  selectedColorIds: readonly string[];
  project: SerializedBeadProject;
}
export interface RestoredProjectEnvelope extends ProjectEnvelopeMetadata {
  colorSystem: string;
  palette: Palette;
  pattern: BeadPattern;
  project: BeadProject;
  statistics: BeadStatistics;
}
export type ProjectPaletteResolver = (colorSystem: string, selectedColorIds?: readonly string[]) => Palette;
export interface ProjectEnvelopeOptions { legacyPaletteVersions?: readonly string[] }

export function projectToPattern(project: BeadProject): BeadPattern {
  return {
    grid: project.grid, paletteId: project.paletteId, paletteVersion: project.paletteVersion, paletteTable: project.paletteTable,
    sourceGeneration: project.generation ?? null,
    generationConfig: project.generation?.config ?? {
      algorithmVersion: CURRENT_ALGORITHM_VERSION, mode: 'cartoon', targetGrid: { axis: 'width', size: project.grid.width },
      sampling: { scale: 4 }, paletteId: project.paletteId, paletteVersion: project.paletteVersion,
      similarityMerge: { enabled: false, threshold: 0 }, alphaThreshold: 128,
    },
  };
}
function selectedIds(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error('selectedColorIds must be a non-empty array');
  const ids = Array.from(input, id => {
    if (typeof id !== 'string' || !id) throw new TypeError('selectedColorIds must contain non-empty strings');
    return id;
  });
  if (new Set(ids).size !== ids.length) throw new Error('selectedColorIds contains duplicate color ids');
  return ids;
}
function metadata(input: Record<string, unknown> | ProjectEnvelopeMetadata, project: BeadProject, pattern: BeadPattern, palette: Palette): ProjectEnvelopeMetadata {
  const result: ProjectEnvelopeMetadata = {};
  if (input.progress !== undefined) {
    assertRecord(input.progress, 'production progress');
    if (input.progress.projectId !== undefined && input.progress.projectId !== project.id) throw new Error('production progress does not match project id');
    result.progress = restoreProductionProgress(input.progress, pattern, new Set(pattern.paletteTable.slice(1)), new Set(buildBoardPlan(pattern, palette).pieces.map(piece => piece.id)), hashPattern(pattern));
  }
  if (input.cellProgress !== undefined) {
    result.cellProgress = restoreCellProgress(input.cellProgress, project.id, pattern);
    const completedColorIds = cellProgressToCompletedColorIds(result.cellProgress, project.id, pattern);
    if (result.progress) {
      const colors = new Set(result.progress.completedColorIds);
      if (colors.size !== completedColorIds.length || completedColorIds.some(id => !colors.has(id))) throw new Error('production and cell progress completed colors are inconsistent');
    } else {
      result.progress = { ...createProductionProgress(pattern, result.cellProgress.updatedAt), completedColorIds };
    }
  }
  if (input.workflow !== undefined) result.workflow = restoreProjectWorkflow(input.workflow);
  if (input.publishReview !== undefined) result.publishReview = restorePublishReview(input.publishReview);
  return result;
}
export function restoreProjectEnvelope(input: unknown, resolvePalette: ProjectPaletteResolver, options: ProjectEnvelopeOptions = {}): RestoredProjectEnvelope {
  assertRecord(input, 'stored project');
  if (input.formatVersion !== 1 && input.formatVersion !== STORED_PROJECT_FORMAT_VERSION) throw new Error(`unsupported stored project format: ${String(input.formatVersion)}`);
  if (typeof input.colorSystem !== 'string' || !input.colorSystem) throw new TypeError('stored color system is required');
  let project = deserializeProject(input.project);
  const ids = input.formatVersion === 2 ? selectedIds(input.selectedColorIds) : undefined;
  const palette = resolvePalette(input.colorSystem, ids);
  validatePalette(palette);
  if (ids && (ids.length !== palette.colors.length || ids.some((id, index) => id !== palette.colors[index]?.id))) throw new Error('stored project palette identity is unavailable: selectedColorIds order mismatch');
  if (project.paletteId !== palette.id) throw new Error('stored project palette identity is unavailable');
  if (project.paletteVersion !== palette.version) {
    if (input.formatVersion !== 1 || !options.legacyPaletteVersions?.includes(project.paletteVersion)) throw new Error('stored project palette identity is unavailable');
    project = { ...project, paletteVersion: palette.version, ...(project.generation ? { generation: { ...project.generation, config: { ...project.generation.config, paletteVersion: palette.version } } } : {}) };
  }
  const availableIds = new Set(palette.colors.map(color => color.id));
  for (const id of project.paletteTable.slice(1)) if (!availableIds.has(id)) throw new Error(`stored project references unavailable color: ${id}`);
  const pattern = projectToPattern(project);
  validateBeadPattern(pattern, palette);
  return { colorSystem: input.colorSystem, palette, pattern, project, statistics: calculateStatistics(pattern.grid, pattern.paletteTable.length - 1), ...metadata(input, project, pattern, palette) };
}
export function storeProjectEnvelope(project: BeadProject, colorSystem: string, palette: Palette, sidecars: ProjectEnvelopeMetadata = {}): StoredPatternProject {
  if (typeof colorSystem !== 'string' || !colorSystem) throw new TypeError('stored color system is required');
  const serialized = serializeProject(project);
  const cleanProject = deserializeProject(serialized);
  const pattern = projectToPattern(cleanProject);
  validateBeadPattern(pattern, palette);
  return { formatVersion: STORED_PROJECT_FORMAT_VERSION, colorSystem, selectedColorIds: palette.colors.map(color => color.id), project: serialized, ...metadata(sidecars, cleanProject, pattern, palette) };
}
export function encodeProjectEnvelope(envelope: StoredPatternProject, resolver: ProjectPaletteResolver, options?: ProjectEnvelopeOptions): string {
  restoreProjectEnvelope(envelope, resolver, options);
  const text = `${JSON.stringify(envelope, null, 2)}\n`;
  if (text.length > MAX_PROJECT_FILE_CHARACTERS) throw new RangeError('project file is too large');
  return text;
}
export function parseProjectEnvelopeFile(text: string, resolver: ProjectPaletteResolver, options?: ProjectEnvelopeOptions): RestoredProjectEnvelope {
  if (text.length > MAX_PROJECT_FILE_CHARACTERS) throw new RangeError('project file is too large');
  return restoreProjectEnvelope(JSON.parse(text.replace(/^\uFEFF/, '').trim()) as unknown, resolver, options);
}
