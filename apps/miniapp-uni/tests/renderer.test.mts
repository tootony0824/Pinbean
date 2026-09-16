import assert from 'node:assert/strict'
import test from 'node:test'

import type { BeadPattern, Palette } from '@pinbean/bead-core'

import { previewCellSize, renderPatternRgba } from '../src/rendering/patternRenderer.ts'

const palette: Palette = {
  id: 'test',
  version: '1',
  colors: [
    { id: 'red', code: 'R', hex: '#FF0000', rgb: { r: 255, g: 0, b: 0 } },
    { id: 'blue', code: 'B', hex: '#0000FF', rgb: { r: 0, g: 0, b: 255 } },
  ],
}

const pattern: BeadPattern = {
  grid: { width: 2, height: 1, cells: new Uint16Array([1, 0]) },
  paletteId: 'test',
  paletteVersion: '1',
  paletteTable: ['', 'red'],
  generationConfig: {
    algorithmVersion: 1,
    mode: 'cartoon',
    targetGrid: { axis: 'width', size: 2 },
    sampling: { scale: 4 },
    paletteId: 'test',
    paletteVersion: '1',
    similarityMerge: { enabled: false, threshold: 0 },
    alphaThreshold: 128,
  },
}

test('renderer expands numeric cells to RGBA and keeps EMPTY transparent', () => {
  const rendered = renderPatternRgba(pattern, palette, { cellSize: 2 })

  assert.deepEqual({ width: rendered.width, height: rendered.height }, { width: 4, height: 2 })
  assert.deepEqual([...rendered.rgba.slice(0, 16)], [
    255, 0, 0, 255,
    255, 0, 0, 255,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ])
  assert.deepEqual([...rendered.rgba.slice(16)], [...rendered.rgba.slice(0, 16)])
})

test('preview sizing stays bounded and renderer rejects identity drift', () => {
  assert.equal(previewCellSize(pattern, 12), 6)
  assert.throws(
    () => renderPatternRgba({ ...pattern, paletteVersion: '2' }, palette, { cellSize: 1 }),
    /identities do not match/,
  )
})
