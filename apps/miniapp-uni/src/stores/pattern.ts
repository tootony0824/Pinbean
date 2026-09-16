import type {
  BeadPattern,
  BeadStatistics,
  Palette,
  PatternEditHistory,
} from '@pinbean/bead-core'
import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

import {
  createPatternEditingState,
  ensurePatternPaletteColor,
  erasePatternCell,
  fillPatternRegion,
  paintPatternCell,
  redoPatternEdit,
  removePatternBackground,
  replacePatternColor,
  type BackgroundRemovalEditingResult,
  type PatternEditingResult,
  type PatternEditingState,
  undoPatternEdit,
} from '@/services/patternEditing'

export interface PatternStoreSnapshot {
  history: PatternEditHistory | null
  palette: Palette | null
  pattern: BeadPattern | null
  statistics: BeadStatistics | null
}

export const usePatternStore = defineStore('pattern', () => {
  const pattern = shallowRef<BeadPattern | null>(null)
  const palette = shallowRef<Palette | null>(null)
  const statistics = shallowRef<BeadStatistics | null>(null)
  const history = shallowRef<PatternEditHistory | null>(null)

  function currentEditingState(): PatternEditingState {
    if (!pattern.value || !statistics.value || !history.value || !palette.value) {
      throw new Error('请先生成图纸')
    }
    return {
      history: history.value,
      palette: palette.value,
      pattern: pattern.value,
      statistics: statistics.value,
    }
  }

  function applyEditingResult(result: PatternEditingResult): number {
    pattern.value = result.state.pattern
    palette.value = result.state.palette
    statistics.value = result.state.statistics
    history.value = result.state.history
    return result.changed
  }

  function setGeneratedResult(
    nextPattern: BeadPattern,
    nextPalette: Palette,
    nextStatistics: BeadStatistics,
  ): void {
    const state = createPatternEditingState(nextPattern, nextPalette)
    pattern.value = state.pattern
    palette.value = state.palette
    statistics.value = nextStatistics
    history.value = state.history
  }

  function paint(index: number, colorId: string): number {
    return applyEditingResult(paintPatternCell(currentEditingState(), index, colorId))
  }

  function ensureColor(colorId: string): number | null {
    return ensurePatternPaletteColor(currentEditingState(), colorId).paletteIndex
  }

  function erase(index: number): number {
    return applyEditingResult(erasePatternCell(currentEditingState(), index))
  }

  function fill(index: number, colorId: string): number {
    return applyEditingResult(fillPatternRegion(currentEditingState(), index, colorId))
  }

  function replace(sourceColorId: string, targetColorId: string): number {
    return applyEditingResult(replacePatternColor(
      currentEditingState(),
      sourceColorId,
      targetColorId,
    ))
  }

  function removeBackground(): Pick<BackgroundRemovalEditingResult, 'backgroundPaletteIndex' | 'changed'> {
    const result = removePatternBackground(currentEditingState())
    const changed = applyEditingResult(result)
    return { backgroundPaletteIndex: result.backgroundPaletteIndex, changed }
  }

  function undo(): number {
    return applyEditingResult(undoPatternEdit(currentEditingState()))
  }

  function redo(): number {
    return applyEditingResult(redoPatternEdit(currentEditingState()))
  }

  function snapshot(): PatternStoreSnapshot {
    return {
      history: history.value,
      palette: palette.value,
      pattern: pattern.value,
      statistics: statistics.value,
    }
  }

  function restore(snapshotValue: PatternStoreSnapshot): void {
    pattern.value = snapshotValue.pattern
    palette.value = snapshotValue.palette
    statistics.value = snapshotValue.statistics
    history.value = snapshotValue.history
  }

  function clear(): void {
    pattern.value = null
    palette.value = null
    statistics.value = null
    history.value = null
  }

  return {
    clear,
    erase,
    ensureColor,
    fill,
    history,
    paint,
    palette,
    pattern,
    redo,
    removeBackground,
    replace,
    restore,
    setGeneratedResult,
    snapshot,
    statistics,
    undo,
  }
})
