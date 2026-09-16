import {
  EMPTY_CELL,
  executePatternSessionCommand,
  getPatternCellColorId,
  calculateStatistics,
  createPatternEditHistory,
  erasePatternSessionCell,
  fillPatternSessionRegion,
  paintPatternSessionCell,
  redoPatternSessionEdit,
  removePatternSessionBackground,
  replacePatternSessionColor,
  undoPatternSessionEdit,
  type BeadPattern,
  type Palette,
  type PatternEditHistory,
  type PatternSession,
  type PatternSessionResult,
} from '@pinbean/bead-core';
import type { ColorSystem } from '@pinbean/palette-data';

import {
  createWebCorePalette,
  patternToWebView,
  type WebPatternView,
} from './beadCoreAdapter';
import type { MappedPixel, PaletteColor } from '../utils/pixelation';
import { TRANSPARENT_KEY } from '../utils/pixelEditingUtils';

export interface WebEditingSession {
  palette?: Palette;
  history: PatternEditHistory;
  pattern: BeadPattern;
}

export type WebEditOperation =
  | { indexes: number[]; target: Pick<MappedPixel, 'color' | 'key'>; type: 'stroke' }
  | { index: number; type: 'erase' }
  | { index: number; target: Pick<MappedPixel, 'color' | 'key'>; type: 'fill' | 'paint' }
  | { source: Pick<MappedPixel, 'color' | 'key'>; target: Pick<MappedPixel, 'color' | 'key'>; type: 'replace' }
  | { type: 'background-remove' };

export interface WebEditingResult extends WebPatternView {
  changed: number;
  session: WebEditingSession;
}

export function createWebEditingSession(pattern: BeadPattern, historyLimit = 100, palette?: Palette): WebEditingSession {
  return { history: createPatternEditHistory(historyLimit), pattern, palette };
}

function webSessionToCoreSession(
  session: WebEditingSession,
  palette: Palette,
): PatternSession {
  return {
    history: session.history,
    palette,
    pattern: session.pattern,
    statistics: calculateStatistics(session.pattern.grid, session.pattern.paletteTable.length - 1),
  };
}

function colorIdForTarget(
  target: Pick<MappedPixel, 'color' | 'key'>,
  currentPalette: PaletteColor[],
  colorSystem: ColorSystem,
): string | null {
  if (target.key === TRANSPARENT_KEY) return null;
  const webPalette = createWebCorePalette(currentPalette, colorSystem);
  const normalizedHex = target.color.toUpperCase();
  const targetColor = webPalette.palette.colors.find(color => color.hex.toUpperCase() === normalizedHex);
  if (!targetColor) throw new Error(`Editing target color is unavailable: ${target.color}`);
  return targetColor.id;
}

function buildResult(
  session: WebEditingSession,
  changed: number,
  currentPalette: PaletteColor[],
  colorSystem: ColorSystem,
): WebEditingResult {
  return {
    ...patternToWebView(session.pattern, currentPalette, colorSystem, session.palette),
    changed,
    session,
  };
}

function adaptResult(
  result: PatternSessionResult,
  currentPalette: PaletteColor[],
  colorSystem: ColorSystem,
): WebEditingResult {
  return buildResult({ history: result.session.history, pattern: result.session.pattern, palette: result.session.palette }, result.changed, currentPalette, colorSystem);
}

export function executeWebEdit(
  session: WebEditingSession,
  operation: WebEditOperation,
  currentPalette: PaletteColor[],
  colorSystem: ColorSystem,
): WebEditingResult {
  const webPalette = { palette: session.palette ?? createWebCorePalette(currentPalette, colorSystem).palette };
  if (session.pattern.paletteId !== webPalette.palette.id || session.pattern.paletteVersion !== webPalette.palette.version) {
    throw new Error('Editing palette identity does not match the generated pattern');
  }
  const coreSession = webSessionToCoreSession(session, webPalette.palette);
  if (operation.type === 'stroke') {
    const afterColorId = colorIdForTarget(operation.target, currentPalette, colorSystem);
    const changes = [...new Set(operation.indexes)].map(index => ({ index,
      beforeColorId: getPatternCellColorId(session.pattern, index), afterColorId,
    })).filter(change => change.beforeColorId !== change.afterColorId);
    return adaptResult(executePatternSessionCommand(coreSession, {
      type: afterColorId === null ? 'erase' : 'paint', changes,
    }), currentPalette, colorSystem);
  }
  if (operation.type === 'background-remove') {
    return adaptResult(removePatternSessionBackground(coreSession), currentPalette, colorSystem);
  }
  if (operation.type === 'erase') {
    return adaptResult(erasePatternSessionCell(coreSession, operation.index), currentPalette, colorSystem);
  }
  if (operation.type === 'paint' || operation.type === 'fill') {
    const colorId = colorIdForTarget(operation.target, currentPalette, colorSystem);
    const result = colorId === null
      ? erasePatternSessionCell(coreSession, operation.index)
      : operation.type === 'paint'
        ? paintPatternSessionCell(coreSession, operation.index, colorId)
        : fillPatternSessionRegion(coreSession, operation.index, colorId);
    return adaptResult(result, currentPalette, colorSystem);
  }
  if (operation.type !== 'replace') throw new Error(`Unsupported Web edit operation: ${operation.type}`);
  const sourceColorId = colorIdForTarget(operation.source, currentPalette, colorSystem);
  if (sourceColorId === null) throw new Error('Editing source color is unavailable');
  const targetColorId = colorIdForTarget(operation.target, currentPalette, colorSystem);
  if (targetColorId === null) {
    return adaptResult(replacePatternSessionColor(coreSession, sourceColorId, null), currentPalette, colorSystem);
  }
  return adaptResult(replacePatternSessionColor(coreSession, sourceColorId, targetColorId), currentPalette, colorSystem);
}

export function undoWebEdit(
  session: WebEditingSession,
  currentPalette: PaletteColor[],
  colorSystem: ColorSystem,
): WebEditingResult {
  const webPalette = { palette: session.palette ?? createWebCorePalette(currentPalette, colorSystem).palette };
  return adaptResult(undoPatternSessionEdit(webSessionToCoreSession(session, webPalette.palette)), currentPalette, colorSystem);
}

export function redoWebEdit(
  session: WebEditingSession,
  currentPalette: PaletteColor[],
  colorSystem: ColorSystem,
): WebEditingResult {
  const webPalette = { palette: session.palette ?? createWebCorePalette(currentPalette, colorSystem).palette };
  return adaptResult(redoPatternSessionEdit(webSessionToCoreSession(session, webPalette.palette)), currentPalette, colorSystem);
}

export function webPaletteIndexForColor(
  pattern: BeadPattern,
  target: Pick<MappedPixel, 'color' | 'key'>,
  currentPalette: PaletteColor[],
  colorSystem: ColorSystem,
): number {
  const colorId = colorIdForTarget(target, currentPalette, colorSystem);
  if (colorId === null) return EMPTY_CELL;
  const paletteIndex = pattern.paletteTable.indexOf(colorId);
  if (paletteIndex < 1) throw new Error(`Editing target color is not currently used: ${target.color}`);
  return paletteIndex;
}
