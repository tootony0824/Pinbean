import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CURRENT_ALGORITHM_VERSION,
  calculateStatistics,
  createGrid,
  getPatternCellColorId,
  type BeadPattern,
  type GenerationConfig,
} from '@pinbean/bead-core'
import { createPinia, setActivePinia } from 'pinia'

import { usePatternStore } from '../src/stores/pattern'

const palette = {
  id: 'test-palette',
  version: 'test-v1',
  colors: [
    { id: 'red', code: 'R', name: 'Red', rgb: { r: 255, g: 0, b: 0 }, hex: '#FF0000' },
    { id: 'blue', code: 'B', name: 'Blue', rgb: { r: 0, g: 0, b: 255 }, hex: '#0000FF' },
  ],
}

const generationConfig: GenerationConfig = {
  algorithmVersion: CURRENT_ALGORITHM_VERSION,
  alphaThreshold: 128,
  mode: 'cartoon',
  paletteId: palette.id,
  paletteVersion: palette.version,
  sampling: { scale: 4 },
  similarityMerge: { enabled: true, threshold: 48 },
  targetGrid: { axis: 'width', size: 2 },
}

function createPattern(cells: readonly number[]): BeadPattern {
  return {
    generationConfig,
    grid: createGrid(2, 1, cells),
    paletteId: palette.id,
    paletteTable: ['', 'red', 'blue'],
    paletteVersion: palette.version,
  }
}

test('pattern store snapshots restore all pattern state after failed canvas transactions', () => {
  setActivePinia(createPinia())
  const store = usePatternStore()
  const pattern = createPattern([1, 2])
  store.setGeneratedResult(pattern, palette, calculateStatistics(pattern.grid, 2))
  const snapshot = store.snapshot()

  store.paint(0, 'blue')
  assert.deepEqual(Array.from(store.pattern?.grid.cells ?? []), [1, 1])
  assert.equal(store.pattern ? getPatternCellColorId(store.pattern, 0) : null, 'blue')

  store.restore(snapshot)
  assert.deepEqual(Array.from(store.pattern?.grid.cells ?? []), [1, 2])
  assert.deepEqual(store.history?.undoStack, [])
  assert.equal(store.statistics?.total, 2)
})
