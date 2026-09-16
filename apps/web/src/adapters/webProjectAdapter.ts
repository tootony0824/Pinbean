import {
  CURRENT_SCHEMA_VERSION, createCellProgress, createProductionProgress,
  cellProgressToCompletedColorIds, deserializePattern, hashPatternContent, encodeProjectEnvelope,
  parseProjectEnvelopeFile, projectToPattern, restoreProjectEnvelope,
  storeProjectEnvelope, syncCellProgressColors,
  type BeadPattern, type BeadProject, type Palette, type RestoredProjectEnvelope,
} from '@pinbean/bead-core';
import { COLOR_SYSTEMS, getSupplierPalette, LEGACY_ID_ONLY_SELECTION_VERSION, type ColorSystem } from '@pinbean/palette-data';
import { createWebCorePalette, patternToWebView } from './beadCoreAdapter';
import type { PaletteColor } from '../utils/pixelation';

export const WEB_PROJECT_STORAGE_KEY = 'pinbean_web_project_v2';
export const LEGACY_FOCUS_STORAGE_KEY = 'focusMode_project_v2';
const options = { legacyPaletteVersions: [LEGACY_ID_ONLY_SELECTION_VERSION] };
export interface ProjectStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export function resolveWebPalette(system: string, ids?: readonly string[]): Palette {
  if (!(COLOR_SYSTEMS as readonly string[]).includes(system)) throw new Error('Unsupported project color system');
  return getSupplierPalette(system as ColorSystem, ids);
}
export function webPaletteColors(palette: Palette): PaletteColor[] {
  return palette.colors.map(color => ({ key: color.code, hex: color.hex, rgb: { ...color.rgb } }));
}
export function prepareWebProject(project: RestoredProjectEnvelope) {
  const colors = webPaletteColors(project.palette);
  return { ...project, colors, view: patternToWebView(project.pattern, colors, project.colorSystem as ColorSystem, project.palette) };
}
export function importWebProject(text: string): RestoredProjectEnvelope {
  const restored = parseProjectEnvelopeFile(text, resolveWebPalette, options);
  prepareWebProject(restored);
  return restored;
}
export function exportWebProject(project: RestoredProjectEnvelope): string {
  return encodeProjectEnvelope(storeProjectEnvelope(project.project, project.colorSystem, project.palette, project), resolveWebPalette, options);
}
export function saveWebProject(storage: ProjectStorage, project: RestoredProjectEnvelope): void {
  storage.setItem(WEB_PROJECT_STORAGE_KEY, exportWebProject(project));
}
export function createWebProject(pattern: BeadPattern, palette: Palette, colorSystem: ColorSystem, id: string, name: string, now = Date.now(), unknownSource = false): RestoredProjectEnvelope {
  const project: BeadProject = {
    id, name, createdAt: now, updatedAt: now, schemaVersion: CURRENT_SCHEMA_VERSION,
    grid: pattern.grid, paletteId: pattern.paletteId, paletteVersion: pattern.paletteVersion, paletteTable: pattern.paletteTable,
    ...(!unknownSource ? { generation: { config: pattern.generationConfig } } : {}),
  };
  return restoreProjectEnvelope(storeProjectEnvelope(project, colorSystem, palette), resolveWebPalette, options);
}
export function updateWebProject(previous: RestoredProjectEnvelope, pattern: BeadPattern, now = Date.now()): RestoredProjectEnvelope {
  const samePattern = hashPatternContent(previous.pattern) === hashPatternContent(pattern);
  const project = { ...previous.project, grid: pattern.grid, paletteTable: pattern.paletteTable, updatedAt: Math.max(now, previous.project.createdAt) };
  const metadata = samePattern ? previous : { workflow: previous.workflow, publishReview: previous.publishReview };
  return restoreProjectEnvelope(storeProjectEnvelope(project, previous.colorSystem, previous.palette, metadata), resolveWebPalette, options);
}
export function createWebProjectHistory() {
  const entries = new Map<string, RestoredProjectEnvelope>();
  const key = (project: RestoredProjectEnvelope) => `${project.project.id}:${hashPatternContent(project.pattern)}`;
  return (previous: RestoredProjectEnvelope, pattern: BeadPattern, now = Date.now()) => {
    entries.delete(key(previous));
    entries.set(key(previous), previous);
    while (entries.size > 32) entries.delete(entries.keys().next().value!);
    const candidate = updateWebProject(previous, pattern, now);
    const cached = entries.get(key(candidate));
    if (!cached) return candidate;
    return restoreProjectEnvelope(storeProjectEnvelope(candidate.project, candidate.colorSystem, candidate.palette, {
      ...candidate, progress: cached.progress, cellProgress: cached.cellProgress,
    }), resolveWebPalette, options);
  };
}

export function loadWebProject(storage: ProjectStorage): RestoredProjectEnvelope | null {
  const current = storage.getItem(WEB_PROJECT_STORAGE_KEY);
  if (current !== null) return importWebProject(current);
  const legacy = storage.getItem(LEGACY_FOCUS_STORAGE_KEY);
  if (legacy === null) return null;
  const input = JSON.parse(legacy);
  const pattern = deserializePattern(input.pattern);
  const palette = createWebCorePalette(input.palette, input.colorSystem).palette;
  const migrated = createWebProject(pattern, palette, input.colorSystem, `web-legacy-${hashPatternContent(pattern)}`, 'Imported pattern');
  prepareWebProject(migrated);
  saveWebProject(storage, migrated);
  // Keep the original cache, including on any failed migration or write.
  return migrated;
}
export function focusCompletedCells(project: RestoredProjectEnvelope): Set<string> {
  const sidecar = syncCellProgressColors(
    project.cellProgress ?? createCellProgress(project.project.id, project.pattern),
    project.project.id, project.pattern, [], project.progress?.completedColorIds ?? [], project.project.updatedAt,
  );
  return new Set(sidecar.completedCellIndices.map(index => `${Math.floor(index / project.pattern.grid.width)},${index % project.pattern.grid.width}`));
}
export function updateFocusCells(project: RestoredProjectEnvelope, cells: ReadonlySet<string>, now = Date.now()): RestoredProjectEnvelope {
  const width = project.pattern.grid.width;
  const indices = Array.from(cells, key => {
    if (!/^\d+,\d+$/.test(key)) throw new Error('Invalid Focus cell coordinate');
    const [row, column] = key.split(',').map(Number);
    if (column >= width || row >= project.pattern.grid.height) throw new Error('Focus cell out of bounds');
    return row * width + column;
  });
  const cellProgress = createCellProgress(project.project.id, project.pattern, indices, now);
  const progress = { ...(project.progress ?? createProductionProgress(project.pattern, now)), completedColorIds: cellProgressToCompletedColorIds(cellProgress, project.project.id, project.pattern), updatedAt: now };
  return restoreProjectEnvelope(storeProjectEnvelope({ ...project.project, updatedAt: Math.max(now, project.project.createdAt) }, project.colorSystem, project.palette, { ...project, progress, cellProgress }), resolveWebPalette, options);
}
export { projectToPattern };
