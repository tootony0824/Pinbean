import assert from 'node:assert/strict'
import test from 'node:test'

import { createGrid, type BeadPattern } from '@pinbean/bead-core'
import { createSupplierPalette } from '@pinbean/palette-data'
import colorSystemMapping from './support/colorSystemMapping.mts'

import { buildBoardPlan, compactColorCode } from '../src/services/patternExport.ts'
import { buildCraftAssessment } from '../src/services/productionAssessment.ts'
import { buildShareCoverExportModel } from '../src/services/shareCoverExport.ts'

const palette = createSupplierPalette(colorSystemMapping, 'MARD')
const p01 = palette.colors.find(color => color.code === 'P01') ?? palette.colors[0]
const h07 = palette.colors.find(color => color.code === 'H07') ?? palette.colors[1]
assert.ok(p01 && h07)

const pattern: BeadPattern = {
  grid: createGrid(50, 50, Array.from({ length: 2500 }, (_, index) => index < 2314 ? 1 : 2)),
  paletteId: palette.id,
  paletteVersion: palette.version,
  paletteTable: ['', p01.id, h07.id],
  generationConfig: {
    algorithmVersion: 1,
    alphaThreshold: 128,
    mode: 'cartoon',
    paletteId: palette.id,
    paletteVersion: palette.version,
    sampling: { scale: 4 },
    similarityMerge: { enabled: true, threshold: 48 },
    targetGrid: { axis: 'width', size: 50 },
  },
}

test('3:4 cover model centers the pattern and carries assessment, progress and top colors', () => {
  const assessment = buildCraftAssessment(pattern, palette, buildBoardPlan(pattern, palette))
  const model = buildShareCoverExportModel(pattern, palette, 'MARD', '测试作品', assessment, {
    boardPercent: 25,
    colorPercent: 93,
    completedBeads: 2314,
    completedBoards: 1,
    completedColors: 1,
    totalBeads: 2500,
    totalBoards: 4,
    totalColors: 2,
  })
  assert.deepEqual({ width: model.layout.width, height: model.layout.height }, { width: 1080, height: 1440 })
  assert.equal(model.layout.width * 4, model.layout.height * 3)
  assert.equal(model.layout.thumbnailCellSize, 16)
  assert.equal(model.layout.thumbnailStartX, 82)
  assert.equal(model.layout.thumbnailStartY, 200)
  assert.equal(model.cells.length, 2500)
  assert.deepEqual(model.topColors.map(item => [item.code, item.count]), [['P1', 2314], ['H7', 186]])
  assert.equal(model.progressText, '色号进度 93% · 分板进度 25%')
  assert.equal(model.assessment.level, '舒适可做')
})

test('cover model uses a deterministic empty-progress fallback and rejects palette drift', () => {
  const assessment = buildCraftAssessment(pattern, palette, buildBoardPlan(pattern, palette))
  const model = buildShareCoverExportModel(pattern, palette, 'MARD', '', assessment)
  assert.equal(model.projectName, 'PinBean 拼豆图纸')
  assert.equal(model.progressText, '上传图片即可生成专属拼豆图纸')
  assert.throws(
    () => buildShareCoverExportModel({ ...pattern, paletteVersion: 'missing' }, palette, 'MARD', '坏图', assessment),
    /图纸与色板版本不一致/,
  )
})

test('cover uses the selected supplier display codes without changing stable color IDs', () => {
  const cocoPalette = createSupplierPalette(colorSystemMapping, 'COCO')
  const cocoPattern: BeadPattern = {
    ...pattern,
    paletteId: cocoPalette.id,
    paletteVersion: cocoPalette.version,
    generationConfig: {
      ...pattern.generationConfig,
      paletteId: cocoPalette.id,
      paletteVersion: cocoPalette.version,
    },
  }
  const assessment = buildCraftAssessment(cocoPattern, cocoPalette, buildBoardPlan(cocoPattern, cocoPalette))
  const model = buildShareCoverExportModel(cocoPattern, cocoPalette, 'COCO', 'COCO 作品', assessment)
  const expectedP01 = cocoPalette.colors.find(color => color.id === p01.id)?.code
  const expectedH07 = cocoPalette.colors.find(color => color.id === h07.id)?.code

  assert.deepEqual(
    model.topColors.map(item => item.code),
    [expectedP01, expectedH07].map(code => compactColorCode(code ?? '')),
  )
  assert.equal(model.cells.find(cell => !cell.isEmpty)?.code, compactColorCode(expectedP01 ?? ''))
})
