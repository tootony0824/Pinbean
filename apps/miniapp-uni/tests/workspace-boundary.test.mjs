import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

import { EMPTY_CELL, createGrid } from '@pinbean/bead-core'

const require = createRequire(import.meta.url)
const colorSystemMapping = require('@pinbean/palette-data/color-system-mapping.json')

test('uni-app consumes the built core and shared palette through workspace package exports', () => {
  const grid = createGrid(2, 2, EMPTY_CELL)

  assert.deepEqual([...grid.cells], [0, 0, 0, 0])
  assert.equal(Object.keys(colorSystemMapping).length, 291)
  assert.equal(colorSystemMapping['#000000'].MARD, 'H07')
})
