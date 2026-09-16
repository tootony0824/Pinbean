import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PNG } from 'pngjs'
import { getSupplierPalette } from '@pinbean/palette-data'

const appDir = fileURLToPath(new URL('../', import.meta.url))
const buildDir = join(appDir, 'dist/build/h5')
const artifactDir = process.env.PINBEAN_SMOKE_ARTIFACT_DIR
  ? resolve(process.env.PINBEAN_SMOKE_ARTIFACT_DIR)
  : mkdtempSync(join(tmpdir(), 'pinbean-h5-full-'))
mkdirSync(artifactDir, { recursive: true })

// Cell-aligned opaque input keeps both sampling modes on the same exact UI baseline.
// The interior 6x31 black rectangle leaves all 2314 light cells edge-connected.
// At 8px/cell the smoke click (4,4) hits light cell (0,0): paint=1, fill/replace=2314.
const palette = getSupplierPalette('MARD')
const light = palette.colors.find(color => color.code === 'P01')
const dark = palette.colors.find(color => color.code === 'H07')
assert.ok(light && dark, 'full smoke fixture requires MARD P01 and H07')
assert.equal(light.hex, '#FCF7F8')
assert.equal(dark.hex, '#000000')
assert.ok(Math.hypot(light.rgb.r - dark.rgb.r, light.rgb.g - dark.rgb.g, light.rgb.b - dark.rgb.b) > 48,
  'fixture colors must remain separate at the default merge threshold')
const fixture = new PNG({ width: 50, height: 50 })
for (let y = 0; y < 50; y += 1) {
  for (let x = 0; x < 50; x += 1) {
    const color = x >= 12 && x < 18 && y >= 10 && y < 41 ? dark : light
    fixture.data.set([color.rgb.r, color.rgb.g, color.rgb.b, 255], (y * 50 + x) * 4)
  }
}
const imagePath = join(artifactDir, 'fixture.png')
writeFileSync(imagePath, PNG.sync.write(fixture))

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
}
let server
let child
const abort = new AbortController()
const interrupt = () => {
  process.exitCode = 1
  abort.abort()
  child?.kill()
}
process.once('SIGINT', interrupt)
process.once('SIGTERM', interrupt)

try {
  let targetUrl = process.env.PINBEAN_H5_URL
  if (!targetUrl) {
    assert.ok(existsSync(join(buildDir, 'index.html')), 'Build H5 first: npm run build:core && npm run build:palette && npm run build:uni:h5')
    server = createServer(async (request, response) => {
      try {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
        const path = resolve(buildDir, `.${pathname === '/' ? '/index.html' : pathname}`)
        const localPath = relative(buildDir, path)
        if (localPath === '..' || localPath.startsWith(`..${sep}`) || isAbsolute(localPath)) {
          response.writeHead(403).end()
          return
        }
        const data = await readFile(path)
        response.writeHead(200, { 'Content-Type': mimeTypes[extname(path)] ?? 'application/octet-stream' })
        response.end(data)
      } catch {
        response.writeHead(404).end()
      }
    })
    await new Promise((accept, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', accept)
    })
    targetUrl = `http://127.0.0.1:${server.address().port}/`
  }
  process.stdout.write(`Full H5 smoke artifacts: ${artifactDir}\n`)
  for (const mode of ['cartoon', 'realistic']) {
    const modeDir = join(artifactDir, mode)
    mkdirSync(modeDir, { recursive: true })
    const env = { ...process.env, PINBEAN_H5_URL: targetUrl, PINBEAN_SMOKE_IMAGE: imagePath, PINBEAN_SMOKE_MODE: mode, PINBEAN_SMOKE_COLOR_SYSTEM: 'MARD' }
    for (const feature of ['EDIT', 'EXPORT', 'PERSIST', 'PROJECT', 'PROGRESS', 'PUBLISH', 'HISTORY', 'REVIEW']) {
      env[`PINBEAN_SMOKE_${feature}`] = '1'
    }
    for (const [key, name] of Object.entries({ SCREENSHOT: 'page.png', EXPORT_PATH: 'legend.png', MATERIAL_PATH: 'materials.png', PLAIN_PATH: 'plain.png', BOARD_PATH: 'board.png', BOARD_ATLAS_PATH: 'boards.png', PROJECT_PATH: 'project.pinbean.json', COVER_PATH: 'cover.png' })) {
      env[`PINBEAN_SMOKE_${key}`] = join(modeDir, name)
    }
    let output = ''
    await new Promise((accept, reject) => {
      child = spawn(process.execPath, [join(appDir, 'scripts/h5Smoke.mjs')], {
        cwd: appDir, env, stdio: ['ignore', 'pipe', 'pipe'], signal: abort.signal,
      })
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error(`${mode} smoke exceeded 10 minutes`))
      }, 600_000)
      child.stdout.on('data', data => { output += data; process.stdout.write(data) })
      child.stderr.on('data', data => { output += data; process.stderr.write(data) })
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('close', (code, signal) => {
        clearTimeout(timer)
        writeFileSync(join(modeDir, 'smoke.log'), output)
        child = undefined
        if (code === 0) accept()
        else reject(new Error(`${mode} smoke failed (${signal ?? code}); see ${modeDir}`))
      })
    })
    const project = JSON.parse(readFileSync(join(modeDir, 'project.pinbean.json'), 'utf8'))
    assert.equal(project.project.generation.config.mode, mode)
  }
  process.stdout.write('Both H5 modes completed with all eight smoke branches enabled. This is not WeChat device acceptance.\n')
} finally {
  child?.kill()
  if (server) {
    server.closeAllConnections()
    await new Promise(accept => server.close(accept))
  }
  process.removeListener('SIGINT', interrupt)
  process.removeListener('SIGTERM', interrupt)
}
