import assert from 'node:assert/strict'
import test from 'node:test'

import { createGrid, type BeadPattern, type Palette } from '@pinbean/bead-core'

import {
  createPatternEditingState,
  ensurePatternPaletteColor,
  erasePatternCell,
  fillPatternRegion,
  gridIndexFromCanvasPoint,
  paintPatternCell,
  redoPatternEdit,
  removePatternBackground,
  replacePatternColor,
  undoPatternEdit,
} from '../src/services/patternEditing.ts'

const palette: Palette = {
  id: 'test',
  version: '1',
  colors: [
    { id: 'red', code: 'R1', hex: '#FF0000', rgb: { r: 255, g: 0, b: 0 } },
    { id: 'blue', code: 'B1', hex: '#0000FF', rgb: { r: 0, g: 0, b: 255 } },
    { id: 'green', code: 'G1', hex: '#00FF00', rgb: { r: 0, g: 255, b: 0 } },
  ],
}

const pattern: BeadPattern = {
  grid: createGrid(3, 2, [1, 1, 2, 1, 2, 2]),
  paletteId: 'test',
  paletteVersion: '1',
  paletteTable: ['', 'red', 'blue'],
  generationConfig: {
    algorithmVersion: 1,
    mode: 'cartoon',
    targetGrid: { axis: 'width', size: 3 },
    sampling: { scale: 4 },
    paletteId: 'test',
    paletteVersion: '1',
    similarityMerge: { enabled: false, threshold: 0 },
    alphaThreshold: 128,
  },
}

test('editing state keeps Pattern, statistics and Command history synchronized', () => {
  let result = paintPatternCell(createPatternEditingState(pattern, palette), 0, 'blue')
  assert.equal(result.changed, 1)
  assert.deepEqual(Array.from(result.state.pattern.grid.cells), [2, 1, 2, 1, 2, 2])
  assert.deepEqual(result.state.statistics.colors, [
    { paletteIndex: 2, count: 4 },
    { paletteIndex: 1, count: 2 },
  ])

  result = erasePatternCell(result.state, 1)
  assert.equal(result.state.statistics.total, 5)
  assert.equal(result.state.history.undoStack.length, 2)

  result = undoPatternEdit(result.state)
  assert.equal(result.state.statistics.total, 6)
  assert.equal(result.state.history.redoStack.length, 1)

  result = redoPatternEdit(result.state)
  assert.equal(result.state.statistics.total, 5)
  assert.equal(result.state.history.redoStack.length, 0)
})

test('fill and replace remain compact undoable core Commands', () => {
  let result = fillPatternRegion(createPatternEditingState(pattern, palette), 0, 'blue')
  assert.equal(result.changed, 3)
  assert.deepEqual(Array.from(result.state.pattern.grid.cells), [1, 1, 1, 1, 1, 1])
  assert.deepEqual(result.state.pattern.paletteTable, ['', 'blue'])

  result = undoPatternEdit(result.state)
  result = replacePatternColor(result.state, 'blue', 'red')
  assert.equal(result.changed, 3)
  assert.deepEqual(Array.from(result.state.pattern.grid.cells), [1, 1, 1, 1, 1, 1])
  assert.deepEqual(result.state.pattern.paletteTable, ['', 'red'])
})

test('editing rejects unavailable colors and maps visible Canvas points to cells', () => {
  const state = createPatternEditingState(pattern, palette)
  assert.throws(() => paintPatternCell(state, 0, 'missing'), /unavailable|不属于/)
  assert.equal(gridIndexFromCanvasPoint(pattern, 300, 200, 0, 0), 0)
  assert.equal(gridIndexFromCanvasPoint(pattern, 300, 200, 299, 199), 5)
  assert.equal(gridIndexFromCanvasPoint(pattern, 300, 200, 100, 100), 4)
  assert.equal(gridIndexFromCanvasPoint(pattern, 300, 200, 300, 10), null)
  assert.equal(gridIndexFromCanvasPoint(pattern, 0, 200, 10, 10), null)
})

test('editing validates full supplier colors without mutating selection state', () => {
  const state = createPatternEditingState(pattern, palette)
  const existing = ensurePatternPaletteColor(state, 'blue')
  assert.equal(existing.paletteIndex, 2)

  const unused = ensurePatternPaletteColor(state, 'green')
  assert.equal(unused.paletteIndex, null)
  assert.deepEqual(state.pattern.paletteTable, ['', 'red', 'blue'])

  const painted = paintPatternCell(state, 0, unused.colorId)
  assert.equal(painted.state.pattern.paletteTable.includes('green'), true)
  assert.equal(state.pattern.paletteTable.includes('green'), false)
  assert.throws(
    () => ensurePatternPaletteColor(state, 'missing'),
    /色号不属于当前色板/,
  )
})

test('background removal shares editing history and recomputes statistics', () => {
  const backgroundPattern: BeadPattern = {
    ...pattern,
    grid: createGrid(3, 3, [
      1, 1, 1,
      1, 2, 1,
      1, 1, 1,
    ]),
  }
  const result = removePatternBackground(createPatternEditingState(backgroundPattern, palette))
  assert.equal(result.backgroundPaletteIndex, 1)
  assert.equal(result.changed, 8)
  assert.deepEqual(Array.from(result.state.pattern.grid.cells), [
    0, 0, 0,
    0, 1, 0,
    0, 0, 0,
  ])
  assert.deepEqual(result.state.pattern.paletteTable, ['', 'blue'])
  assert.deepEqual(result.state.statistics, {
    total: 1,
    colors: [{ paletteIndex: 1, count: 1 }],
  })

  const restored = undoPatternEdit(result.state)
  assert.equal(restored.changed, 8)
  assert.equal(restored.state.statistics.total, 9)
})
