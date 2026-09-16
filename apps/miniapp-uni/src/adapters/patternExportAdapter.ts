import type {
  BoardAtlasExportModel,
  BoardExportModel,
  MaterialListExportModel,
  PatternExportModel,
} from '@/services/patternExport'
import type { ShareCoverExportModel } from '@/services/shareCoverExport'

export type ImageDelivery = 'album' | 'download'

function drawCanvas(context: UniApp.CanvasContext): Promise<void> {
  return new Promise(resolve => context.draw(false, resolve))
}

function cellLabelFontSize(code: string, cellSize: number): number {
  if (code.length <= 2) return Math.max(11, Math.floor(cellSize * 0.56))
  if (code.length === 3) return Math.max(9, Math.floor(cellSize * 0.43))
  return Math.max(7, Math.floor(cellSize * 0.34))
}

export async function drawPatternExportCanvas(
  canvasId: string,
  model: PatternExportModel,
): Promise<void> {
  const { layout } = model
  const context = uni.createCanvasContext(canvasId)
  context.setFillStyle('#F7F8FA')
  context.fillRect(0, 0, layout.width, layout.height)

  const titleFontSize = Math.max(32, Math.floor(layout.cellSize * 1.5))
  context.setFillStyle('#1C1C1E')
  context.setFontSize(titleFontSize)
  context.setTextAlign('left')
  context.setTextBaseline('middle')
  context.fillText('🎨 豆画', 24, layout.headerHeight / 2)
  context.setFillStyle('#8E8E93')
  context.setFontSize(Math.max(18, Math.floor(layout.cellSize * 0.8)))
  context.setTextAlign('left')
  context.fillText(
    `|   ${model.colorSystem}色板 · 共 ${model.total} 颗 · 粗略摆豆 ${model.timeText}`,
    24 + titleFontSize * 4.5 + 16,
    layout.headerHeight / 2 + 2,
  )

  const coordinateBackground = '#E0E8F0'
  const coordinateText = '#333333'
  const coordinateGap = 2
  const coordinateFontSize = Math.max(10, Math.floor(layout.cellSize * 0.46))
  context.setFontSize(coordinateFontSize)
  context.setTextAlign('center')
  context.setTextBaseline('middle')

  if (model.options.showCoordinates) {
    for (let column = 0; column < model.width; column += 1) {
      const x = layout.gridStartX + column * layout.cellSize
      const bottom = layout.gridStartY + layout.gridHeight
      context.setFillStyle(coordinateBackground)
      context.fillRect(x + coordinateGap, layout.headerHeight + coordinateGap, layout.cellSize - coordinateGap, layout.coordinateSize - coordinateGap)
      context.fillRect(x + coordinateGap, bottom + coordinateGap, layout.cellSize - coordinateGap, layout.coordinateSize - coordinateGap)
      context.setFillStyle(coordinateText)
      context.fillText(String(column + 1), x + layout.cellSize / 2 + coordinateGap / 2, layout.headerHeight + layout.coordinateSize / 2 + coordinateGap / 2)
      context.fillText(String(column + 1), x + layout.cellSize / 2 + coordinateGap / 2, bottom + layout.coordinateSize / 2 + coordinateGap / 2)
    }

    for (let row = 0; row < model.height; row += 1) {
      const y = layout.gridStartY + row * layout.cellSize
      const left = layout.gridStartX - layout.coordinateSize
      const right = layout.gridStartX + layout.gridWidth
      context.setFillStyle(coordinateBackground)
      context.fillRect(left + coordinateGap, y + coordinateGap, layout.coordinateSize - coordinateGap, layout.cellSize - coordinateGap)
      context.fillRect(right + coordinateGap, y + coordinateGap, layout.coordinateSize - coordinateGap, layout.cellSize - coordinateGap)
      context.setFillStyle(coordinateText)
      context.fillText(String(row + 1), left + layout.coordinateSize / 2 + coordinateGap / 2, y + layout.cellSize / 2 + coordinateGap / 2)
      context.fillText(String(row + 1), right + layout.coordinateSize / 2 + coordinateGap / 2, y + layout.cellSize / 2 + coordinateGap / 2)
    }
  }

  context.setFillStyle(model.options.showGrid ? '#F5F5F5' : '#FFFFFF')
  context.fillRect(layout.gridStartX, layout.gridStartY, layout.gridWidth, layout.gridHeight)

  for (const cell of model.cells) {
    const x = layout.gridStartX + cell.column * layout.cellSize
    const y = layout.gridStartY + cell.row * layout.cellSize
    context.setFillStyle(cell.hex)
    const gap = model.options.showGrid ? 1 : 0
    context.fillRect(x + gap, y + gap, layout.cellSize - gap * 2, layout.cellSize - gap * 2)
    if (!cell.isEmpty && model.options.showCellNumbers) {
      context.setFillStyle(cell.textColor)
      context.setFontSize(cellLabelFontSize(cell.code, layout.cellSize))
      context.setTextAlign('center')
      context.setTextBaseline('middle')
      context.fillText(cell.code, x + layout.cellSize / 2, y + layout.cellSize / 2)
    }
  }

  if (model.options.showGrid) {
    context.setStrokeStyle(model.options.gridLineColor)
    context.setLineWidth(1)
    for (let column = model.options.gridInterval; column < model.width; column += model.options.gridInterval) {
      const x = layout.gridStartX + column * layout.cellSize
      context.beginPath()
      context.moveTo(x, layout.gridStartY)
      context.lineTo(x, layout.gridStartY + layout.gridHeight)
      context.stroke()
    }
    for (let row = model.options.gridInterval; row < model.height; row += model.options.gridInterval) {
      const y = layout.gridStartY + row * layout.cellSize
      context.beginPath()
      context.moveTo(layout.gridStartX, y)
      context.lineTo(layout.gridStartX + layout.gridWidth, y)
      context.stroke()
    }
  }

  const legendStartY = layout.gridStartY + layout.gridHeight + layout.coordinateSize
  if (layout.footerHeight > 0) {
    context.setFillStyle('#FFFFFF')
    context.fillRect(0, legendStartY, layout.width, layout.footerHeight)
    model.legend.forEach((item, index) => {
      const column = index % layout.legendItemsPerRow
      const row = Math.floor(index / layout.legendItemsPerRow)
      const x = 20 + column * layout.legendItemWidth
      const y = legendStartY + 20 + row * 30
      const itemWidth = layout.legendItemWidth - 10
      context.setFillStyle(item.hex)
      context.fillRect(x, y + 3, itemWidth, 24)
      context.setStrokeStyle('#D7D7D7')
      context.strokeRect(x, y + 3, itemWidth, 24)
      context.setFontSize(12)
      context.setTextAlign('center')
      context.setTextBaseline('middle')
      context.setFillStyle(item.textColor)
      context.fillText(`${item.code} · ${item.count}`, x + itemWidth / 2, y + 15)
    })
  }

  await drawCanvas(context)
}

export async function drawMaterialListCanvas(
  canvasId: string,
  model: MaterialListExportModel,
): Promise<void> {
  const { layout } = model
  const context = uni.createCanvasContext(canvasId)
  context.setFillStyle('#F7F8FA')
  context.fillRect(0, 0, layout.width, layout.height)
  context.setTextAlign('left')
  context.setTextBaseline('middle')
  context.setFillStyle('#1C1C1E')
  context.setFontSize(34)
  context.fillText('PinBean 备料清单', layout.padding, 42)
  context.setFillStyle('#6B7280')
  context.setFontSize(20)
  context.fillText(
    `${model.projectName.slice(0, 22)} · ${model.colorSystem} 色板`,
    layout.padding,
    80,
  )
  context.fillText(
    `实际 ${model.total} 颗 · 建议备 ${model.reserveTotal} 颗 · ${model.items.length} 色`,
    layout.padding,
    114,
  )
  context.setTextAlign('right')
  context.fillText(
    `进度 ${model.completedColors}/${model.items.length} 色 · ${model.completedBeads}/${model.total} 颗`,
    layout.width - layout.padding,
    114,
  )

  model.items.forEach((item, index) => {
    const row = Math.floor(index / layout.columns)
    const column = index % layout.columns
    const x = layout.padding + column * (layout.itemWidth + layout.itemGap)
    const y = layout.headerHeight + row * layout.itemHeight
    const cardHeight = layout.itemHeight - 10
    context.setFillStyle('#FFFFFF')
    context.fillRect(x, y, layout.itemWidth, cardHeight)
    context.setStrokeStyle('#E5E7EB')
    context.strokeRect(x, y, layout.itemWidth, cardHeight)
    context.setFillStyle(item.hex)
    context.fillRect(x + 12, y + 7, 42, 42)
    context.setStrokeStyle('#D1D5DB')
    context.strokeRect(x + 12, y + 7, 42, 42)
    context.setFillStyle(item.textColor)
    context.setFontSize(13)
    context.setTextAlign('center')
    context.fillText(item.code, x + 33, y + 28)
    context.setFillStyle('#1C1C1E')
    context.setFontSize(19)
    context.setTextAlign('left')
    context.fillText(item.code, x + 68, y + 19)
    context.setFillStyle('#6B7280')
    context.setFontSize(15)
    context.fillText(`实际 ${item.count} 颗 · 备 ${item.reserveCount} 颗`, x + 68, y + 39)
    context.setFillStyle(item.isCompleted ? '#287052' : '#9CA3AF')
    context.setFontSize(14)
    context.setTextAlign('right')
    context.fillText(item.isCompleted ? '已完成' : '待拼', x + layout.itemWidth - 14, y + 28)
  })

  const footerY = layout.height - layout.footerHeight
  context.setFillStyle('#FFFFFF')
  context.fillRect(0, footerY, layout.width, layout.footerHeight)
  context.setFillStyle('#8E8E93')
  context.setFontSize(18)
  context.setTextAlign('left')
  context.fillText('建议多备约 8%，制作时先拼大色块，再补边缘和细节。', layout.padding, footerY + 36)
  await drawCanvas(context)
}

export async function drawBoardExportCanvas(
  canvasId: string,
  model: BoardExportModel,
): Promise<void> {
  const { layout, piece } = model
  const context = uni.createCanvasContext(canvasId)
  context.setFillStyle('#F7F8FA')
  context.fillRect(0, 0, layout.width, layout.height)
  context.setTextBaseline('middle')
  context.setTextAlign('left')
  context.setFillStyle('#1C1C1E')
  context.setFontSize(30)
  context.fillText(`${piece.title} · ${piece.sizeText}`, 24, 32)
  context.setFillStyle('#747474')
  context.setFontSize(17)
  context.fillText(`${piece.rangeText} · ${model.colorSystem} 色板`, 24, 64)

  const coordinateBackground = '#E0E8F0'
  const coordinateText = '#333333'
  context.setFontSize(Math.max(10, Math.floor(layout.cellSize * 0.45)))
  context.setTextAlign('center')
  for (let column = 0; column < piece.width; column += 1) {
    const x = layout.gridStartX + column * layout.cellSize
    const bottom = layout.gridStartY + layout.gridHeight
    context.setFillStyle(coordinateBackground)
    context.fillRect(x, layout.headerHeight, layout.cellSize, layout.coordinateSize)
    context.fillRect(x, bottom, layout.cellSize, layout.coordinateSize)
    context.setFillStyle(coordinateText)
    const globalColumn = piece.startColumn + column
    context.fillText(String(globalColumn), x + layout.cellSize / 2, layout.headerHeight + layout.coordinateSize / 2)
    context.fillText(String(globalColumn), x + layout.cellSize / 2, bottom + layout.coordinateSize / 2)
  }
  for (let row = 0; row < piece.height; row += 1) {
    const y = layout.gridStartY + row * layout.cellSize
    const right = layout.gridStartX + layout.gridWidth
    context.setFillStyle(coordinateBackground)
    context.fillRect(0, y, layout.coordinateSize, layout.cellSize)
    context.fillRect(right, y, layout.coordinateSize, layout.cellSize)
    context.setFillStyle(coordinateText)
    const globalRow = piece.startRow + row
    context.fillText(String(globalRow), layout.coordinateSize / 2, y + layout.cellSize / 2)
    context.fillText(String(globalRow), right + layout.coordinateSize / 2, y + layout.cellSize / 2)
  }

  for (const cell of piece.cells) {
    const x = layout.gridStartX + cell.column * layout.cellSize
    const y = layout.gridStartY + cell.row * layout.cellSize
    context.setFillStyle(cell.hex)
    context.fillRect(x + 1, y + 1, layout.cellSize - 2, layout.cellSize - 2)
    if (!cell.isEmpty) {
      context.setFillStyle(cell.textColor)
      context.setFontSize(cellLabelFontSize(cell.code, layout.cellSize))
      context.setTextAlign('center')
      context.fillText(cell.code, x + layout.cellSize / 2, y + layout.cellSize / 2)
    }
  }

  if (layout.footerHeight > 0) {
    const footerY = layout.height - layout.footerHeight
    context.setFillStyle('#FFFFFF')
    context.fillRect(0, footerY, layout.width, layout.footerHeight)
    context.setFillStyle('#1C1C1E')
    context.setFontSize(17)
    context.setTextAlign('left')
    context.fillText(`本板 ${piece.total} 颗 · ${piece.colors.length} 色`, 16, footerY + 20)
    const colors = piece.colors.slice(0, 6)
    const itemWidth = Math.max(90, (layout.width - 32) / Math.max(1, colors.length))
    colors.forEach((item, index) => {
      const x = 16 + index * itemWidth
      const width = Math.min(100, itemWidth - 8)
      context.setFillStyle(item.hex)
      context.fillRect(x, footerY + 42, width, 28)
      context.setStrokeStyle('#E5E7EB')
      context.strokeRect(x, footerY + 42, width, 28)
      context.setFillStyle(item.textColor)
      context.setFontSize(12)
      context.setTextAlign('center')
      context.fillText(`${item.code}×${item.count}`, x + width / 2, footerY + 56)
    })
  }

  await drawCanvas(context)
}

export async function drawBoardAtlasCanvas(
  canvasId: string,
  model: BoardAtlasExportModel,
): Promise<void> {
  const { layout, plan } = model
  const context = uni.createCanvasContext(canvasId)
  context.setFillStyle('#F7F8FA')
  context.fillRect(0, 0, layout.width, layout.height)
  context.setTextBaseline('middle')
  context.setTextAlign('left')
  context.setFillStyle('#1C1C1E')
  context.setFontSize(36)
  context.fillText(`${model.projectName.slice(0, 20)} · 分板合集`, layout.padding, 44)
  context.setFillStyle('#747474')
  context.setFontSize(20)
  context.fillText(
    `${plan.columns}×${plan.rows} 拼板 · 共 ${plan.count} 块 · ${model.total} 颗 · ${model.colorSystem} 色板`,
    layout.padding,
    86,
  )
  context.setFontSize(17)
  context.fillText('按从左到右、从上到下的顺序编号', layout.padding, 116)

  plan.pieces.forEach((piece, index) => {
    const row = Math.floor(index / layout.columns)
    const column = index % layout.columns
    const x = layout.padding + column * (layout.itemWidth + layout.gap)
    const y = layout.headerHeight + row * (layout.itemHeight + layout.gap)
    const gridWidth = piece.width * layout.thumbnailCellSize
    const gridHeight = piece.height * layout.thumbnailCellSize
    const gridX = x + (layout.itemWidth - gridWidth) / 2
    const gridY = y + layout.itemHeaderHeight

    context.setFillStyle('#FFFFFF')
    context.fillRect(x, y, layout.itemWidth, layout.itemHeight)
    context.setStrokeStyle('#E5E7EB')
    context.strokeRect(x, y, layout.itemWidth, layout.itemHeight)
    context.setFillStyle('#1C1C1E')
    context.setFontSize(24)
    context.setTextAlign('left')
    context.fillText(`${piece.title} · ${piece.sizeText}`, x + 18, y + 24)
    context.setFillStyle('#6B7280')
    context.setFontSize(16)
    context.fillText(piece.rangeText, x + 18, y + 52)
    context.setFillStyle('#F3F4F6')
    context.fillRect(gridX, gridY, gridWidth, gridHeight)

    for (const cell of piece.cells) {
      const cellX = gridX + cell.column * layout.thumbnailCellSize
      const cellY = gridY + cell.row * layout.thumbnailCellSize
      context.setFillStyle(cell.hex)
      context.fillRect(cellX, cellY, layout.thumbnailCellSize - 1, layout.thumbnailCellSize - 1)
    }

    const footerY = y + layout.itemHeaderHeight + plan.boardSize * layout.thumbnailCellSize + 16
    const summary = piece.colors.length > 0
      ? piece.colors.slice(0, 4).map(item => `${item.code}×${item.count}`).join('、')
      : '无颜色'
    context.setFillStyle('#6B7280')
    context.setFontSize(16)
    context.setTextAlign('left')
    context.fillText(`本板 ${piece.total} 颗 · ${summary}`, x + 18, footerY)
  })

  const footerY = layout.height - layout.footerHeight
  context.setFillStyle('#FFFFFF')
  context.fillRect(0, footerY, layout.width, layout.footerHeight)
  context.setFillStyle('#8E8E93')
  context.setFontSize(18)
  context.setTextAlign('left')
  context.fillText('合集用于总览分板；精拼请使用单张分板图纸查看全局坐标和色号。', layout.padding, footerY + 30)
  await drawCanvas(context)
}

function drawShareMetricCard(
  context: UniApp.CanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  title: string,
  value: string,
): void {
  context.setFillStyle('#FFFFFF')
  context.fillRect(x, y, width, height)
  context.setStrokeStyle('#E5E7EB')
  context.strokeRect(x, y, width, height)
  context.setFillStyle('#6B7280')
  context.setFontSize(20)
  context.setTextAlign('center')
  context.setTextBaseline('middle')
  context.fillText(title, x + width / 2, y + 30)
  context.setFillStyle('#111827')
  context.setFontSize(28)
  context.fillText(value, x + width / 2, y + 66)
}

export async function drawShareCoverCanvas(
  canvasId: string,
  model: ShareCoverExportModel,
): Promise<void> {
  const { assessment, layout } = model
  const context = uni.createCanvasContext(canvasId)
  context.setFillStyle('#F7F8FA')
  context.fillRect(0, 0, layout.width, layout.height)
  context.setTextAlign('left')
  context.setTextBaseline('middle')
  context.setFillStyle('#111827')
  context.setFontSize(48)
  context.fillText(model.projectName.slice(0, 16), layout.padding, 92)
  context.setFillStyle('#6B7280')
  context.setFontSize(24)
  context.fillText(
    `${assessment.sizeText} · ${assessment.beadText} · ${assessment.colorText}`,
    layout.padding,
    142,
  )

  context.setFillStyle('#F3F4F6')
  context.fillRect(layout.padding, layout.thumbnailY, layout.thumbnailSize, layout.thumbnailSize)
  const gap = layout.thumbnailCellSize >= 10 ? 1 : 0
  for (const cell of model.cells) {
    context.setFillStyle(cell.hex)
    context.fillRect(
      layout.thumbnailStartX + cell.column * layout.thumbnailCellSize,
      layout.thumbnailStartY + cell.row * layout.thumbnailCellSize,
      layout.thumbnailCellSize - gap,
      layout.thumbnailCellSize - gap,
    )
  }
  context.setStrokeStyle('#E5E7EB')
  context.strokeRect(
    layout.thumbnailStartX,
    layout.thumbnailStartY,
    model.width * layout.thumbnailCellSize,
    model.height * layout.thumbnailCellSize,
  )

  const boardValue = assessment.hasMultipleBoards ? `${assessment.boardCount} 块` : '单板'
  drawShareMetricCard(
    context,
    layout.padding,
    layout.metricsY,
    layout.metricCardWidth,
    layout.metricCardHeight,
    '难度',
    assessment.level,
  )
  drawShareMetricCard(
    context,
    layout.padding + layout.metricCardWidth + layout.metricCardGap,
    layout.metricsY,
    layout.metricCardWidth,
    layout.metricCardHeight,
    '粗略摆豆',
    assessment.timeText,
  )
  drawShareMetricCard(
    context,
    layout.padding + (layout.metricCardWidth + layout.metricCardGap) * 2,
    layout.metricsY,
    layout.metricCardWidth,
    layout.metricCardHeight,
    '拼板',
    boardValue,
  )

  context.setFillStyle('#111827')
  context.setFontSize(24)
  context.setTextAlign('left')
  context.fillText('主色消耗', layout.padding, layout.paletteY)
  const swatchGap = 10
  const swatchWidth = Math.min(
    138,
    (layout.width - layout.padding * 2 - swatchGap * Math.max(0, model.topColors.length - 1))
      / Math.max(1, model.topColors.length),
  )
  model.topColors.forEach((item, index) => {
    const x = layout.padding + index * (swatchWidth + swatchGap)
    const y = layout.paletteY + 30
    context.setFillStyle(item.hex)
    context.fillRect(x, y, swatchWidth, 54)
    context.setStrokeStyle('#E5E7EB')
    context.strokeRect(x, y, swatchWidth, 54)
    context.setFillStyle(item.textColor)
    context.setFontSize(17)
    context.setTextAlign('center')
    context.fillText(`${item.code}×${item.count}`, x + swatchWidth / 2, y + 27)
  })

  const footerY = layout.height - layout.footerHeight
  context.setFillStyle('#FFFFFF')
  context.fillRect(0, footerY, layout.width, layout.footerHeight)
  context.setFillStyle('#111827')
  context.setFontSize(24)
  context.setTextAlign('left')
  context.fillText(model.progressText, layout.padding, footerY + 44)
  context.setFillStyle('#8E8E93')
  context.setFontSize(20)
  context.fillText('PinBean · 图片转拼豆图纸', layout.padding, footerY + 82)
  await drawCanvas(context)
}

export function canvasToPng(
  canvasId: string,
  width: number,
  height: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    uni.canvasToTempFilePath({
      canvasId,
      destHeight: height,
      destWidth: width,
      fileType: 'png',
      height,
      quality: 1,
      width,
      x: 0,
      y: 0,
      success: result => resolve(result.tempFilePath),
      fail: error => reject(new Error(error.errMsg ?? '导出图纸图片失败')),
    })
  })
}

async function ensureWeixinAlbumPermission(): Promise<void> {
  // #ifdef MP-WEIXIN
  const scope = 'scope.writePhotosAlbum'
  const settings = await new Promise<Record<string, boolean>>((resolve, reject) => {
    uni.getSetting({
      success: result => resolve((result.authSetting ?? {}) as unknown as Record<string, boolean>),
      fail: error => reject(new Error(error.errMsg ?? '读取相册权限失败')),
    })
  })
  if (settings[scope]) return
  if (settings[scope] === false) {
    const confirmed = await new Promise<boolean>(resolve => {
      uni.showModal({
        title: '需要相册权限',
        content: '保存图纸需要打开相册写入权限，请在设置中允许后再继续。',
        confirmText: '去设置',
        cancelText: '取消',
        success: result => resolve(Boolean(result.confirm)),
        fail: () => resolve(false),
      })
    })
    if (!confirmed) throw new Error('未授权相册权限，无法保存图纸')
    const reopened = await new Promise<Record<string, boolean>>((resolve, reject) => {
      uni.openSetting({
        success: result => resolve((result.authSetting ?? {}) as unknown as Record<string, boolean>),
        fail: error => reject(new Error(error.errMsg ?? '打开权限设置失败')),
      })
    })
    if (!reopened[scope]) throw new Error('未授权相册权限，无法保存图纸')
    return
  }
  await new Promise<void>((resolve, reject) => {
    uni.authorize({
      scope,
      success: () => resolve(),
      fail: () => reject(new Error('未授权相册权限，无法保存图纸')),
    })
  })
  // #endif
}

export async function deliverPng(tempFilePath: string, fileName: string): Promise<ImageDelivery> {
  // #ifdef H5
  const link = document.createElement('a')
  link.download = fileName
  link.href = tempFilePath
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  return 'download'
  // #endif

  // #ifdef MP-WEIXIN
  await ensureWeixinAlbumPermission()
  await new Promise<void>((resolve, reject) => {
    uni.saveImageToPhotosAlbum({
      filePath: tempFilePath,
      success: () => resolve(),
      fail: error => reject(new Error(error.errMsg ?? '保存到相册失败')),
    })
  })
  return 'album'
  // #endif

  throw new Error('当前平台暂不支持图纸图片导出')
}

export function copyText(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    uni.setClipboardData({
      data: text,
      success: () => resolve(),
      fail: error => reject(new Error(error.errMsg ?? '复制备料清单失败')),
    })
  })
}
