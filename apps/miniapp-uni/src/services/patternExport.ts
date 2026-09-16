import {
  EMPTY_CELL,
  buildBoardPlan,
  buildMaterialList,
  compactColorCode,
  contrastTextColor,
  formatEstimatedTime,
  type BeadPattern,
  type BoardPiece,
  type BoardPlan,
  type MaterialListItem,
  type Palette,
  type PaletteColor,
  type PatternExportCell,
} from '@pinbean/bead-core'

export {
  MATERIAL_RESERVE_RATE,
  STANDARD_BOARD_SIZE,
  buildBoardPlan,
  buildMaterialList,
  buildMaterialListText,
  compactColorCode,
  contrastTextColor,
} from '@pinbean/bead-core'
export type { BoardPiece, BoardPlan, MaterialListItem, PatternExportCell } from '@pinbean/bead-core'

export interface PatternExportOptions {
  gridInterval: number
  gridLineColor: string
  includeStats: boolean
  showCellNumbers: boolean
  showCoordinates: boolean
  showGrid: boolean
}

export const DEFAULT_PATTERN_EXPORT_OPTIONS: PatternExportOptions = {
  gridInterval: 5,
  gridLineColor: '#F5F5F5',
  includeStats: true,
  showCellNumbers: true,
  showCoordinates: true,
  showGrid: true,
}

const DEFAULT_CELL_SIZE = 24
const HEADER_HEIGHT = 80
const LEGEND_PADDING = 20
const LEGEND_ITEM_HEIGHT = 30
const LEGEND_ITEM_TARGET_WIDTH = 100
const MAX_EXPORT_WIDTH = 4000
const MAX_EXPORT_HEIGHT = 5000
const MIN_EXPORT_WIDTH = 900

export interface PatternExportLayout {
  cellSize: number
  coordinateSize: number
  footerHeight: number
  gridHeight: number
  gridStartX: number
  gridStartY: number
  gridWidth: number
  headerHeight: number
  height: number
  legendItemWidth: number
  legendItemsPerRow: number
  width: number
}

export interface PatternExportModel {
  cells: PatternExportCell[]
  colorSystem: string
  height: number
  layout: PatternExportLayout
  legend: MaterialListItem[]
  options: PatternExportOptions
  projectName: string
  timeText: string
  total: number
  width: number
}

export interface MaterialListExportLayout {
  columns: number
  footerHeight: number
  headerHeight: number
  height: number
  itemGap: number
  itemHeight: number
  itemWidth: number
  padding: number
  width: number
}

export interface MaterialListExportModel {
  colorSystem: string
  completedBeads: number
  completedColors: number
  items: MaterialListItem[]
  layout: MaterialListExportLayout
  projectName: string
  reserveTotal: number
  total: number
}

export interface BoardExportLayout {
  cellSize: number
  coordinateSize: number
  footerHeight: number
  gridHeight: number
  gridStartX: number
  gridStartY: number
  gridWidth: number
  headerHeight: number
  height: number
  width: number
}

export interface BoardExportModel {
  colorSystem: string
  layout: BoardExportLayout
  piece: BoardPiece
  projectName: string
}

export interface BoardAtlasLayout {
  columns: number
  footerHeight: number
  gap: number
  headerHeight: number
  height: number
  itemFooterHeight: number
  itemHeaderHeight: number
  itemHeight: number
  itemWidth: number
  padding: number
  thumbnailCellSize: number
  width: number
}

export interface BoardAtlasExportModel {
  colorSystem: string
  layout: BoardAtlasLayout
  plan: BoardPlan
  projectName: string
  total: number
}

function assertPatternPalette(pattern: BeadPattern, palette: Palette): Map<string, PaletteColor> {
  if (pattern.paletteId !== palette.id || pattern.paletteVersion !== palette.version) {
    throw new Error('图纸与色板版本不一致，无法导出')
  }
  const colorsById = new Map(palette.colors.map(color => [color.id, color]))
  for (const colorId of pattern.paletteTable.slice(1)) {
    if (!colorsById.has(colorId)) throw new Error(`图纸包含不可用颜色：${colorId}`)
  }
  return colorsById
}

function computeLayout(
  pattern: BeadPattern,
  legendCount: number,
  options: PatternExportOptions,
): PatternExportLayout {
  const cellSize = DEFAULT_CELL_SIZE
  const coordinateSize = options.showCoordinates ? cellSize : 0
  const gridWidth = pattern.grid.width * cellSize
  const gridHeight = pattern.grid.height * cellSize
  const width = Math.max(MIN_EXPORT_WIDTH, gridWidth + coordinateSize * 2)
  const legendItemsPerRow = Math.max(
    1,
    Math.min(legendCount || 1, Math.floor((width - LEGEND_PADDING * 2) / LEGEND_ITEM_TARGET_WIDTH)),
  )
  const legendItemWidth = (width - LEGEND_PADDING * 2) / legendItemsPerRow
  const legendRows = Math.ceil(legendCount / legendItemsPerRow)
  const footerHeight = options.includeStats && legendCount > 0
    ? LEGEND_PADDING * 2 + legendRows * LEGEND_ITEM_HEIGHT
    : 0
  const height = HEADER_HEIGHT + coordinateSize * 2 + gridHeight + footerHeight
  if (width > MAX_EXPORT_WIDTH || height > MAX_EXPORT_HEIGHT) {
    throw new Error(`导出尺寸 ${width} × ${height} 超出当前安全上限，请减小图纸格数`)
  }
  return {
    cellSize,
    coordinateSize,
    footerHeight,
    gridHeight,
    gridStartX: (width - gridWidth) / 2,
    gridStartY: HEADER_HEIGHT + coordinateSize,
    gridWidth,
    headerHeight: HEADER_HEIGHT,
    height,
    legendItemWidth,
    legendItemsPerRow,
    width,
  }
}

export function buildPatternExportModel(
  pattern: BeadPattern,
  palette: Palette,
  colorSystem: string,
  projectName: string,
  requestedOptions: Partial<PatternExportOptions> = {},
): PatternExportModel {
  const options = { ...DEFAULT_PATTERN_EXPORT_OPTIONS, ...requestedOptions }
  if (!Number.isInteger(options.gridInterval) || options.gridInterval <= 0) {
    throw new RangeError('网格线间隔必须是正整数')
  }
  if (!/^#[0-9A-Fa-f]{6}$/.test(options.gridLineColor)) {
    throw new Error('网格线颜色无效')
  }
  const colorsById = assertPatternPalette(pattern, palette)
  const legend = buildMaterialList(pattern, palette)
  const layout = computeLayout(pattern, legend.length, options)
  const cells: PatternExportCell[] = []
  for (let index = 0; index < pattern.grid.cells.length; index += 1) {
    const paletteIndex = pattern.grid.cells[index] ?? EMPTY_CELL
    const row = Math.floor(index / pattern.grid.width)
    const column = index % pattern.grid.width
    if (paletteIndex === EMPTY_CELL) {
      cells.push({ code: '', column, hex: '#F5F5F5', isEmpty: true, row, textColor: '#000000' })
      continue
    }
    const colorId = pattern.paletteTable[paletteIndex]
    const color = colorId ? colorsById.get(colorId) : undefined
    if (!color) throw new Error(`图纸色板索引无效：${paletteIndex}`)
    cells.push({
      code: compactColorCode(color.code),
      column,
      hex: color.hex,
      isEmpty: false,
      row,
      textColor: contrastTextColor(color.hex),
    })
  }
  const total = legend.reduce((sum, item) => sum + item.count, 0)
  return {
    cells,
    colorSystem,
    height: pattern.grid.height,
    layout,
    legend,
    options,
    projectName,
    timeText: formatEstimatedTime(total),
    total,
    width: pattern.grid.width,
  }
}

export function buildMaterialListExportModel(
  pattern: BeadPattern,
  palette: Palette,
  colorSystem: string,
  projectName: string,
  completedColorIds: readonly string[] = [],
): MaterialListExportModel {
  const items = buildMaterialList(pattern, palette, completedColorIds)
  const width = 900
  const padding = 32
  const itemGap = 18
  const columns = items.length > 18 ? 2 : 1
  const itemHeight = 62
  const headerHeight = 150
  const footerHeight = 72
  const rows = Math.max(1, Math.ceil(items.length / columns))
  const itemWidth = (width - padding * 2 - itemGap * (columns - 1)) / columns
  return {
    colorSystem,
    completedBeads: items.filter(item => item.isCompleted).reduce((sum, item) => sum + item.count, 0),
    completedColors: items.filter(item => item.isCompleted).length,
    items,
    layout: {
      columns,
      footerHeight,
      headerHeight,
      height: headerHeight + rows * itemHeight + footerHeight,
      itemGap,
      itemHeight,
      itemWidth,
      padding,
      width,
    },
    projectName,
    reserveTotal: items.reduce((sum, item) => sum + item.reserveCount, 0),
    total: items.reduce((sum, item) => sum + item.count, 0),
  }
}

export function buildBoardExportModel(
  pattern: BeadPattern,
  palette: Palette,
  colorSystem: string,
  projectName: string,
  piece: BoardPiece,
): BoardExportModel {
  assertPatternPalette(pattern, palette)
  const cellSize = 28
  const coordinateSize = cellSize
  const headerHeight = 88
  const footerHeight = piece.colors.length > 0 ? 88 : 0
  const gridWidth = piece.width * cellSize
  const gridHeight = piece.height * cellSize
  const width = gridWidth + coordinateSize * 2
  const height = headerHeight + coordinateSize * 2 + gridHeight + footerHeight
  if (width > MAX_EXPORT_WIDTH || height > MAX_EXPORT_HEIGHT) {
    throw new Error(`分板导出尺寸 ${width} × ${height} 超出当前安全上限`)
  }
  return {
    colorSystem,
    layout: {
      cellSize,
      coordinateSize,
      footerHeight,
      gridHeight,
      gridStartX: coordinateSize,
      gridStartY: headerHeight + coordinateSize,
      gridWidth,
      headerHeight,
      height,
      width,
    },
    piece,
    projectName,
  }
}

export function buildBoardAtlasExportModel(
  pattern: BeadPattern,
  palette: Palette,
  colorSystem: string,
  projectName: string,
  requestedPlan?: BoardPlan,
): BoardAtlasExportModel {
  const plan = requestedPlan ?? buildBoardPlan(pattern, palette)
  assertPatternPalette(pattern, palette)
  const width = 1200
  const padding = 32
  const gap = 24
  const columns = plan.count > 1 ? 2 : 1
  const itemWidth = (width - padding * 2 - gap * (columns - 1)) / columns
  const thumbnailCellSize = columns === 2 ? 14 : 18
  const itemHeaderHeight = 76
  const itemFooterHeight = 48
  const itemHeight = itemHeaderHeight + plan.boardSize * thumbnailCellSize + itemFooterHeight
  const headerHeight = 138
  const footerHeight = 58
  const rows = Math.max(1, Math.ceil(plan.count / columns))
  const height = headerHeight + rows * itemHeight + Math.max(0, rows - 1) * gap + footerHeight
  if (width > MAX_EXPORT_WIDTH || height > MAX_EXPORT_HEIGHT) {
    throw new Error(`分板合集尺寸 ${width} × ${height} 超出当前安全上限，请减少分板数量`)
  }
  return {
    colorSystem,
    layout: {
      columns,
      footerHeight,
      gap,
      headerHeight,
      height,
      itemFooterHeight,
      itemHeaderHeight,
      itemHeight,
      itemWidth,
      padding,
      thumbnailCellSize,
      width,
    },
    plan,
    projectName,
    total: plan.pieces.reduce((sum, piece) => sum + piece.total, 0),
  }
}
