import { readFileSync } from 'node:fs'

import type { ColorSystemMapping } from '@pinbean/palette-data'

const mappingUrl = new URL(
  '../../../../packages/palette-data/colorSystemMapping.json',
  import.meta.url,
)

export default JSON.parse(readFileSync(mappingUrl, 'utf8')) as ColorSystemMapping
