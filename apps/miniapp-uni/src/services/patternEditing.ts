import {
  createPatternSession,
  erasePatternSessionCell,
  fillPatternSessionRegion,
  getPatternPaletteIndex,
  paintPatternSessionCell,
  redoPatternSessionEdit,
  removePatternSessionBackground,
  replacePatternSessionColor,
  undoPatternSessionEdit,
  type BeadPattern,
  type Palette,
  type PatternBackgroundRemovalResult,
  type PatternEditHistory,
  type PatternSession,
  type PatternSessionResult,
} from '@pinbean/bead-core'

export type PatternEditingState = PatternSession
export type PatternEditingHistory = PatternEditHistory

export interface PatternEditingResult {
  changed: number
  state: PatternEditingState
}

export interface BackgroundRemovalEditingResult extends PatternEditingResult {
  backgroundColorId: string | null
  backgroundPaletteIndex: number | null
}

export interface PatternPaletteSelection {
  paletteIndex: number | null
  colorId: string
}

export function createPatternEditingState(
  pattern: BeadPattern,
  palette: Palette,
  historyLimit = 100,
): PatternEditingState {
  return createPatternSession(pattern, palette, historyLimit)
}

export function ensurePatternPaletteColor(
  state: PatternEditingState,
  colorId: string,
): PatternPaletteSelection {
  if (!state.palette.colors.some(color => color.id === colorId)) {
    throw new Error(`色号不属于当前色板: ${colorId}`)
  }
  return {
    colorId,
    paletteIndex: getPatternPaletteIndex(state.pattern, colorId),
  }
}

function adaptResult(result: PatternSessionResult): PatternEditingResult {
  return { changed: result.changed, state: result.session }
}

export function paintPatternCell(
  state: PatternEditingState,
  index: number,
  colorId: string,
): PatternEditingResult {
  return adaptResult(paintPatternSessionCell(state, index, colorId))
}

export function erasePatternCell(
  state: PatternEditingState,
  index: number,
): PatternEditingResult {
  return adaptResult(erasePatternSessionCell(state, index))
}

export function fillPatternRegion(
  state: PatternEditingState,
  index: number,
  colorId: string,
): PatternEditingResult {
  return adaptResult(fillPatternSessionRegion(state, index, colorId))
}

export function replacePatternColor(
  state: PatternEditingState,
  sourceColorId: string,
  targetColorId: string,
): PatternEditingResult {
  return adaptResult(replacePatternSessionColor(state, sourceColorId, targetColorId))
}

export function removePatternBackground(
  state: PatternEditingState,
): BackgroundRemovalEditingResult {
  const result: PatternBackgroundRemovalResult = removePatternSessionBackground(state)
  return {
    backgroundColorId: result.backgroundColorId,
    backgroundPaletteIndex: result.backgroundPaletteIndex,
    changed: result.changed,
    state: result.session,
  }
}

export function undoPatternEdit(state: PatternEditingState): PatternEditingResult {
  return adaptResult(undoPatternSessionEdit(state))
}

export function redoPatternEdit(state: PatternEditingState): PatternEditingResult {
  return adaptResult(redoPatternSessionEdit(state))
}

export function gridIndexFromCanvasPoint(
  pattern: BeadPattern,
  canvasWidth: number,
  canvasHeight: number,
  x: number,
  y: number,
): number | null {
  if (!(canvasWidth > 0) || !(canvasHeight > 0)) return null
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= canvasWidth || y >= canvasHeight) {
    return null
  }
  const column = Math.floor(x / canvasWidth * pattern.grid.width)
  const row = Math.floor(y / canvasHeight * pattern.grid.height)
  return row * pattern.grid.width + column
}
