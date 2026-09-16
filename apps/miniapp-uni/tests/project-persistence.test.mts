import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CURRENT_ALGORITHM_VERSION,
  createGrid,
  createCellProgress,
  createPatternSession,
  paintPatternSessionCell,
  createProductionProgress,
  hashPatternContent,
  type BeadPattern,
  type GenerationConfig,
  type Palette,
} from '@pinbean/bead-core'
import { LEGACY_ID_ONLY_SELECTION_VERSION, getSupplierPalette } from '@pinbean/palette-data'

import {
  encodePatternProjectFile,
  restorePatternProject,
  storePatternProject,
  type ProjectIdentity,
} from '../src/services/projectPersistence'

const palette = getSupplierPalette('MARD')
const identity: ProjectIdentity = {
  createdAt: 100,
  id: 'project-1',
  name: '测试图纸',
}

function createPattern(sourcePalette: Palette = palette): BeadPattern {
  const generationConfig: GenerationConfig = {
    algorithmVersion: CURRENT_ALGORITHM_VERSION,
    alphaThreshold: 128,
    mode: 'cartoon',
    paletteId: sourcePalette.id,
    paletteVersion: sourcePalette.version,
    sampling: { scale: 4 },
    similarityMerge: { enabled: true, threshold: 48 },
    targetGrid: { axis: 'width', size: 2 },
  }
  return {
    generationConfig,
    grid: createGrid(2, 1, [1, 2]),
    paletteId: sourcePalette.id,
    paletteTable: ['', sourcePalette.colors[0].id, sourcePalette.colors[1].id],
    paletteVersion: sourcePalette.version,
  }
}

test('storePatternProject rejects pending color-system drift before saving', () => {
  const pattern = createPattern()
  assert.throws(
    () => storePatternProject(pattern, 'COCO', identity, 200),
    /色号品牌不一致/,
  )
  assert.doesNotThrow(() => encodePatternProjectFile(
    storePatternProject(pattern, 'MARD', identity, 200),
  ))
})

test('restorePatternProject upgrades exact legacy supplier version without accepting palette drift', () => {
  const current = storePatternProject(createPattern(), 'MARD', identity, 200)
  const legacy = {
    ...current,
    formatVersion: 1,
    project: {
      ...current.project,
      paletteVersion: LEGACY_ID_ONLY_SELECTION_VERSION,
      generation: current.project.generation
        ? {
            ...current.project.generation,
            config: {
              ...current.project.generation.config,
              paletteVersion: LEGACY_ID_ONLY_SELECTION_VERSION,
            },
          }
        : undefined,
    },
  }

  const restored = restorePatternProject(legacy)
  assert.equal(restored.pattern.paletteVersion, palette.version)
  assert.equal(restored.pattern.generationConfig.paletteVersion, palette.version)

  assert.throws(
    () => restorePatternProject({
      ...current,
      project: {
        ...current.project,
        paletteVersion: 'unknown-version',
        generation: current.project.generation
          ? {
              ...current.project.generation,
              config: {
                ...current.project.generation.config,
                paletteVersion: 'unknown-version',
              },
            }
          : undefined,
      },
    }),
    /palette identity is unavailable/,
  )
})

test('subset selection including unused colors survives save restore edit save with sidecars', () => {
  const selectedIds = palette.colors.slice(0, 3).map(color => color.id)
  const subset = getSupplierPalette('MARD', selectedIds)
  const pattern = createPattern(subset)
  const sidecar = createCellProgress(identity.id, pattern, [0], 150)
  const stored = storePatternProject(pattern, 'MARD', identity, 200, undefined, undefined, undefined, subset, sidecar)
  assert.deepEqual(stored.selectedColorIds, selectedIds)
  assert.equal(stored.formatVersion, 2)
  const restored = restorePatternProject(JSON.parse(encodePatternProjectFile(stored)))
  assert.deepEqual(restored.cellProgress, sidecar)
  assert.deepEqual(restored.progress?.completedColorIds, [selectedIds[0]])
  assert.deepEqual(restored.palette, subset)
  const edited = paintPatternSessionCell(createPatternSession(restored.pattern, restored.palette), 1, selectedIds[2]).session.pattern
  const savedAgain = storePatternProject(edited, 'MARD', restored.project, 300, undefined, undefined, undefined, restored.palette)
  assert.deepEqual(savedAgain.selectedColorIds, selectedIds)
  assert.deepEqual(restorePatternProject(savedAgain).pattern.paletteTable, ['', selectedIds[0], selectedIds[2]])
  assert.throws(() => storePatternProject(pattern, 'MARD', identity, 200), /色号品牌不一致/)
})

test('stored progress is hash-bound and invalid imported progress fails the import transaction', () => {
  const pattern = createPattern()
  const progress = createProductionProgress(pattern, 100)
  const stored = storePatternProject(pattern, 'MARD', identity, 200, progress)
  assert.equal(restorePatternProject(stored).progress?.patternHash, hashPatternContent(pattern))
  assert.throws(
    () => restorePatternProject({
      ...stored,
      progress: { ...progress, patternHash: '' },
    }),
    /pattern hash/,
  )
})
