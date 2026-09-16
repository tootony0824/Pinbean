import assert from 'node:assert/strict'
import test from 'node:test'

import { createGrid, type BeadPattern } from '@pinbean/bead-core'
import { createSupplierPalette } from '@pinbean/palette-data'
import colorSystemMapping from './support/colorSystemMapping.mts'

import {
  buildMaterialList,
  buildMaterialListExportModel,
  buildMaterialListText,
  buildBoardAtlasExportModel,
  buildBoardExportModel,
  buildBoardPlan,
  buildPatternExportModel,
  compactColorCode,
  contrastTextColor,
} from '../src/services/patternExport.ts'

const palette = createSupplierPalette(colorSystemMapping, 'MARD')
const a01 = palette.colors.find(color => color.code === 'A01')
const h07 = palette.colors.find(color => color.code === 'H07')
assert.ok(a01 && h07)

const pattern: BeadPattern = {
  grid: createGrid(3, 2, [1, 0, 2, 1, 1, 2]),
  paletteId: palette.id,
  paletteVersion: palette.version,
  paletteTable: ['', a01.id, h07.id],
  generationConfig: {
    algorithmVersion: 1,
    mode: 'cartoon',
    targetGrid: { axis: 'width', size: 3 },
    sampling: { scale: 4 },
    paletteId: palette.id,
    paletteVersion: palette.version,
    similarityMerge: { enabled: true, threshold: 48 },
    alphaThreshold: 128,
  },
}

test('material list is naturally sorted and includes an eight-percent reserve', () => {
  const items = buildMaterialList(pattern, palette)
  assert.deepEqual(items.map(item => ({ code: item.code, count: item.count, reserve: item.reserveCount })), [
    { code: 'A1', count: 3, reserve: 4 },
    { code: 'H7', count: 2, reserve: 3 },
  ])
  const text = buildMaterialListText(pattern, palette, 'MARD', '测试图纸')
  assert.match(text, /测试图纸/)
  assert.match(text, /实际 5 颗｜建议备料 7 颗/)
  assert.match(text, /A1\t实际 3 颗\t建议 4 颗/)
})

test('export model preserves empty cells, stable color codes and bounded layout', () => {
  const model = buildPatternExportModel(pattern, palette, 'MARD', '测试图纸')
  assert.equal(model.total, 5)
  assert.equal(model.timeText, '约 1 小时')
  assert.deepEqual({ width: model.width, height: model.height }, { width: 3, height: 2 })
  assert.deepEqual(model.cells.map(cell => ({ code: cell.code, empty: cell.isEmpty })), [
    { code: 'A1', empty: false },
    { code: '', empty: true },
    { code: 'H7', empty: false },
    { code: 'A1', empty: false },
    { code: 'A1', empty: false },
    { code: 'H7', empty: false },
  ])
  assert.equal(model.layout.gridWidth, 72)
  assert.equal(model.layout.gridHeight, 48)
  assert.equal(model.layout.width, 900)
  assert.ok(model.layout.width <= 4096)
  assert.ok(model.layout.height <= 5000)
})

test('pure pattern and material-list exports keep their original presentation variants', () => {
  const pure = buildPatternExportModel(pattern, palette, 'MARD', '测试图纸', {
    includeStats: false,
    showCellNumbers: false,
    showCoordinates: false,
    showGrid: false,
  })
  assert.equal(pure.layout.coordinateSize, 0)
  assert.equal(pure.layout.footerHeight, 0)
  assert.equal(pure.options.showCellNumbers, false)
  assert.equal(pure.options.showGrid, false)
  assert.equal(pure.layout.width, 900)

  const material = buildMaterialListExportModel(pattern, palette, 'MARD', '测试图纸')
  assert.equal(material.total, 5)
  assert.equal(material.reserveTotal, 7)
  assert.equal(material.items.length, 2)
  assert.equal(material.layout.width, 900)
  assert.ok(material.layout.height > material.layout.headerHeight)
})

test('material list text and image model carry color production status', () => {
  const completed = [a01.id]
  const text = buildMaterialListText(pattern, palette, 'MARD', '进度图纸', completed)
  assert.match(text, /制作进度 1\/2 色｜3\/5 颗/)
  assert.match(text, /A1\t实际 3 颗\t建议 4 颗\t已完成/)
  assert.match(text, /H7\t实际 2 颗\t建议 3 颗\t待拼/)
  const model = buildMaterialListExportModel(pattern, palette, 'MARD', '进度图纸', completed)
  assert.equal(model.completedColors, 1)
  assert.equal(model.completedBeads, 3)
  assert.equal(model.items.find(item => item.code === 'A1')?.isCompleted, true)
})

test('export rejects a canvas that would exceed the cross-platform safety bound', () => {
  const tallPattern: BeadPattern = {
    ...pattern,
    grid: createGrid(1, 300, Array.from({ length: 300 }, () => 1)),
  }
  assert.throws(
    () => buildPatternExportModel(tallPattern, palette, 'MARD', '过高图纸'),
    /超出当前安全上限/,
  )
  assert.throws(
    () => buildPatternExportModel(pattern, palette, 'MARD', '测试图纸', { gridInterval: 0 }),
    /网格线间隔必须是正整数/,
  )
})

test('export helpers compact codes, choose contrast and reject palette identity drift', () => {
  assert.equal(compactColorCode('A001'), 'A1')
  assert.equal(contrastTextColor('#FFFFFF'), '#000000')
  assert.equal(contrastTextColor('#000000'), '#FFFFFF')
  assert.throws(
    () => buildPatternExportModel(
      { ...pattern, paletteVersion: 'missing' },
      palette,
      'MARD',
      '测试图纸',
    ),
    /图纸与色板版本不一致/,
  )
})

test('29×29 board plan keeps global ranges and skips empty cells in totals', () => {
  const boardPattern: BeadPattern = {
    ...pattern,
    grid: createGrid(30, 29, Array.from({ length: 30 * 29 }, (_, index) => {
      if (index === 0) return 0
      return index % 3 === 0 ? 2 : 1
    })),
  }
  const plan = buildBoardPlan(boardPattern, palette)
  assert.deepEqual(
    { columns: plan.columns, rows: plan.rows, count: plan.count },
    { columns: 2, rows: 1, count: 2 },
  )
  assert.deepEqual(
    plan.pieces.map(piece => ({
      id: piece.id,
      range: piece.rangeText,
      size: piece.sizeText,
      total: piece.total,
    })),
    [
      { id: '1-1', range: '列 1-29 / 行 1-29', size: '29×29', total: 840 },
      { id: '1-2', range: '列 30-30 / 行 1-29', size: '1×29', total: 29 },
    ],
  )
  assert.equal(plan.pieces[0]?.cells[0]?.isEmpty, true)
  assert.equal(plan.pieces[1]?.cells[0]?.column, 0)
  assert.equal(plan.pieces[1]?.cells[0]?.row, 0)
})

test('board export uses global coordinates and atlas covers every board once', () => {
  const boardPattern: BeadPattern = {
    ...pattern,
    grid: createGrid(58, 58, Array.from({ length: 58 * 58 }, () => 1)),
  }
  const plan = buildBoardPlan(boardPattern, palette)
  assert.equal(plan.count, 4)
  assert.deepEqual(plan.pieces.map(piece => piece.rangeText), [
    '列 1-29 / 行 1-29',
    '列 30-58 / 行 1-29',
    '列 1-29 / 行 30-58',
    '列 30-58 / 行 30-58',
  ])
  assert.ok(plan.pieces.every(piece => piece.total === 29 * 29))

  const piece = plan.pieces[3]
  assert.ok(piece)
  const board = buildBoardExportModel(boardPattern, palette, 'MARD', '四板测试', piece)
  assert.equal(board.piece.startColumn, 30)
  assert.equal(board.piece.startRow, 30)
  assert.deepEqual(
    { width: board.layout.width, height: board.layout.height },
    { width: 868, height: 1044 },
  )

  const atlas = buildBoardAtlasExportModel(boardPattern, palette, 'MARD', '四板测试', plan)
  assert.equal(atlas.plan.pieces.length, 4)
  assert.equal(atlas.total, 58 * 58)
  assert.deepEqual(
    { width: atlas.layout.width, columns: atlas.layout.columns, height: atlas.layout.height },
    { width: 1200, columns: 2, height: 1280 },
  )
})

test('single-board and invalid board-size boundaries are explicit', () => {
  const plan = buildBoardPlan(pattern, palette)
  assert.equal(plan.count, 1)
  assert.equal(plan.pieces[0]?.sizeText, '3×2')
  assert.throws(() => buildBoardPlan(pattern, palette, 0), /分板尺寸必须是正整数/)
})
