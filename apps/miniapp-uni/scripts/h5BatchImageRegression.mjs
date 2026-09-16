import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'

import { chromium } from 'playwright-core'
import { PNG } from 'pngjs'

const manifestPath = process.env.PINBEAN_BATCH_MANIFEST
const outputRoot = process.env.PINBEAN_BATCH_OUTPUT
const targetUrl = process.env.PINBEAN_H5_URL ?? 'http://127.0.0.1:5174/'
const chromePath = process.env.CHROME_PATH
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

assert.ok(manifestPath, 'PINBEAN_BATCH_MANIFEST is required')
assert.ok(outputRoot, 'PINBEAN_BATCH_OUTPUT is required')

const imagePaths = readFileSync(manifestPath, 'utf8')
  .split(/\r?\n/u)
  .map(path => path.trim())
  .filter(Boolean)
assert.equal(imagePaths.length, 50, `batch manifest must contain exactly 50 images, got ${imagePaths.length}`)

const plainRoot = resolve(outputRoot, '纯图纸')
const legendRoot = resolve(outputRoot, '色卡图纸')
const reportPath = resolve(outputRoot, 'report-50.json')
mkdirSync(plainRoot, { recursive: true })
mkdirSync(legendRoot, { recursive: true })

function safeStem(index, imagePath) {
  const stem = basename(imagePath, extname(imagePath))
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .slice(0, 70)
  return `${String(index + 1).padStart(2, '0')}-${stem || 'image'}`
}

function pixelLuma(data, offset) {
  return 0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]
}

function pixelsDiffer(left, right, leftOffset, rightOffset) {
  return Math.abs(left[leftOffset] - right[rightOffset])
    + Math.abs(left[leftOffset + 1] - right[rightOffset + 1])
    + Math.abs(left[leftOffset + 2] - right[rightOffset + 2]) > 36
}

function analyzeGridTextDifference(plain, legend, gridWidth, gridHeight) {
  assert.equal(plain.width, legend.width, 'plain and legend widths differ')
  const cellSize = 24
  const gridStartX = Math.round((plain.width - gridWidth * cellSize) / 2)
  const gridStartY = 80 + cellSize
  let artifactCandidateCells = 0
  let intendedDarkCells = 0
  let labelChangedCells = 0
  let newDarkLabelPixels = 0
  let totalChangedPixels = 0
  let maxChangedRatio = 0

  for (let row = 0; row < gridHeight; row += 1) {
    for (let column = 0; column < gridWidth; column += 1) {
      let changed = 0
      let newDark = 0
      let plainLumaTotal = 0
      let samples = 0
      for (let y = 2; y < cellSize - 2; y += 1) {
        for (let x = 2; x < cellSize - 2; x += 1) {
          const px = gridStartX + column * cellSize + x
          const py = gridStartY + row * cellSize + y
          const plainOffset = (py * plain.width + px) * 4
          const legendOffset = (py * legend.width + px) * 4
          const plainLuma = pixelLuma(plain.data, plainOffset)
          const legendLuma = pixelLuma(legend.data, legendOffset)
          plainLumaTotal += plainLuma
          samples += 1
          if (pixelsDiffer(plain.data, legend.data, plainOffset, legendOffset)) {
            changed += 1
            if (legendLuma < 45 && plainLuma >= 75) newDark += 1
          }
        }
      }
      const changedRatio = changed / samples
      maxChangedRatio = Math.max(maxChangedRatio, changedRatio)
      totalChangedPixels += changed
      newDarkLabelPixels += newDark
      if (changed > 0) labelChangedCells += 1
      if (plainLumaTotal / samples < 45) intendedDarkCells += 1
      if (changedRatio > 0.5 || newDark / samples > 0.45) artifactCandidateCells += 1
    }
  }

  return {
    artifactCandidateCells,
    intendedDarkCells,
    labelChangedCells,
    maxChangedRatio: Number(maxChangedRatio.toFixed(4)),
    newDarkLabelPixels,
    totalChangedPixels,
  }
}

async function waitForGeneration(page) {
  await page.waitForFunction(() => {
    const button = document.querySelector('.primary-button')
    const status = document.querySelector('.status-pill')?.textContent ?? ''
    return !button?.hasAttribute('disabled') && !status.startsWith('正在')
  }, undefined, { timeout: 30_000 })
  return (await page.locator('.status-pill').textContent())?.trim() ?? ''
}

async function downloadExport(page, button, outputPath) {
  const startedAt = performance.now()
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    button.click(),
  ])
  await download.saveAs(outputPath)
  await page.locator('.status-pill').getByText('高清图纸已下载', { exact: true }).waitFor({ timeout: 30_000 })
  return Math.round(performance.now() - startedAt)
}

const browser = await chromium.launch({ executablePath: chromePath, headless: true })
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 430, height: 932 } })
const page = await context.newPage()
const report = {
  completedAt: null,
  imageCount: imagePaths.length,
  results: [],
  startedAt: new Date().toISOString(),
  targetUrl,
}

try {
  await page.goto(targetUrl, { waitUntil: 'networkidle' })
  for (const [index, imagePath] of imagePaths.entries()) {
    const errors = []
    const onPageError = error => errors.push(`pageerror: ${error.message}`)
    const onConsole = message => {
      if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
        errors.push(`console: ${message.text()}`)
      }
    }
    page.on('pageerror', onPageError)
    page.on('console', onConsole)
    const startedAt = performance.now()
    const result = { index: index + 1, input: imagePath, status: 'failed' }
    try {
      await page.evaluate(() => localStorage.clear())
      await page.reload({ waitUntil: 'networkidle' })
      const chooseButton = page.getByText('选择图片并生成', { exact: true })
      await chooseButton.waitFor({ timeout: 15_000 })
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        chooseButton.click(),
      ])
      await chooser.setFiles(imagePath)
      const generationStatus = await waitForGeneration(page)
      const summary = (await page.locator('.result-summary').textContent())?.trim() ?? ''
      const match = summary.match(/^(\d+)\s*×\s*(\d+)\s*·\s*(\d+)\s*颗$/u)
      if (!match) throw new Error(`generation did not produce a result: ${generationStatus}`)
      const sourceDescription = (await page.locator('.source-copy .muted').textContent())?.trim() ?? ''
      const statusMatch = generationStatus.match(/^(\d+)\s*×\s*(\d+)\s*·\s*(\d+)\s*颗\s*·\s*(\d+)\s*色$/u)
      if (!statusMatch) throw new Error(`unexpected generation status: ${generationStatus}`)
      const gridWidth = Number(match[1])
      const gridHeight = Number(match[2])
      const stem = safeStem(index, imagePath)
      const plainPath = resolve(plainRoot, `${stem}.png`)
      const legendPath = resolve(legendRoot, `${stem}.png`)
      const exportActions = page.locator('.export-action')
      assert.equal(await exportActions.count(), 3)
      const legendExportMs = await downloadExport(page, exportActions.nth(1), legendPath)
      const plainExportMs = await downloadExport(page, exportActions.nth(0), plainPath)
      const plainPng = PNG.sync.read(readFileSync(plainPath))
      const legendPng = PNG.sync.read(readFileSync(legendPath))
      const textDifference = analyzeGridTextDifference(plainPng, legendPng, gridWidth, gridHeight)
      assert.equal(textDifference.artifactCandidateCells, 0, 'legend contains block-sized differences from plain export')
      Object.assign(result, {
        beadCount: Number(match[3]),
        colorCount: Number(statusMatch[4]),
        errors,
        export: {
          legend: { height: legendPng.height, ms: legendExportMs, path: legendPath, width: legendPng.width },
          plain: { height: plainPng.height, ms: plainExportMs, path: plainPath, width: plainPng.width },
        },
        generationMs: Math.round(performance.now() - startedAt - legendExportMs - plainExportMs),
        grid: { height: gridHeight, width: gridWidth },
        sourceDescription,
        textDifference,
      })
      if (errors.length > 0) throw new Error(errors.join('\n'))
      result.status = 'passed'
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error)
      result.errors = errors
    } finally {
      page.off('pageerror', onPageError)
      page.off('console', onConsole)
      result.totalMs = Math.round(performance.now() - startedAt)
      report.results.push(result)
      writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
      const marker = result.status === 'passed' ? 'PASS' : 'FAIL'
      process.stdout.write(`[${String(index + 1).padStart(2, '0')}/50] ${marker} ${basename(imagePath)} ${result.totalMs}ms${result.error ? ` — ${result.error}` : ''}\n`)
    }
  }
  report.completedAt = new Date().toISOString()
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
} finally {
  await browser.close()
}

const passed = report.results.filter(result => result.status === 'passed').length
const failed = report.results.length - passed
process.stdout.write(`${JSON.stringify({ failed, passed, reportPath, total: report.results.length })}\n`)
if (failed > 0) process.exitCode = 1
