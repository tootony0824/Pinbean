import {
  EMPTY_CELL,
  type BeadPattern,
  type NormalizedImage,
  type Palette,
} from '@pinbean/bead-core'

export interface RenderOptions {
  cellSize: number
}

function assertCellSize(cellSize: number): void {
  if (!Number.isInteger(cellSize) || cellSize <= 0 || cellSize > 32) {
    throw new RangeError('cellSize must be an integer from 1 to 32')
  }
}

function hexToRgb(hex: string): readonly [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]
}

export function renderPatternRgba(
  pattern: BeadPattern,
  palette: Palette,
  options: RenderOptions,
): NormalizedImage {
  assertCellSize(options.cellSize)
  if (pattern.paletteId !== palette.id || pattern.paletteVersion !== palette.version) {
    throw new Error('pattern and palette identities do not match')
  }
  const colorsById = new Map(palette.colors.map(color => [color.id, color]))
  const width = pattern.grid.width * options.cellSize
  const height = pattern.grid.height * options.cellSize
  const byteLength = width * height * 4
  if (!Number.isSafeInteger(byteLength)) throw new RangeError('render output is too large')
  const rgba = new Uint8ClampedArray(byteLength)

  for (let gridY = 0; gridY < pattern.grid.height; gridY += 1) {
    for (let gridX = 0; gridX < pattern.grid.width; gridX += 1) {
      const paletteIndex = pattern.grid.cells[gridY * pattern.grid.width + gridX] ?? EMPTY_CELL
      if (paletteIndex === EMPTY_CELL) continue
      const colorId = pattern.paletteTable[paletteIndex]
      const color = colorId ? colorsById.get(colorId) : undefined
      if (!color) throw new Error(`pattern references unavailable palette index ${paletteIndex}`)
      const [red, green, blue] = hexToRgb(color.hex)
      for (let localY = 0; localY < options.cellSize; localY += 1) {
        const y = gridY * options.cellSize + localY
        for (let localX = 0; localX < options.cellSize; localX += 1) {
          const x = gridX * options.cellSize + localX
          const offset = (y * width + x) * 4
          rgba[offset] = red
          rgba[offset + 1] = green
          rgba[offset + 2] = blue
          rgba[offset + 3] = 255
        }
      }
    }
  }
  return { width, height, rgba }
}

export function previewCellSize(pattern: BeadPattern, maxEdge = 600): number {
  if (!Number.isInteger(maxEdge) || maxEdge <= 0) throw new RangeError('maxEdge must be positive')
  const longestGridEdge = Math.max(pattern.grid.width, pattern.grid.height)
  return Math.max(1, Math.min(8, Math.floor(maxEdge / longestGridEdge)))
}
