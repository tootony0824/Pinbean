import assert from 'node:assert/strict'
import test from 'node:test'

import { createGrid, type BeadPattern } from '@pinbean/bead-core'
import { createSupplierPalette } from '@pinbean/palette-data'
import colorSystemMapping from './support/colorSystemMapping.mts'

import { buildBoardPlan } from '../src/services/patternExport.ts'
import {
  createProductionProgress,
  productionProgressStorageKey,
  restoreProductionProgress,
  summarizeProductionProgress,
  toggleProductionBoard,
  toggleProductionColor,
} from '../src/services/productionProgress.ts'

const palette = createSupplierPalette(colorSystemMapping, 'MARD')
const first = palette.colors[0]
const second = palette.colors[1]
assert.ok(first && second)

const pattern: BeadPattern = {
  grid: createGrid(30, 29, Array.from({ length: 30 * 29 }, (_, index) => index < 600 ? 1 : 2)),
  paletteId: palette.id,
  paletteVersion: palette.version,
  paletteTable: ['', first.id, second.id],
  generationConfig: {
    algorithmVersion: 1,
    mode: 'cartoon',
    targetGrid: { axis: 'width', size: 30 },
    sampling: { scale: 4 },
    paletteId: palette.id,
    paletteVersion: palette.version,
    similarityMerge: { enabled: true, threshold: 48 },
    alphaThreshold: 128,
  },
}

test('color and board progress use stable IDs and bead-weighted percentages', () => {
  const plan = buildBoardPlan(pattern, palette)
  let progress = createProductionProgress(pattern, 100)
  progress = toggleProductionColor(progress, first.id, new Set([first.id, second.id]), 200)
  progress = toggleProductionBoard(progress, '1-1', new Set(plan.pieces.map(piece => piece.id)), 300)
  assert.deepEqual(progress.completedColorIds, [first.id])
  assert.deepEqual(progress.completedBoardIds, ['1-1'])
  assert.deepEqual(summarizeProductionProgress(pattern, plan, progress), {
    boardPercent: 50,
    colorPercent: 69,
    completedBeads: 600,
    completedBoards: 1,
    completedColors: 1,
    totalBeads: 870,
    totalBoards: 2,
    totalColors: 2,
  })
})

test('progress round-trip rejects pattern drift, unavailable IDs and duplicates', () => {
  const plan = buildBoardPlan(pattern, palette)
  const colors = new Set([first.id, second.id])
  const boards = new Set(plan.pieces.map(piece => piece.id))
  const progress = toggleProductionBoard(
    toggleProductionColor(createProductionProgress(pattern, 100), second.id, colors, 200),
    '1-2',
    boards,
    300,
  )
  assert.deepEqual(restoreProductionProgress(JSON.parse(JSON.stringify(progress)), pattern, colors, boards), progress)
  assert.throws(
    () => restoreProductionProgress(progress, { ...pattern, grid: createGrid(30, 29) }, colors, boards),
    /does not match/,
  )
  assert.throws(
    () => restoreProductionProgress({ ...progress, completedColorIds: ['missing'] }, pattern, colors, boards),
    /unavailable color/,
  )
  assert.throws(
    () => restoreProductionProgress({ ...progress, completedBoardIds: ['1-2', '1-2'] }, pattern, colors, boards),
    /duplicates/,
  )
})

test('progress storage key separates projects and exact pattern revisions', () => {
  const original = productionProgressStorageKey('project 1', pattern)
  const otherProject = productionProgressStorageKey('project 2', pattern)
  const editedPattern = { ...pattern, grid: createGrid(30, 29, Array.from(pattern.grid.cells, (cell, index) => index === 0 ? 2 : cell)) }
  const edited = productionProgressStorageKey('project 1', editedPattern)
  assert.notEqual(original, otherProject)
  assert.notEqual(original, edited)
  assert.match(original, /project%201/)
})
