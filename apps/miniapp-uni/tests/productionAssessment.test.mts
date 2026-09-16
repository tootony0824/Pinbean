import assert from 'node:assert/strict'
import test from 'node:test'

import { createGrid, type BeadPattern } from '@pinbean/bead-core'
import { createSupplierPalette } from '@pinbean/palette-data'
import colorSystemMapping from './support/colorSystemMapping.mts'

import { buildBoardPlan } from '../src/services/patternExport.ts'
import {
  buildCraftAssessment,
  buildCraftPlanText,
  buildProgressReviewText,
  formatEstimatedTime,
} from '../src/services/productionAssessment.ts'
import {
  CAREFUL_BEADS_PER_HOUR,
  estimateProductionTime,
  FAST_BEADS_PER_HOUR,
  PRODUCTION_TIME_BASIS_TEXT,
} from '../src/services/productionTime.ts'

const palette = createSupplierPalette(colorSystemMapping, 'MARD')
const a01 = palette.colors.find(color => color.code === 'A01')
const h07 = palette.colors.find(color => color.code === 'H07')
assert.ok(a01 && h07)

function createPattern(width: number, height: number, cells: number[]): BeadPattern {
  return {
    grid: createGrid(width, height, cells),
    paletteId: palette.id,
    paletteVersion: palette.version,
    paletteTable: ['', a01.id, h07.id],
    generationConfig: {
      algorithmVersion: 1,
      alphaThreshold: 128,
      mode: 'cartoon',
      paletteId: palette.id,
      paletteVersion: palette.version,
      sampling: { scale: 4 },
      similarityMerge: { enabled: true, threshold: 48 },
      targetGrid: { axis: 'width', size: width },
    },
  }
}

test('craft assessment preserves the approved difficulty, time and board thresholds', () => {
  const easyPattern = createPattern(29, 29, Array.from({ length: 29 * 29 }, (_, index) => index < 600 ? 1 : 0))
  const easy = buildCraftAssessment(easyPattern, palette, buildBoardPlan(easyPattern, palette))
  assert.deepEqual({ level: easy.level, class: easy.levelClass, time: easy.timeText }, {
    level: '新手友好',
    class: 'easy',
    time: '约 1-2 小时',
  })
  assert.equal(easy.boardText, '1 块标准板')
  assert.deepEqual(easy.tags, ['适合入门'])

  const mediumPattern = createPattern(50, 50, Array.from({ length: 2500 }, (_, index) => index < 2314 ? 1 : 2))
  const medium = buildCraftAssessment(mediumPattern, palette, buildBoardPlan(mediumPattern, palette))
  assert.equal(medium.level, '舒适可做')
  assert.equal(medium.timeText, '约 4-7 小时')
  assert.equal(medium.boardText, '2×2 拼板（共 4 块）')
  assert.equal(medium.workSteps[0]?.detail, '优先处理 A1 2314颗、H7 186颗')
  assert.match(medium.workSteps[1]?.detail ?? '', /从第 1 板开始/)
})

test('assessment risk priority and estimate boundaries remain deterministic', () => {
  assert.deepEqual(
    { carefulRate: CAREFUL_BEADS_PER_HOUR, fastRate: FAST_BEADS_PER_HOUR },
    { carefulRate: 400, fastRate: 650 },
  )
  assert.deepEqual(estimateProductionTime(2500), { fastHours: 4, slowHours: 7 })
  assert.match(PRODUCTION_TIME_BASIS_TEXT, /400-650 颗.*不含.*熨烫/)
  assert.equal(formatEstimatedTime(0), '约 0 小时')
  assert.equal(formatEstimatedTime(650), '约 1-2 小时')
  assert.equal(formatEstimatedTime(2601), '约 5-7 小时')
  assert.throws(() => formatEstimatedTime(-1), /非负安全整数/)

  const hardPattern = createPattern(59, 50, Array.from({ length: 59 * 50 }, (_, index) => index % 2 + 1))
  const hard = buildCraftAssessment(hardPattern, palette, buildBoardPlan(hardPattern, palette))
  assert.equal(hard.level, '进阶挑战')
  assert.deepEqual(hard.tags, ['尺寸偏大', '耗时较长'])
  assert.match(hard.suggestion, /58 格以内/)
})

test('plan and progress copy carry project facts and both completion paths', () => {
  const pattern = createPattern(50, 50, Array.from({ length: 2500 }, (_, index) => index < 2314 ? 1 : 2))
  const assessment = buildCraftAssessment(pattern, palette, buildBoardPlan(pattern, palette))
  const planText = buildCraftPlanText('测试作品', assessment)
  assert.match(planText, /PinBean 制作计划｜测试作品/)
  assert.match(planText, /粗略摆豆时间：约 4-7 小时/)
  assert.match(planText, /1\. 先拼大色块/)
  assert.match(planText, /2\. 按分板推进/)

  const progressText = buildProgressReviewText('测试作品', assessment, {
    boardPercent: 25,
    colorPercent: 93,
    completedBeads: 2314,
    completedBoards: 1,
    completedColors: 1,
    totalBeads: 2500,
    totalBoards: 4,
    totalColors: 2,
  })
  assert.match(progressText, /^拼豆制作进度｜测试作品/)
  assert.match(progressText, /2314\/2500 颗｜93%/)
  assert.match(progressText, /1\/4 板｜25%/)

  const completedByBoards = buildProgressReviewText('测试作品', assessment, {
    boardPercent: 100,
    colorPercent: 0,
    completedBeads: 0,
    completedBoards: 4,
    completedColors: 0,
    totalBeads: 2500,
    totalBoards: 4,
    totalColors: 2,
  })
  assert.match(completedByBoards, /^这张拼豆完成啦/)
})
