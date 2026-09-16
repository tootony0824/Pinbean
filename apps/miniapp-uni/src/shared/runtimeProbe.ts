import { EMPTY_CELL } from '@pinbean/bead-core'
import { getSupplierColorSystemMapping } from '@pinbean/palette-data'

export const runtimeProbe = Object.freeze({
  coreEmptyValue: EMPTY_CELL,
  paletteColorCount: Object.keys(getSupplierColorSystemMapping()).length,
})
