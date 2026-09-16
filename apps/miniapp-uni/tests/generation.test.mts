import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

import { hashPattern } from '@pinbean/bead-core'
import {
  COLOR_SYSTEMS,
  createSupplierPalette,
} from '@pinbean/palette-data'
import colorSystemMapping from './support/colorSystemMapping.mts'

import {
  generatePattern,
  MAX_PATTERN_GRID_SIZE,
  MIN_PATTERN_GRID_SIZE,
} from '../src/services/generation.ts'

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8'))
}

interface FixtureManifest {
  formatVersion: 1
  fixtures: Array<{ height: number; name: string; width: number }>
}

const fixtureManifest = readJson(
  '../../web/tests/fixtures/real-images/manifest.json',
) as FixtureManifest

assert.equal(fixtureManifest.formatVersion, 1)
assert.ok(fixtureManifest.fixtures.length >= 5 && fixtureManifest.fixtures.length <= 8)

function decodeFixture(fixture: FixtureManifest['fixtures'][number]) {
  const compressed = readFileSync(fileURLToPath(new URL(
    `../../web/tests/fixtures/real-images/${fixture.name}.rgba.gz`,
    import.meta.url,
  )))
  const data = gunzipSync(compressed)
  assert.equal(data.byteLength, fixture.width * fixture.height * 4)
  return {
    width: fixture.width,
    height: fixture.height,
    rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
  }
}

for (const fixture of fixtureManifest.fixtures) {
  for (const mode of ['dominant', 'average'] as const) {
    test(`uni generation matches the approved Web ${fixture.name} fixture in ${mode} mode`, () => {
      const expected = readJson(
        `../../web/tests/fixtures/real-images/expected/${fixture.name}-${mode}.json`,
      ).expected
      const result = generatePattern(decodeFixture(fixture), {
        colorSystem: 'MARD',
        gridSize: 32,
        mode: mode === 'dominant' ? 'cartoon' : 'realistic',
        similarityThreshold: 15,
      })

      assert.equal(hashPattern(result.pattern), expected.gridHash)
      assert.equal(result.pattern.grid.width, expected.width)
      assert.equal(result.pattern.grid.height, expected.height)
      assert.equal(result.statistics.total, expected.total)
      assert.deepEqual(result.pattern.paletteTable, expected.paletteTable)
      assert.deepEqual(result.statistics.colors, expected.statistics)
      assert.deepEqual(Array.from(result.pattern.grid.cells), expected.cells)
    })
  }
}

test('all supplier systems keep stable color identity while exposing their own codes', () => {
  const settings = {
    gridSize: 32,
    mode: 'cartoon' as const,
    similarityThreshold: 15,
  }
  const lineArt = fixtureManifest.fixtures.find(fixture => fixture.name === 'line-art')
  assert.ok(lineArt)
  const baseline = generatePattern(decodeFixture(lineArt), {
    ...settings,
    colorSystem: 'MARD',
  })

  for (const colorSystem of COLOR_SYSTEMS) {
    const result = generatePattern(decodeFixture(lineArt), { ...settings, colorSystem })
    const palette = createSupplierPalette(colorSystemMapping, colorSystem)
    const firstUsedId = result.pattern.paletteTable[1]
    const displayColor = palette.colors.find(color => color.id === firstUsedId)

    assert.equal(result.pattern.paletteId, `pinbean:supplier:${colorSystem}`)
    assert.deepEqual(result.pattern.paletteTable, baseline.pattern.paletteTable)
    assert.deepEqual(Array.from(result.pattern.grid.cells), Array.from(baseline.pattern.grid.cells))
    assert.deepEqual(result.statistics, baseline.statistics)
    assert.ok(displayColor)
    assert.equal(displayColor.name, `${colorSystem} ${displayColor.code}`)
  }
})

test('uni generation enforces the approved 15–80 grid range and supports its boundaries', () => {
  const lineArt = fixtureManifest.fixtures.find(fixture => fixture.name === 'line-art')
  assert.ok(lineArt)
  const image = decodeFixture(lineArt)
  const settings = {
    colorSystem: 'MARD' as const,
    mode: 'cartoon' as const,
    similarityThreshold: 48,
  }

  for (const gridSize of [MIN_PATTERN_GRID_SIZE, MAX_PATTERN_GRID_SIZE]) {
    const result = generatePattern(image, { ...settings, gridSize })
    assert.equal(result.pattern.grid.width, gridSize)
    assert.equal(result.pattern.grid.height, gridSize)
    assert.equal(result.statistics.total, gridSize * gridSize)
  }

  for (const gridSize of [MIN_PATTERN_GRID_SIZE - 1, MAX_PATTERN_GRID_SIZE + 1, 32.5]) {
    assert.throws(
      () => generatePattern(image, { ...settings, gridSize }),
      /图纸横向格数必须是 15–80 的整数/,
    )
  }
})
