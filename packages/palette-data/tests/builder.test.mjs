import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

import { createSupplierPalette, createSupplierPaletteFromColorIds, getSupplierColorSystemMapping, getSupplierPalette } from '../dist/index.js'

const require = createRequire(import.meta.url)
const mapping = require('../colorSystemMapping.json')

test('full supplier palette has stable physical identities and display codes', () => {
  const palette = createSupplierPalette(mapping, 'MARD')
  const black = palette.colors.find(color => color.hex === '#000000')

  assert.equal(palette.id, 'pinbean:supplier:MARD')
  assert.equal(palette.version, 'color-system-mapping-v1:selection-eba5d44b')
  assert.equal(palette.colors.length, 291)
  assert.deepEqual(black, {
    id: 'pinbean:color:H07',
    code: 'H07',
    name: 'MARD H07',
    rgb: { r: 0, g: 0, b: 0 },
    hex: '#000000',
  })
})

test('selection order is canonical while selection content changes palette version', () => {
  const first = createSupplierPalette(mapping, 'COCO', ['#FFFFFF', '#000000'])
  const reversed = createSupplierPalette(mapping, 'COCO', ['#000000', '#FFFFFF'])
  const blackOnly = createSupplierPalette(mapping, 'COCO', ['#000000'])

  assert.deepEqual(first, reversed)
  assert.notEqual(first.version, blackOnly.version)
  assert.deepEqual(first.colors.map(color => color.id), [
    'pinbean:color:H07',
    'pinbean:color:T01',
  ])
  assert.deepEqual(first.colors.map(color => color.code), ['B09', 'L14'])
})

test('display-code aliases never collapse stable color identities', () => {
  const palette = createSupplierPalette(mapping, '漫漫')
  const aliases = palette.colors.filter(color => color.code === 'S4')

  assert.equal(aliases.length, 2)
  assert.equal(new Set(aliases.map(color => color.id)).size, 2)
})

test('package-level palette API owns the supplier mapping and accepts stable color ids', () => {
  assert.deepEqual(getSupplierColorSystemMapping(), mapping)
  assert.deepEqual(getSupplierPalette('MARD'), createSupplierPalette(mapping, 'MARD'))
  const byIds = createSupplierPaletteFromColorIds(mapping, 'COCO', ['pinbean:color:T01', 'pinbean:color:H07'])
  assert.deepEqual(byIds.colors.map(color => color.id), [
    'pinbean:color:H07',
    'pinbean:color:T01',
  ])
  assert.deepEqual(byIds.colors.map(color => color.code), ['B09', 'L14'])
  assert.throws(() => getSupplierPalette('MARD', ['pinbean:color:missing']), /unknown palette color id/)
})

test('unknown systems, colors and empty selections fail explicitly', () => {
  assert.throws(() => createSupplierPalette(mapping, 'UNKNOWN'), /unsupported color system/)
  assert.throws(() => createSupplierPalette(mapping, 'MARD', []), /must not be empty/)
  assert.throws(() => createSupplierPalette(mapping, 'MARD', ['#123456']), /unknown palette color/)
})

test('hex selection and mapping keys are normalized before lookup', () => {
  const lowerCaseMapping = {
    '#ffffff': mapping['#FFFFFF'],
    '#000000': mapping['#000000'],
  }
  const palette = createSupplierPalette(lowerCaseMapping, 'COCO', ['#ffffff'])
  assert.deepEqual(palette.colors.map(color => [color.id, color.hex, color.code]), [
    ['pinbean:color:T01', '#FFFFFF', 'L14'],
  ])
  assert.throws(() => createSupplierPalette({ '#ffffff': mapping['#FFFFFF'], '#FFFFFF': mapping['#FFFFFF'] }, 'MARD'), /duplicate normalized/)
})

test('package mapping API returns mutation-isolated copies', () => {
  const first = getSupplierColorSystemMapping()
  first['#000000'].MARD = 'BROKEN'
  assert.equal(getSupplierColorSystemMapping()['#000000'].MARD, mapping['#000000'].MARD)
  assert.equal(getSupplierPalette('MARD').colors.find(color => color.hex === '#000000')?.id, 'pinbean:color:H07')
})

test('palette version changes when display content changes under stable ids', () => {
  const changedDisplayCode = getSupplierColorSystemMapping()
  changedDisplayCode['#000000'].COCO = 'ALT'
  const original = createSupplierPalette(mapping, 'COCO', ['#000000'])
  const changed = createSupplierPalette(changedDisplayCode, 'COCO', ['#000000'])
  assert.equal(original.colors[0].id, changed.colors[0].id)
  assert.notEqual(original.version, changed.version)
})
