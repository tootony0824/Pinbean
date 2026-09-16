import assert from 'node:assert/strict'
import test from 'node:test'

import { drawPatternExportCanvas } from '../src/adapters/patternExportAdapter.ts'
import type { PatternExportModel } from '../src/services/patternExport.ts'

test('pattern export renderer keeps the approved native and uni-app composition', async () => {
  const textCalls: Array<{ text: string, x: number, y: number }> = []
  const rectCalls: Array<{ height: number, width: number, x: number, y: number }> = []
  const context = {
    beginPath() {},
    draw(_reserve: boolean, callback: () => void) { callback() },
    fillRect(x: number, y: number, width: number, height: number) {
      rectCalls.push({ height, width, x, y })
    },
    fillText(text: string, x: number, y: number) { textCalls.push({ text, x, y }) },
    lineTo() {},
    moveTo() {},
    setFillStyle() {},
    setFontSize() {},
    setLineWidth() {},
    setStrokeStyle() {},
    setTextAlign() {},
    setTextBaseline() {},
    stroke() {},
    strokeRect() {},
  }
  Reflect.set(globalThis, 'uni', { createCanvasContext: () => context })

  const model: PatternExportModel = {
    cells: [
      { code: 'A1', column: 0, hex: '#FFFFFF', isEmpty: false, row: 0, textColor: '#000000' },
    ],
    colorSystem: 'MARD',
    height: 1,
    layout: {
      cellSize: 24,
      coordinateSize: 24,
      footerHeight: 70,
      gridHeight: 24,
      gridStartX: 24,
      gridStartY: 104,
      gridWidth: 24,
      headerHeight: 80,
      height: 198,
      legendItemWidth: 72,
      legendItemsPerRow: 1,
      width: 72,
    },
    legend: [{
      code: 'A1',
      count: 1,
      hex: '#FFFFFF',
      paletteIndex: 1,
      reserveCount: 2,
      textColor: '#000000',
    }],
    options: {
      gridInterval: 5,
      gridLineColor: '#F5F5F5',
      includeStats: true,
      showCellNumbers: true,
      showCoordinates: true,
      showGrid: true,
    },
    projectName: '测试图纸',
    timeText: '约 1 小时',
    total: 1,
    width: 1,
  }

  await drawPatternExportCanvas('exportCanvas', model)

  assert.ok(textCalls.some(call => call.text === '🎨 豆画'))
  assert.ok(textCalls.some(call => call.text === '|   MARD色板 · 共 1 颗 · 粗略摆豆 约 1 小时'))
  assert.ok(textCalls.some(call => call.text === 'A1 · 1'))
  assert.ok(textCalls.every(call => call.text !== 'PinBean 拼豆图纸'))
  assert.ok(rectCalls.some(call => (
    call.x === 26 && call.y === 82 && call.width === 22 && call.height === 22
  )), 'coordinate cells should keep the original two-pixel breathing room')
})
