import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildPublishKit,
  buildPublishPost,
  createProjectWorkflow,
  inferProjectType,
  PROJECT_TYPE_OPTIONS,
  restoreProjectWorkflow,
} from '../src/services/publishing.ts'
import type { CraftAssessment } from '../src/services/productionAssessment.ts'

const assessment: CraftAssessment = {
  beadText: '2500 颗',
  boardCount: 4,
  boardHint: '制作时需要对齐分板边缘',
  boardText: '2×2 拼板（共 4 块）',
  colorText: '2 色',
  hasMultipleBoards: true,
  level: '舒适可做',
  levelClass: 'medium',
  sizeText: '50×50',
  suggestion: '整体可做，导出前建议检查关键细节。',
  tags: ['难度适中'],
  timeText: '约 4-7 小时',
  workSteps: [
    { detail: '优先处理 P1 2314颗', index: 1, title: '先拼大色块' },
    { detail: '从第 1 板开始', index: 2, title: '按分板推进' },
    { detail: '检查边缘', index: 3, title: '最后补细节' },
  ],
}

test('project presets and workflow round-trip stay explicit and versioned', () => {
  assert.deepEqual(PROJECT_TYPE_OPTIONS.map(option => [option.value, option.gridSize, option.mode]), [
    ['charm', 29, 'cartoon'],
    ['gift', 50, 'cartoon'],
    ['photo', 58, 'realistic'],
    ['poster', 75, 'cartoon'],
  ])
  assert.equal(inferProjectType(29, 'cartoon'), 'charm')
  assert.equal(inferProjectType(58, 'realistic'), 'photo')
  assert.equal(inferProjectType(75, 'cartoon'), 'poster')
  assert.equal(inferProjectType(50, 'cartoon'), 'gift')
  const workflow = createProjectWorkflow('photo')
  assert.deepEqual(restoreProjectWorkflow(JSON.parse(JSON.stringify(workflow))), workflow)
  assert.throws(() => restoreProjectWorkflow({ ...workflow, formatVersion: 2 }), /unsupported project workflow format/)
  assert.throws(() => restoreProjectWorkflow({ ...workflow, projectType: 'unknown' }), /unsupported project type/)
})

test('three publish tones use assessment facts without reading page state', () => {
  const showcase = buildPublishPost(assessment, 'showcase')
  assert.match(showcase, /50×50，2500 颗，2 色，2×2 拼板/)
  assert.match(showcase, /舒适可做，粗略摆豆时间：约 4-7 小时/)

  const tutorial = buildPublishPost(assessment, 'tutorial')
  assert.match(tutorial, /我的制作顺序/)
  assert.match(tutorial, /1\. 先拼大色块：优先处理 P1 2314颗/)

  const challenge = buildPublishPost(assessment, 'challenge')
  assert.match(challenge, /给自己开了一个拼豆挑战/)
  assert.match(challenge, /分成 4 块板做/)
})

test('publish kit carries project intent, progress and a bounded title', () => {
  const kit = buildPublishKit({
    assessment,
    progress: {
      boardPercent: 25,
      colorPercent: 93,
      completedBeads: 2314,
      completedBoards: 1,
      completedColors: 1,
      totalBeads: 2500,
      totalBoards: 4,
      totalColors: 2,
    },
    projectName: '名字很长很长很长很长很长的测试作品',
    projectType: 'gift',
  })
  assert.ok(kit.title.length <= 20)
  assert.match(kit.coverSuggestion, /亲手制作、适合送人/)
  assert.match(kit.body, /1\/2 色 · 2314\/2500 颗 · 93%/)
  assert.match(kit.body, /1\/4 板 · 25%/)
  assert.match(kit.tags, /#亲手做礼物/)
  assert.equal(kit.checklist.length, 4)
  assert.match(kit.text, /发布前检查/)

  const namedKit = buildPublishKit({
    assessment,
    projectName: '强哥的测试拼豆',
    projectType: 'gift',
  })
  assert.equal(namedKit.title, '强哥的测试拼豆手作礼物')
  assert.doesNotMatch(namedKit.title, /拼豆拼豆/)
})
