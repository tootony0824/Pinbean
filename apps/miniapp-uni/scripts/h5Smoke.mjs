import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { getSupplierPalette } from '@pinbean/palette-data'
import { chromium } from 'playwright-core'
import { PNG } from 'pngjs'

const executableNames = process.platform === 'win32'
  ? ['chrome.exe', 'chromium.exe']
  : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
const chromeCandidates = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  join(homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
  ...['PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'].flatMap(key =>
    process.env[key] ? [join(process.env[key], 'Google/Chrome/Application/chrome.exe')] : []),
  ...['/usr/bin', '/opt/google/chrome', ...(process.env.PATH ?? '').split(delimiter)]
    .filter(Boolean).flatMap(dir => executableNames.map(name => join(dir, name))),
  chromium.executablePath(),
]
const chromePath = process.env.CHROME_PATH ?? chromeCandidates.find(existsSync)
const imagePath = resolve(
  process.env.PINBEAN_SMOKE_IMAGE
    ?? fileURLToPath(new URL('../../web/tests/fixtures/real-images/cartoon.png', import.meta.url)),
)
const targetUrl = process.env.PINBEAN_H5_URL ?? 'http://127.0.0.1:5174/'
const screenshotPath = process.env.PINBEAN_SMOKE_SCREENSHOT
const exportArtifactPath = process.env.PINBEAN_SMOKE_EXPORT_PATH
const materialArtifactPath = process.env.PINBEAN_SMOKE_MATERIAL_PATH
const plainArtifactPath = process.env.PINBEAN_SMOKE_PLAIN_PATH
const boardArtifactPath = process.env.PINBEAN_SMOKE_BOARD_PATH
const boardAtlasArtifactPath = process.env.PINBEAN_SMOKE_BOARD_ATLAS_PATH
const projectArtifactPath = process.env.PINBEAN_SMOKE_PROJECT_PATH
const coverArtifactPath = process.env.PINBEAN_SMOKE_COVER_PATH
const smokeMode = process.env.PINBEAN_SMOKE_MODE ?? 'cartoon'
const smokeEdit = process.env.PINBEAN_SMOKE_EDIT === '1'
const smokeExport = process.env.PINBEAN_SMOKE_EXPORT === '1'
const smokePersist = process.env.PINBEAN_SMOKE_PERSIST === '1'
const smokeProject = process.env.PINBEAN_SMOKE_PROJECT === '1'
const smokeProgress = process.env.PINBEAN_SMOKE_PROGRESS === '1'
const smokePublish = process.env.PINBEAN_SMOKE_PUBLISH === '1'
const smokeHistory = process.env.PINBEAN_SMOKE_HISTORY === '1'
const smokeReview = process.env.PINBEAN_SMOKE_REVIEW === '1'
const smokeColorSystem = process.env.PINBEAN_SMOKE_COLOR_SYSTEM ?? 'MARD'

assert.ok(['cartoon', 'realistic'].includes(smokeMode), `unsupported smoke mode: ${smokeMode}`)
assert.ok(
  ['MARD', 'COCO', '漫漫', '盼盼', '咪小窝'].includes(smokeColorSystem),
  `unsupported smoke color system: ${smokeColorSystem}`,
)

assert.ok(chromePath && existsSync(chromePath), 'Chrome not found; set CHROME_PATH to an executable or install Playwright Chromium')
assert.ok(existsSync(imagePath), `smoke image not found: ${imagePath}`)

const browser = await chromium.launch({ executablePath: chromePath, headless: true })
const context = await browser.newContext({ viewport: { width: 430, height: 932 } })
if (smokeExport || smokeProgress || smokePublish || smokeHistory || smokeReview) {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(targetUrl).origin })
}
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', error => pageErrors.push(error.message))
page.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
    pageErrors.push(message.text())
  }
})

try {
  await page.goto(targetUrl, { waitUntil: 'networkidle' })
  await page.getByText('选择图片并生成', { exact: true }).waitFor()
  if (smokeColorSystem !== 'MARD') {
    await page.locator('.color-system-option').filter({ hasText: smokeColorSystem }).click()
    await page.getByText(`已选择 ${smokeColorSystem} 色板`, { exact: true }).waitFor()
  }
  if (smokeMode === 'realistic') {
    await page.getByText('细腻模式', { exact: true }).first().click()
  }
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByText('选择图片并生成', { exact: true }).click(),
  ])
  await chooser.setFiles(imagePath)
  await page.locator('.result-card').waitFor({ timeout: 30_000 })
  await page.getByText(/\d+ × \d+ · \d+ 颗/).first().waitFor({ timeout: 30_000 })

  let editing
  if (smokeEdit) {
    const summary = page.locator('.result-summary')
    const status = page.locator('.status-pill')
    const totalFromSummary = async () => {
      const text = await summary.textContent()
      const match = text?.match(/·\s*(\d+)\s*颗/)
      assert.ok(match, `cannot parse bead total from: ${text}`)
      return Number(match[1])
    }
    const waitForEditStatus = async label => {
      await page.waitForFunction(
        prefix => document.querySelector('.status-pill')?.textContent?.startsWith(`${prefix}已修改 `),
        label,
        { timeout: 5_000 },
      )
      const text = await status.textContent()
      const match = text?.match(/已修改\s+(\d+)\s+格/)
      assert.ok(match, `cannot parse edit count from: ${text}`)
      return Number(match[1])
    }
    const undoAndWait = async changed => {
      await page.getByText('撤销', { exact: true }).click()
      await page.getByText(`已撤销 ${changed} 格`, { exact: true }).waitFor()
    }
    const clickPattern = async () => {
      await page.locator('.edit-hit-layer').click({ position: { x: 4, y: 4 } })
    }

    const generatedTotal = await totalFromSummary()
    await page.getByText('编辑图纸', { exact: true }).click()
    await page.getByText(`从 ${smokeColorSystem} 完整色板选色`, { exact: true }).click()
    const fullPaletteColors = await page.locator('.edit-palette-color').count()
    assert.equal(fullPaletteColors, 291)
    const addedColor = page.locator('.edit-palette-color').last()
    const addedColorLabel = await addedColor.getAttribute('aria-label')
    await addedColor.click()
    await page.getByText(/画笔颜色 · /, { exact: false }).waitFor()
    assert.ok(await addedColor.evaluate(element => element.classList.contains('selected')))
    await page.getByText('收起完整色板', { exact: true }).click()
    await page.getByText('橡皮', { exact: true }).click()
    await clickPattern()
    try {
      await page.waitForFunction(
        expected => document.querySelector('.result-summary')?.textContent?.includes(`· ${expected} 颗`),
        generatedTotal - 1,
        { timeout: 5_000 },
      )
    } catch (error) {
      const editStatus = await page.locator('.status-pill').textContent()
      const hitLayer = await page.locator('.edit-hit-layer').evaluate(element => {
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        const top = document.elementFromPoint(rect.left + 4, rect.top + 4)
        return {
          className: element.className,
          height: rect.height,
          pointerEvents: style.pointerEvents,
          topClassName: top?.className,
          topTagName: top?.tagName,
          width: rect.width,
          zIndex: style.zIndex,
        }
      })
      throw new Error(
        `Canvas edit did not change bead total; status=${editStatus}; hitLayer=${JSON.stringify(hitLayer)}`,
        { cause: error },
      )
    }
    const erasedTotal = await totalFromSummary()
    await page.getByText('橡皮已修改 1 格', { exact: true }).waitFor()
    await page.getByText('撤销', { exact: true }).click()
    await page.waitForFunction(
      expected => document.querySelector('.result-summary')?.textContent?.includes(`· ${expected} 颗`),
      generatedTotal,
    )
    const undoTotal = await totalFromSummary()
    await page.getByText('已撤销 1 格', { exact: true }).waitFor()
    await page.getByText('重做', { exact: true }).click()
    await page.waitForFunction(
      expected => document.querySelector('.result-summary')?.textContent?.includes(`· ${expected} 颗`),
      erasedTotal,
    )
    const redoTotal = await totalFromSummary()
    await page.getByText('已重做 1 格', { exact: true }).waitFor()
    await undoAndWait(1)

    const colorChips = page.locator('.color-chip')
    assert.ok(await colorChips.count() > 1, 'editing smoke requires at least two generated colors')
    const targetColorCode = await colorChips.nth(1).locator('.color-code').textContent()
    await colorChips.nth(1).click()
    await page.getByText('画笔', { exact: true }).click()
    await clickPattern()
    const painted = await waitForEditStatus('画笔')
    await undoAndWait(painted)

    await page.getByText('填充', { exact: true }).click()
    await clickPattern()
    const filled = await waitForEditStatus('填充')
    await undoAndWait(filled)

    await page.getByText('整色替换', { exact: true }).click()
    await clickPattern()
    const replaced = await waitForEditStatus('整色替换')
    await undoAndWait(replaced)

    await page.getByText('去背景', { exact: true }).click()
    await page.waitForFunction(
      () => document.querySelector('.status-pill')?.textContent?.startsWith('已去背景 '),
      undefined,
      { timeout: 5_000 },
    )
    const backgroundStatus = await status.textContent()
    const backgroundMatch = backgroundStatus?.match(/已去背景\s+(\d+)\s+格/)
    assert.ok(backgroundMatch, `cannot parse background removal count from: ${backgroundStatus}`)
    const backgroundRemoved = Number(backgroundMatch[1])
    assert.ok(backgroundRemoved > 1, `background removal changed too few cells: ${backgroundRemoved}`)
    assert.equal(await totalFromSummary(), generatedTotal - backgroundRemoved)
    await undoAndWait(backgroundRemoved)

    editing = {
      backgroundRemoved,
      addedColorLabel,
      erasedTotal,
      filled,
      fullPaletteColors,
      generatedTotal,
      painted,
      redoTotal,
      replaced,
      restoredTotal: await totalFromSummary(),
      targetColorCode,
      undoTotal,
    }
    assert.deepEqual({ erasedTotal, generatedTotal, redoTotal, undoTotal }, {
      erasedTotal: generatedTotal - 1,
      generatedTotal,
      redoTotal: generatedTotal - 1,
      undoTotal: generatedTotal,
    })
    assert.equal(painted, 1)
    assert.ok(filled > 1, `fill changed too few cells: ${filled}`)
    assert.ok(replaced > 1, `replace changed too few cells: ${replaced}`)
    assert.equal(editing.restoredTotal, generatedTotal)
  }

  let projectHistory
  if (smokeHistory) {
    const nameInput = page.locator('.project-name-input input')
    await nameInput.fill('强哥的测试拼豆')
    await page.locator('.project-name-save').click()
    await page.locator('.status-pill').getByText('作品名称已保存', { exact: true }).waitFor()
    assert.equal(await page.locator('.recent-project-record').count(), 1)
    assert.equal(await page.locator('.recent-project-name').textContent(), '强哥的测试拼豆')
    await page.locator('.recent-project-copy-button').click()
    await page.locator('.status-pill').getByText('作品摘要已复制', { exact: true }).waitFor()
    const summaryText = await page.evaluate(() => navigator.clipboard.readText())
    assert.match(summaryText, /PinBean 最近制作｜强哥的测试拼豆/)
    assert.match(summaryText, /50×50｜2500 颗｜2 色｜舒适可做/)
    projectHistory = {
      count: 1,
      name: '强哥的测试拼豆',
      summaryFirstLine: summaryText.split('\n')[0],
    }
  }

  let persistence
  if (smokePersist) {
    const summaryBeforeReload = await page.locator('.result-summary').textContent()
    const totalMatch = summaryBeforeReload?.match(/·\s*(\d+)\s*颗/)
    assert.ok(totalMatch, `cannot parse persisted bead total from: ${summaryBeforeReload}`)
    const expectedTotal = Number(totalMatch[1])

    await page.reload({ waitUntil: 'networkidle' })
    const restoreButton = page.getByText(/继续上次图纸/).first()
    await restoreButton.waitFor({ timeout: 10_000 })
    const restoreLabel = await restoreButton.textContent()
    await restoreButton.click()
    await page.locator('.result-card').waitFor({ timeout: 10_000 })
    await page.waitForFunction(
      expected => document.querySelector('.result-summary')?.textContent?.includes(`· ${expected} 颗`),
      expectedTotal,
      { timeout: 10_000 },
    )
    await page.getByText(new RegExp(`已恢复 \\d+ × \\d+ · ${expectedTotal} 颗`)).waitFor()
    const restoredSummary = await page.locator('.result-summary').textContent()
    if (smokeHistory) {
      assert.equal(await page.locator('.project-name-input input').inputValue(), '强哥的测试拼豆')
      assert.equal(await page.locator('.recent-project-record').count(), 1)
    }
    persistence = { expectedTotal, restoreLabel, restoredSummary }
  }

  let assessment
  let progress
  if (smokeProgress) {
    const assessmentMetrics = await page.locator('.assessment-metric-value').allTextContents()
    assert.deepEqual(assessmentMetrics, ['50×50', '2500 颗', '2 色', '约 4-7 小时'])
    assert.equal(await page.locator('.assessment-level').textContent(), '舒适可做')
    assert.deepEqual(await page.locator('.work-step-title').allTextContents(), [
      '先拼大色块',
      '按分板推进',
      '最后补细节',
    ])
    await page.locator('.assessment-copy-button').first().click()
    await page.locator('.status-pill').getByText('制作计划已复制', { exact: true }).waitFor()
    const planText = await page.evaluate(() => navigator.clipboard.readText())
    assert.match(planText, /PinBean 制作计划/)
    assert.match(planText, /难度：舒适可做｜粗略摆豆时间：约 4-7 小时/)
    assert.match(planText, /1\. 先拼大色块/)
    assert.match(planText, /2\. 按分板推进/)

    const firstColorToggle = page.locator('.color-progress-toggle').first()
    await firstColorToggle.click()
    await page.locator('.status-pill').getByText(/制作进度 1\/\d+ 色 · \d+%/).waitFor()
    const colorProgressText = await page.locator('.progress-text').textContent()
    assert.match(colorProgressText ?? '', /制作进度：1\/\d+ 色/)
    assert.equal(await firstColorToggle.textContent(), '完成')

    const firstBoard = page.locator('.board-piece').first()
    await firstBoard.click()
    await page.locator('.status-pill').getByText('分板进度 1/4 · 25%', { exact: true }).waitFor()
    assert.ok(await firstBoard.evaluate(element => element.classList.contains('completed')))
    await page.getByText('只导出未完成分板（3 张）', { exact: true }).waitFor()

    await page.locator('.assessment-copy-button.progress').click()
    await page.locator('.status-pill').getByText('制作进度文案已复制', { exact: true }).waitFor()
    const progressText = await page.evaluate(() => navigator.clipboard.readText())
    assert.match(progressText, /^拼豆制作进度/)
    assert.match(progressText, /2314\/2500 颗｜93%/)
    assert.match(progressText, /1\/4 板｜25%/)

    await page.reload({ waitUntil: 'networkidle' })
    const restoreButton = page.getByText(/继续上次图纸/).first()
    await restoreButton.waitFor({ timeout: 10_000 })
    await restoreButton.click()
    await page.locator('.result-card').waitFor({ timeout: 10_000 })
    assert.equal(await page.locator('.color-progress-toggle').first().textContent(), '完成')
    assert.ok(await page.locator('.board-piece').first().evaluate(element => element.classList.contains('completed')))
    await page.getByText('只导出未完成分板（3 张）', { exact: true }).waitFor()
    progress = {
      colorProgressText: (await page.locator('.progress-text').textContent())?.replace(/\s+/g, ' ').trim(),
      completedBoards: 1,
      pendingBoards: 3,
      restored: true,
    }
    assessment = {
      level: '舒适可做',
      metrics: assessmentMetrics,
      planFirstLine: planText.split('\n')[0],
      progressFirstLine: progressText.split('\n')[0],
    }
  }

  let publishing
  if (smokePublish) {
    assert.equal(await page.locator('.publishing-project-type').textContent(), '礼物')
    await page.getByText('制作教程', { exact: true }).last().click()
    await page.locator('.publishing-action.primary').click()
    await page.locator('.status-pill').getByText('发布文案已复制', { exact: true }).waitFor()
    const postText = await page.evaluate(() => navigator.clipboard.readText())
    assert.match(postText, /这张拼豆图纸参数：50×50，2500 颗，2 色/)
    assert.match(postText, /我的制作顺序/)
    assert.match(postText, /1\. 先拼大色块/)

    await page.locator('.publishing-action').nth(1).click()
    await page.locator('.status-pill').getByText('发布包已复制', { exact: true }).waitFor()
    const kitText = await page.evaluate(() => navigator.clipboard.readText())
    assert.match(kitText, /标题：/)
    assert.doesNotMatch(kitText.split('\n')[0] ?? '', /拼豆拼豆/)
    assert.match(kitText, /首图建议：.*亲手制作、适合送人/)
    assert.match(kitText, /发布前检查/)
    if (smokeProgress) {
      assert.match(kitText, /当前进度：1\/2 色 · 2314\/2500 颗 · 93%/)
      assert.match(kitText, /分板进度：1\/4 板 · 25%/)
    }
    const [coverDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 20_000 }),
      page.locator('.publishing-action.cover').click(),
    ])
    await page.locator('.status-pill').getByText('发布封面已下载', { exact: true }).waitFor({ timeout: 20_000 })
    const coverPath = await coverDownload.path()
    assert.ok(coverPath, 'share cover PNG has no local path')
    if (coverArtifactPath) await coverDownload.saveAs(coverArtifactPath)
    const coverPng = PNG.sync.read(readFileSync(coverPath))
    assert.deepEqual({ width: coverPng.width, height: coverPng.height }, { width: 1080, height: 1440 })
    publishing = {
      cover: {
        height: coverPng.height,
        suggestedFilename: coverDownload.suggestedFilename(),
        width: coverPng.width,
      },
      kitFirstLine: kitText.split('\n')[0],
      postFirstLine: postText.split('\n')[0],
      projectType: '礼物',
      tone: '制作教程',
    }
  }

  let publishReview
  if (smokeReview) {
    await page.locator('.publish-review-topic input').fill('礼物拼豆制作教程')
    await page.locator('.publish-review-likes input').fill('126')
    await page.locator('.publish-review-favorites input').fill('48')
    await page.locator('.publish-review-comments input').fill('12')
    await page.locator('.publish-review-conversions input').fill('3')
    await page.locator('.publish-review-note input').fill('收藏表现最好，下次继续做教程')
    await page.locator('.publish-review-save').click()
    await page.locator('.status-pill').getByText('发布复盘已保存', { exact: true }).waitFor()
    assert.equal(await page.locator('.recent-project-record').count(), 1)
    assert.equal(
      await page.locator('.recent-project-review').textContent(),
      '赞 126 · 藏 48 · 评 12 · 转化 3',
    )
    await page.locator('.publish-review-copy').click()
    await page.locator('.status-pill').getByText('发布复盘摘要已复制', { exact: true }).waitFor()
    const reviewText = await page.evaluate(() => navigator.clipboard.readText())
    assert.match(reviewText, /主题：礼物拼豆制作教程/)
    assert.match(reviewText, /互动数据：赞 126 · 藏 48 · 评 12 · 转化 3/)
    assert.match(reviewText, /复盘备注：收藏表现最好，下次继续做教程/)

    await page.reload({ waitUntil: 'networkidle' })
    const restoreButton = page.getByText(/继续上次图纸/).first()
    await restoreButton.waitFor({ timeout: 10_000 })
    await restoreButton.click()
    await page.locator('.result-card').waitFor({ timeout: 10_000 })
    assert.equal(await page.locator('.publish-review-topic input').inputValue(), '礼物拼豆制作教程')
    assert.equal(await page.locator('.publish-review-likes input').inputValue(), '126')
    assert.equal(await page.locator('.publish-review-favorites input').inputValue(), '48')
    assert.equal(await page.locator('.publish-review-comments input').inputValue(), '12')
    assert.equal(await page.locator('.publish-review-conversions input').inputValue(), '3')
    assert.equal(await page.locator('.recent-project-record').count(), 1)
    publishReview = {
      metrics: '赞 126 · 藏 48 · 评 12 · 转化 3',
      restored: true,
      summaryFirstLine: reviewText.split('\n')[0],
      topic: '礼物拼豆制作教程',
    }
  }

  let projectFile
  if (smokeProject) {
    const exportProjectButton = page.locator('.project-file-button.export')
    await page.waitForFunction(
      () => !document.querySelector('.project-file-button.export')?.hasAttribute('disabled'),
      undefined,
      { timeout: 10_000 },
    )
    const [projectDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 20_000 }),
      exportProjectButton.click(),
    ])
    await page.locator('.status-pill').getByText('项目文件已下载', { exact: true }).waitFor()
    const projectPath = await projectDownload.path()
    assert.ok(projectPath, 'project file has no local path')
    if (projectArtifactPath) await projectDownload.saveAs(projectArtifactPath)
    const projectText = readFileSync(projectPath, 'utf8')
    const projectJson = JSON.parse(projectText)
    assert.equal(projectJson.formatVersion, 2)
    assert.deepEqual(
      projectJson.selectedColorIds,
      getSupplierPalette(smokeColorSystem).colors.map(color => color.id),
      'export must preserve the complete ordered generation selection, including unused colors',
    )
    assert.equal(projectJson.colorSystem, smokeColorSystem)
    assert.equal(projectJson.project.schemaVersion, 1)
    assert.equal(projectJson.project.grid.width, 50)
    assert.equal(projectJson.project.grid.height, 50)
    assert.equal(projectJson.project.grid.cells.length, 2500)
    assert.ok(projectJson.project.paletteTable.length > 1)
    assert.equal(projectJson.project.generation.config.paletteId, projectJson.project.paletteId)
    assert.equal(projectJson.project.generation.config.mode, smokeMode)
    assert.deepEqual(projectJson.workflow, { formatVersion: 1, projectType: 'gift' })
    if (smokeReview) {
      assert.equal(projectJson.publishReview.formatVersion, 1)
      assert.equal(projectJson.publishReview.topic, '礼物拼豆制作教程')
      assert.deepEqual({
        comments: projectJson.publishReview.comments,
        conversions: projectJson.publishReview.conversions,
        favorites: projectJson.publishReview.favorites,
        likes: projectJson.publishReview.likes,
      }, { comments: 12, conversions: 3, favorites: 48, likes: 126 })
    }
    if (smokeProgress) {
      assert.equal(projectJson.progress.formatVersion, 2)
      assert.equal(projectJson.progress.completedColorIds.length, 1)
      assert.deepEqual(projectJson.progress.completedBoardIds, ['1-1'])
    }
    if (smokeReview) {
      assert.equal(await page.locator('.publish-review-topic input').inputValue(), '礼物拼豆制作教程')
      assert.equal(await page.locator('.publish-review-likes input').inputValue(), '126')
    }

    const importButton = page.locator('.project-file-button.import')
    const [invalidChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      importButton.click(),
    ])
    await invalidChooser.setFiles({
      name: 'broken.pinbean.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{'),
    })
    await page.locator('.status-pill').getByText('项目文件不是有效的 JSON', { exact: true }).waitFor()
    assert.equal(await page.locator('.result-summary').textContent(), '50 × 50 · 2500 颗')

    const [validChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      importButton.click(),
    ])
    await validChooser.setFiles(projectPath)
    await page.locator('.status-pill').getByText(/已导入 .* · 50 × 50 · 2500 颗/).waitFor({ timeout: 10_000 })
    assert.equal(await page.locator('.result-summary').textContent(), '50 × 50 · 2500 颗')
    assert.ok(await page.locator('.canvas-frame').isVisible())
    if (smokeProgress) {
      assert.equal(await page.locator('.color-progress-toggle').first().textContent(), '完成')
      assert.ok(await page.locator('.board-piece').first().evaluate(element => element.classList.contains('completed')))
    }
    projectFile = {
      cellCount: projectJson.project.grid.cells.length,
      colorCount: projectJson.project.paletteTable.length - 1,
      formatVersion: projectJson.formatVersion,
      suggestedFilename: projectDownload.suggestedFilename(),
    }
  }

  let exported
  if (smokeExport) {
    await page.waitForFunction(
      () => !document.querySelector('.export-action')?.hasAttribute('disabled'),
      undefined,
      { timeout: 10_000 },
    )
    const clickAndWaitDownload = async (button, buttonName) => {
      try {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 20_000 }),
          button.click(),
        ])
        return download
      } catch (error) {
        const status = await page.locator('.status-pill').textContent()
        throw new Error(`download did not start for ${buttonName}; status=${status}`, { cause: error })
      }
    }
    const exportButtons = page.locator('.export-action')

    await page.getByText('详细设置', { exact: true }).click()
    await page.locator('.settings-modal').waitFor()
    const coordinateSetting = page.locator('.setting-row').filter({ hasText: '显示坐标数字' })
    await coordinateSetting.locator('uni-switch').click()
    await page.locator('.grid-color').nth(4).click()
    await page.getByText('保存设置', { exact: true }).click()
    await page.getByText('导出设置已保存', { exact: true }).waitFor()
    await page.getByText('详细设置', { exact: true }).click()
    await page.locator('.settings-modal').waitFor()
    assert.equal(
      await page.locator('.setting-row').filter({ hasText: '显示坐标数字' }).locator('.uni-switch-input-checked').count(),
      0,
      'coordinate setting did not stay disabled',
    )
    assert.equal(await page.locator('.grid-color.selected').getAttribute('aria-label'), '紫色')
    await page.getByText('取消', { exact: true }).click()

    const legendDownload = await clickAndWaitDownload(exportButtons.nth(1), '色卡图纸')
    await page.locator('.status-pill').getByText('高清图纸已下载', { exact: true }).waitFor({ timeout: 20_000 })
    const legendPath = await legendDownload.path()
    assert.ok(legendPath, 'legend PNG has no local path')
    if (exportArtifactPath) await legendDownload.saveAs(exportArtifactPath)
    const legendPng = PNG.sync.read(readFileSync(legendPath))
    assert.ok(legendPng.width > 1000, `legend PNG is too narrow: ${legendPng.width}`)
    assert.ok(legendPng.height > 1000, `legend PNG is too short: ${legendPng.height}`)

    await page.locator('.export-mode').nth(1).click()
    const plainDownload = await clickAndWaitDownload(exportButtons.nth(0), '保存图纸')
    await page.locator('.status-pill').getByText('高清图纸已下载', { exact: true }).waitFor({ timeout: 20_000 })
    const plainPath = await plainDownload.path()
    assert.ok(plainPath, 'plain PNG has no local path')
    if (plainArtifactPath) await plainDownload.saveAs(plainArtifactPath)
    const plainPng = PNG.sync.read(readFileSync(plainPath))
    assert.equal(plainPng.width, legendPng.width)
    assert.ok(plainPng.height < legendPng.height, 'plain PNG should omit the legend footer')

    const materialDownload = await clickAndWaitDownload(exportButtons.nth(2), '备料清单')
    await page.locator('.status-pill').getByText('备料清单已下载', { exact: true }).waitFor({ timeout: 20_000 })
    const materialPath = await materialDownload.path()
    assert.ok(materialPath, 'material-list PNG has no local path')
    if (materialArtifactPath) await materialDownload.saveAs(materialArtifactPath)
    const materialPng = PNG.sync.read(readFileSync(materialPath))
    assert.equal(materialPng.width, 900)
    assert.ok(materialPng.height > 200)

    await page.locator('.stats-copy-button').click()
    await page.locator('.status-pill').getByText('备料清单已复制', { exact: true }).waitFor({ timeout: 10_000 })
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
    assert.match(clipboardText, /PinBean 备料清单/)
    assert.match(clipboardText, new RegExp(`${smokeColorSystem} 色板`))
    assert.match(clipboardText, /实际 \d+ 颗｜建议备料 \d+ 颗/)
    if (smokeProgress) {
      assert.match(clipboardText, /已完成/)
      assert.match(clipboardText, /待拼/)
    }

    const boardButtons = page.locator('.board-action')
    const boardCount = await page.locator('.board-piece').count()
    assert.equal(boardCount, 4, '50×50 smoke pattern should use four 29×29 boards')
    let pendingBoardPngs
    if (smokeProgress) {
      const pendingDownloads = []
      const collectPendingDownload = download => pendingDownloads.push(download)
      page.on('download', collectPendingDownload)
      await page.locator('.pending-board-button').click()
      await page.locator('.status-pill').getByText('3 张未完成分板已导出', { exact: true }).waitFor({ timeout: 30_000 })
      page.off('download', collectPendingDownload)
      assert.equal(pendingDownloads.length, 3)
      pendingBoardPngs = pendingDownloads.map(download => download.suggestedFilename())
      assert.ok(pendingBoardPngs.every(name => !name.includes('第 1 板')))
      assert.equal(new Set(pendingBoardPngs).size, 3, 'pending board filenames must be distinct')
      for (const download of pendingDownloads) {
        const path = await download.path()
        assert.ok(path, 'pending board PNG has no local path')
        const png = PNG.sync.read(readFileSync(path))
        assert.ok(png.width >= 600 && png.width <= 900, 'invalid pending board width')
        assert.ok(png.height >= 800 && png.height <= 1100, 'invalid pending board height')
      }
    }
    const boardDownloads = []
    const collectBoardDownload = download => boardDownloads.push(download)
    page.on('download', collectBoardDownload)
    await boardButtons.nth(0).click()
    await page.locator('.status-pill').getByText(`${boardCount} 张分板图纸已导出`, { exact: true }).waitFor({ timeout: 30_000 })
    page.off('download', collectBoardDownload)
    assert.equal(boardDownloads.length, boardCount, 'each board should trigger one PNG download')
    const boardPngs = []
    for (const [index, download] of boardDownloads.entries()) {
      const path = await download.path()
      assert.ok(path, `board ${index + 1} PNG has no local path`)
      if (index === 0 && boardArtifactPath) await download.saveAs(boardArtifactPath)
      const png = PNG.sync.read(readFileSync(path))
      assert.ok(png.width >= 600 && png.width <= 900, `board ${index + 1} width is invalid: ${png.width}`)
      assert.ok(png.height >= 800 && png.height <= 1100, `board ${index + 1} height is invalid: ${png.height}`)
      boardPngs.push({
        height: png.height,
        suggestedFilename: download.suggestedFilename(),
        width: png.width,
      })
    }

    const atlasDownload = await clickAndWaitDownload(boardButtons.nth(1), '分板合集')
    await page.locator('.status-pill').getByText('分板合集已下载', { exact: true }).waitFor({ timeout: 20_000 })
    const atlasPath = await atlasDownload.path()
    assert.ok(atlasPath, 'board atlas PNG has no local path')
    if (boardAtlasArtifactPath) await atlasDownload.saveAs(boardAtlasArtifactPath)
    const atlasPng = PNG.sync.read(readFileSync(atlasPath))
    assert.equal(atlasPng.width, 1200)
    assert.ok(atlasPng.height > 1000)

    exported = {
      atlas: {
        height: atlasPng.height,
        suggestedFilename: atlasDownload.suggestedFilename(),
        width: atlasPng.width,
      },
      boards: boardPngs,
      pendingBoards: pendingBoardPngs,
      clipboardFirstLine: clipboardText.split('\n')[0],
      detailedSettings: { coordinates: false, gridLineColor: '紫色' },
      legend: {
        height: legendPng.height,
        suggestedFilename: legendDownload.suggestedFilename(),
        width: legendPng.width,
      },
      material: {
        height: materialPng.height,
        suggestedFilename: materialDownload.suggestedFilename(),
        width: materialPng.width,
      },
      plain: {
        height: plainPng.height,
        suggestedFilename: plainDownload.suggestedFilename(),
        width: plainPng.width,
      },
    }
  }

  const canvasScreenshot = await page.locator('.canvas-frame').screenshot()
  const decodedScreenshot = PNG.sync.read(canvasScreenshot)
  let visibleDarkPixels = 0
  for (let offset = 0; offset < decodedScreenshot.data.length; offset += 4) {
    const red = decodedScreenshot.data[offset] ?? 255
    const green = decodedScreenshot.data[offset + 1] ?? 255
    const blue = decodedScreenshot.data[offset + 2] ?? 255
    const alpha = decodedScreenshot.data[offset + 3] ?? 0
    if (alpha > 0 && red < 100 && green < 100 && blue < 100) visibleDarkPixels += 1
  }
  const result = {
    height: decodedScreenshot.height,
    visibleDarkPixels,
    width: decodedScreenshot.width,
  }

  if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: true })
  process.stdout.write(`${JSON.stringify({ assessment, editing, exported, imagePath, pageErrors, persistence, progress, projectFile, projectHistory, publishReview, publishing, result, smokeColorSystem, smokeMode, targetUrl })}\n`)
  assert.ok(result.width > 1 && result.height > 1, 'pattern canvas has invalid dimensions')
  assert.ok(result.visibleDarkPixels > 100, 'visible pattern contains no dark bead pixels')
  assert.deepEqual(pageErrors, [], `browser errors: ${pageErrors.join(' | ')}`)
} finally {
  await browser.close()
}
