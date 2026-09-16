import type { BeadPattern, Palette } from '@pinbean/bead-core'
import type { ColorSystem } from '@pinbean/palette-data'

import {
  buildMaterialList,
  buildPatternExportModel,
  type MaterialListItem,
  type PatternExportCell,
} from '@/services/patternExport'
import type { CraftAssessment } from '@/services/productionAssessment'
import type { ProductionProgressSummary } from '@/services/productionProgress'

export interface ShareCoverLayout {
  footerHeight: number
  height: number
  metricCardGap: number
  metricCardHeight: number
  metricCardWidth: number
  metricsY: number
  padding: number
  paletteY: number
  thumbnailCellSize: number
  thumbnailSize: number
  thumbnailStartX: number
  thumbnailStartY: number
  thumbnailY: number
  width: number
}

export interface ShareCoverExportModel {
  assessment: CraftAssessment
  cells: PatternExportCell[]
  height: number
  layout: ShareCoverLayout
  progressText: string
  projectName: string
  topColors: MaterialListItem[]
  width: number
}

function compareTopColors(left: MaterialListItem, right: MaterialListItem): number {
  return right.count - left.count || left.code.localeCompare(right.code, 'zh-CN', { numeric: true })
}

export function buildShareCoverExportModel(
  pattern: BeadPattern,
  palette: Palette,
  colorSystem: ColorSystem,
  projectName: string,
  assessment: CraftAssessment,
  progress?: ProductionProgressSummary,
): ShareCoverExportModel {
  const width = 1080
  const height = 1440
  const padding = 72
  const thumbnailSize = 820
  const thumbnailY = 190
  const thumbnailCellSize = Math.max(
    1,
    Math.floor(Math.min(thumbnailSize / pattern.grid.width, thumbnailSize / pattern.grid.height)),
  )
  const thumbnailWidth = pattern.grid.width * thumbnailCellSize
  const thumbnailHeight = pattern.grid.height * thumbnailCellSize
  const metricsY = thumbnailY + thumbnailSize + 38
  const metricCardGap = 18
  const metricCardHeight = 96
  const metricCardWidth = (width - padding * 2 - metricCardGap * 2) / 3
  const patternModel = buildPatternExportModel(pattern, palette, colorSystem, projectName, {
    includeStats: false,
    showCellNumbers: false,
    showCoordinates: false,
    showGrid: false,
  })
  return {
    assessment,
    cells: patternModel.cells,
    height: pattern.grid.height,
    layout: {
      footerHeight: 126,
      height,
      metricCardGap,
      metricCardHeight,
      metricCardWidth,
      metricsY,
      padding,
      paletteY: metricsY + 132,
      thumbnailCellSize,
      thumbnailSize,
      thumbnailStartX: padding + Math.floor((thumbnailSize - thumbnailWidth) / 2),
      thumbnailStartY: thumbnailY + Math.floor((thumbnailSize - thumbnailHeight) / 2),
      thumbnailY,
      width,
    },
    progressText: progress
      ? `色号进度 ${progress.colorPercent}% · 分板进度 ${progress.boardPercent}%`
      : '上传图片即可生成专属拼豆图纸',
    projectName: projectName.trim() || 'PinBean 拼豆图纸',
    topColors: buildMaterialList(pattern, palette).sort(compareTopColors).slice(0, 6),
    width: pattern.grid.width,
  }
}
