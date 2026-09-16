import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import automator from 'miniprogram-automator'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '../../..')
const cliPath = process.env.WECHAT_DEVTOOLS_CLI
  ?? '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
const projectPath = process.env.PINBEAN_WECHAT_PROJECT ?? repositoryRoot
const screenshotPath = process.env.PINBEAN_WECHAT_SCREENSHOT
const imagePath = process.env.PINBEAN_WECHAT_IMAGE
  ?? resolve(repositoryRoot, 'apps/web/tests/fixtures/real-images/line-art.png')

const exceptions = []
const consoleErrors = []
const consoleMessages = []
const simulatorLimitations = []
let miniProgram

try {
  miniProgram = await automator.launch({
    cliPath,
    projectPath,
    ...(projectPath === repositoryRoot ? {} : {
      projectConfig: { libVersion: '3.15.2', setting: { es6: false, minified: false } },
    }),
    timeout: 60_000,
    trustProject: true,
  })
  miniProgram.on('exception', exception => exceptions.push(exception))
  miniProgram.on('console', message => {
    consoleMessages.push(message)
    if (message?.type === 'error') consoleErrors.push(message)
  })

  const page = await miniProgram.reLaunch('/pages/index/index')
  assert.ok(page, '微信模拟器没有打开首页')
  await page.waitFor(1500)

  const pageElement = await page.$('page')
  assert.ok(pageElement, '微信模拟器没有渲染 page 根节点')
  const wxml = await pageElement.outerWxml()
  const size = await page.size()

  assert.match(wxml, /选择图片并生成/)
  assert.match(wxml, /MARD/)
  assert.match(wxml, /COCO/)

  const colorSystems = await page.$$('.color-system-option')
  assert.equal(colorSystems.length, 5)
  await colorSystems[1].tap()
  await page.waitFor(200)
  assert.match(await colorSystems[1].attribute('class'), /active/)

  const imageBase64 = readFileSync(imagePath, 'base64')
  const simulatorImagePath = await miniProgram.evaluate(function writeFixtureImage(base64) {
    const path = `${wx.env.USER_DATA_PATH}/pinbean-wechat-smoke.png`
    wx.getFileSystemManager().writeFileSync(path, base64, 'base64')
    return path
  }, imageBase64)
  await miniProgram.mockWxMethod('chooseMedia', {
    tempFiles: [{
      name: 'line-art.png',
      size: 1024,
      tempFilePath: simulatorImagePath,
    }],
  })
  await miniProgram.mockWxMethod('canvasPutImageData', {
    errMsg: 'canvasPutImageData:ok',
  })
  await miniProgram.mockWxMethod('canvasToTempFilePath', {
    errMsg: 'canvasToTempFilePath:ok',
    tempFilePath: simulatorImagePath,
  })
  await miniProgram.mockWxMethod('saveImageToPhotosAlbum', {
    errMsg: 'saveImageToPhotosAlbum:ok',
  })
  await miniProgram.mockWxMethod('shareFileMessage', {
    errMsg: 'shareFileMessage:ok',
  })
  const chooseButton = await page.$('.primary-button')
  assert.ok(chooseButton)
  await chooseButton.tap()
  await page.waitFor(5000)

  const resultCard = await page.$('.result-card')
  const status = await page.$('.status-pill')
  assert.ok(resultCard, `微信模拟器没有生成结果卡；status=${await status?.text()}; exceptions=${JSON.stringify(exceptions)}; console=${JSON.stringify(consoleMessages)}`)
  const resultWxml = await resultCard.outerWxml()
  const resultSummary = await page.$('.result-summary')
  assert.ok(resultSummary)
  assert.match(await resultSummary.text(), /50 × 50 · 2500 颗/)

  const editToggle = await page.$('.edit-toggle')
  assert.ok(editToggle, '微信模拟器没有渲染编辑入口')
  await editToggle.tap()
  await page.waitFor(200)

  const toolButtons = await page.$$('.tool-button')
  assert.equal(toolButtons.length, 4, '微信编辑器没有渲染四种工具')
  await toolButtons[1].tap()
  const editLayer = await page.$('.edit-hit-layer')
  assert.ok(editLayer, '微信编辑器没有渲染触摸层')
  await editLayer.tap()
  await page.waitFor(300)
  assert.match(await status.text(), /橡皮已修改 1 格/)
  assert.match(await resultSummary.text(), /2499 颗/)

  const historyButtons = await page.$$('.history-button')
  assert.equal(historyButtons.length, 2)
  await historyButtons[0].tap()
  await page.waitFor(200)
  assert.match(await status.text(), /已撤销 1 格/)
  await historyButtons[1].tap()
  await page.waitFor(200)
  assert.match(await status.text(), /已重做 1 格/)

  await toolButtons[2].tap()
  await editLayer.tap()
  await page.waitFor(200)
  assert.match(await status.text(), /填充已修改 1 格/)
  assert.match(await resultSummary.text(), /2500 颗/)
  await historyButtons[0].tap()
  await page.waitFor(200)

  const fullPaletteToggle = await page.$('.full-palette-toggle')
  assert.ok(fullPaletteToggle)
  await fullPaletteToggle.tap()
  await page.waitFor(200)
  const fullPaletteButtons = await page.$$('.edit-palette-color')
  assert.equal(fullPaletteButtons.length, 291, '微信编辑器没有加载完整供应商色板')

  await fullPaletteButtons[0].tap()
  await toolButtons[0].tap()
  await editLayer.tap()
  await page.waitFor(200)
  assert.match(await status.text(), /画笔已修改 1 格/)
  assert.match(await resultSummary.text(), /2500 颗/)

  await fullPaletteButtons[1].tap()
  await toolButtons[3].tap()
  await editLayer.tap()
  await page.waitFor(200)
  assert.match(await status.text(), /整色替换已修改 1 格/)

  await historyButtons[0].tap()
  await page.waitFor(200)
  assert.match(await status.text(), /已撤销 1 格/)
  await historyButtons[0].tap()
  await page.waitFor(200)
  assert.match(await resultSummary.text(), /2499 颗/)

  const backgroundButton = await page.$('.background-button')
  assert.ok(backgroundButton)
  await backgroundButton.tap()
  await page.waitFor(300)
  assert.match(await status.text(), /已去背景 \d+ 格/)
  assert.doesNotMatch(await resultSummary.text(), /2499 颗/)
  await historyButtons[0].tap()
  await page.waitFor(200)
  assert.match(await resultSummary.text(), /2499 颗/)

  await editToggle.tap()
  const generationModes = await page.$$('.segment')
  assert.equal(generationModes.length, 2)
  await generationModes[1].tap()
  await chooseButton.tap()
  await page.waitFor(5000)
  assert.match(await generationModes[1].attribute('class'), /active/)
  assert.match(await resultSummary.text(), /50 × 50 · 2500 颗/)

  const exportActions = await page.$$('.export-action')
  assert.equal(exportActions.length, 3, '微信端没有保留三种主要导出入口')
  await exportActions[0].tap()
  await page.waitFor(1200)
  assert.match(await status.text(), /高清图纸已保存到相册/)
  await exportActions[1].tap()
  await page.waitFor(1200)
  assert.match(await status.text(), /高清图纸已保存到相册/)
  await exportActions[2].tap()
  await page.waitFor(1200)
  assert.match(await status.text(), /备料清单已保存到相册/)

  const projectExport = await page.$('.project-file-button.export')
  assert.ok(projectExport)
  await projectExport.tap()
  await page.waitFor(500)
  assert.match(await status.text(), /项目文件已打开分享/)

  const storedProject = await miniProgram.callWxMethod(
    'getStorageSync',
    'pinbean:last-project:v1',
  )
  assert.equal(storedProject.formatVersion, 2)
  assert.equal(storedProject.project.grid.width, 50)
  assert.equal(storedProject.project.grid.height, 50)
  assert.equal(storedProject.project.grid.cells.length, 2500)

  const restoredPage = await miniProgram.reLaunch('/pages/index/index')
  assert.ok(restoredPage)
  await restoredPage.waitFor(1200)
  const restoredSummary = await restoredPage.$('.result-summary')
  assert.ok(restoredSummary)
  assert.match(await restoredSummary.text(), /50 × 50 · 2500 颗/)
  const storedAfterRelaunch = await miniProgram.callWxMethod(
    'getStorageSync',
    'pinbean:last-project:v1',
  )
  assert.deepEqual(storedAfterRelaunch, storedProject)

  if (screenshotPath) await miniProgram.screenshot({ path: screenshotPath })

  const unexpectedConsoleErrors = consoleErrors.filter(message => {
    const text = message.args?.map(String).join(' ') ?? ''
    const isCanvasDebugLimitation = text.includes(
      'canvasPutImageData:fail 开发者工具暂时不支持此 API 调试，请使用真机进行开发',
    )
    if (isCanvasDebugLimitation) simulatorLimitations.push(message)
    return !isCanvasDebugLimitation
  })
  assert.deepEqual(exceptions, [], `微信模拟器异常：${JSON.stringify(exceptions)}`)
  assert.deepEqual(unexpectedConsoleErrors, [], `微信模拟器 console error：${JSON.stringify(unexpectedConsoleErrors)}`)

  process.stdout.write(`${JSON.stringify({
    verifiedFlows: [
      'COCO real-image generation',
      'erase/fill/paint/replace/background',
      'undo/redo/statistics',
      '291-color palette',
      'realistic regeneration',
      'plain/legend/material exports',
      'project-file sharing',
      'storage across route relaunch',
    ],
    mockedPlatformApis: [
      'canvasPutImageData',
      'canvasToTempFilePath',
      'saveImageToPhotosAlbum',
      'shareFileMessage',
    ],
    exceptions,
    simulatorLimitations: simulatorLimitations.length,
    pagePath: page.path,
    resultWxmlLength: resultWxml.length,
    size,
    wxmlLength: wxml.length,
  })}\n`)
} finally {
  miniProgram?.disconnect()
}
