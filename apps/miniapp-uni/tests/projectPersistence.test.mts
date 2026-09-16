import assert from 'node:assert/strict'
import test from 'node:test'

import { createGrid, type BeadPattern } from '@pinbean/bead-core'
import { createSupplierPalette } from '@pinbean/palette-data'
import colorSystemMapping from './support/colorSystemMapping.mts'

import {
  encodePatternProjectFile,
  parsePatternProjectFile,
  ProjectImportError,
  restorePatternProject,
  storePatternProject,
} from '../src/services/projectPersistence.ts'
import {
  createProductionProgress,
  toggleProductionBoard,
  toggleProductionColor,
} from '../src/services/productionProgress.ts'
import { createProjectWorkflow } from '../src/services/publishing.ts'
import { createPublishReview } from '../src/services/publishReview.ts'

const palette = createSupplierPalette(colorSystemMapping, 'MARD')
const red = palette.colors.find(color => color.code === 'A01') ?? palette.colors[0]
const black = palette.colors.find(color => color.code === 'H07') ?? palette.colors[1]
assert.ok(red && black)

const pattern: BeadPattern = {
  grid: createGrid(2, 2, [0, 1, 2, 1]),
  paletteId: palette.id,
  paletteVersion: palette.version,
  paletteTable: ['', red.id, black.id],
  generationConfig: {
    algorithmVersion: 1,
    mode: 'cartoon',
    targetGrid: { axis: 'width', size: 2 },
    sampling: { scale: 4 },
    paletteId: palette.id,
    paletteVersion: palette.version,
    similarityMerge: { enabled: true, threshold: 48 },
    alphaThreshold: 128,
  },
}

test('stored project round-trip restores TypedArray, palette and statistics', () => {
  const stored = storePatternProject(pattern, 'MARD', {
    id: 'project-1',
    name: '测试图纸',
    createdAt: 100,
  }, 200)
  assert.ok(Array.isArray(stored.project.grid.cells))
  assert.deepEqual(stored.project.grid.cells, [0, 1, 2, 1])

  const restored = restorePatternProject(JSON.parse(JSON.stringify(stored)) as unknown)
  assert.ok(restored.pattern.grid.cells instanceof Uint16Array)
  assert.deepEqual(Array.from(restored.pattern.grid.cells), [0, 1, 2, 1])
  assert.equal(restored.project.createdAt, 100)
  assert.equal(restored.project.updatedAt, 200)
  assert.equal(restored.palette.id, palette.id)
  assert.deepEqual(restored.statistics, {
    total: 3,
    colors: [
      { paletteIndex: 1, count: 2 },
      { paletteIndex: 2, count: 1 },
    ],
  })
})

test('non-MARD project round-trip restores its supplier palette and display codes', () => {
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
  const stored = storePatternProject(cocoPattern, 'COCO', {
    id: 'project-coco',
    name: 'COCO 色号图纸',
    createdAt: 100,
  }, 200)
  const restored = parsePatternProjectFile(encodePatternProjectFile(stored))
  const restoredRed = restored.palette.colors.find(color => color.id === red.id)

  assert.equal(restored.colorSystem, 'COCO')
  assert.equal(restored.pattern.paletteId, 'pinbean:supplier:COCO')
  assert.deepEqual(restored.pattern.paletteTable, pattern.paletteTable)
  assert.ok(restoredRed)
  assert.equal(restoredRed.code, colorSystemMapping[red.hex]?.COCO)
})

test('restore rejects unsupported envelopes and palette drift but retains unknown generation', () => {
  const stored = storePatternProject(pattern, 'MARD', {
    id: 'project-1',
    name: '测试图纸',
    createdAt: 100,
  }, 200)
  assert.throws(
    () => restorePatternProject({ ...stored, formatVersion: 99 }),
    /unsupported stored project format/,
  )
  assert.throws(
    () => restorePatternProject({
      ...stored,
      project: { ...stored.project, paletteVersion: 'missing' },
    }),
    /does not match (generation config|palette metadata)/,
  )
  const { generation, ...withoutGeneration } = stored.project
  assert.ok(generation)
  const restored = restorePatternProject({ ...stored, project: withoutGeneration })
  assert.equal(restored.project.generation, undefined)
  assert.equal(restored.pattern.sourceGeneration, null)
  const savedAgain = storePatternProject(restored.pattern, restored.colorSystem, restored.project, 300,
    undefined, undefined, undefined, restored.palette)
  assert.equal(savedAgain.project.generation, undefined)
})

test('project file is readable JSON and imports through the current envelope', () => {
  const progress = toggleProductionBoard(
    toggleProductionColor(
      createProductionProgress(pattern, 210),
      red.id,
      new Set([red.id, black.id]),
      220,
    ),
    '1-1',
    new Set(['1-1']),
    230,
  )
  const stored = storePatternProject(pattern, 'MARD', {
    id: 'project-file-1',
    name: '可带走的图纸',
    createdAt: 100,
  }, 300, progress, createProjectWorkflow('photo'), createPublishReview({
    comments: 5,
    favorites: 20,
    likes: 50,
    publishedAt: 240,
    topic: '照片转拼豆',
    updatedAt: 280,
  }))
  const text = encodePatternProjectFile(stored)
  assert.equal(JSON.parse(text).formatVersion, 2)
  assert.match(text, /"paletteTable"/)
  assert.ok(text.endsWith('\n'))

  const restored = parsePatternProjectFile(`\uFEFF${text}`)
  assert.equal(restored.project.name, '可带走的图纸')
  assert.equal(restored.project.updatedAt, 300)
  assert.deepEqual(Array.from(restored.pattern.grid.cells), [0, 1, 2, 1])
  assert.deepEqual(restored.progress, progress)
  assert.deepEqual(restored.workflow, { formatVersion: 1, projectType: 'photo' })
  assert.deepEqual(restored.publishReview, {
    comments: 5,
    conversions: 0,
    favorites: 20,
    formatVersion: 1,
    likes: 50,
    note: '',
    publishedAt: 240,
    topic: '照片转拼豆',
    updatedAt: 280,
  })
})

test('project file migrates schema V0 without changing its grid or palette identity', () => {
  const stored = storePatternProject(pattern, 'MARD', {
    id: 'legacy-project',
    name: '旧项目',
    createdAt: 100,
  }, 300)
  const legacyProject = {
    ...stored.project,
    schemaVersion: 0,
  } as Record<string, unknown>
  delete legacyProject.updatedAt
  const restored = parsePatternProjectFile(JSON.stringify({ ...stored, project: legacyProject }))
  assert.equal(restored.project.schemaVersion, 1)
  assert.equal(restored.project.updatedAt, 100)
  assert.deepEqual(Array.from(restored.pattern.grid.cells), [0, 1, 2, 1])
  assert.equal(restored.palette.version, palette.version)
})

test('project file errors distinguish JSON, envelope, schema, palette and damaged content', () => {
  const stored = storePatternProject(pattern, 'MARD', {
    id: 'project-errors',
    name: '错误分类',
    createdAt: 100,
  }, 300)
  const assertCode = (text: string, code: ProjectImportError['code']): void => {
    assert.throws(
      () => parsePatternProjectFile(text),
      error => error instanceof ProjectImportError && error.code === code,
    )
  }

  assertCode('{', 'invalid-json')
  assertCode(JSON.stringify({ ...stored, formatVersion: 9 }), 'unsupported-format')
  assertCode(JSON.stringify({
    ...stored,
    project: { ...stored.project, schemaVersion: 99 },
  }), 'unsupported-schema')
  assertCode(JSON.stringify({
    ...stored,
    project: {
      ...stored.project,
      paletteVersion: 'missing',
      generation: {
        ...stored.project.generation,
        config: { ...stored.project.generation?.config, paletteVersion: 'missing' },
      },
    },
  }), 'palette-unavailable')
  assertCode(JSON.stringify({
    ...stored,
    project: {
      ...stored.project,
      grid: { ...stored.project.grid, cells: [0, 1, 3, 1] },
    },
  }), 'invalid-project')
})
