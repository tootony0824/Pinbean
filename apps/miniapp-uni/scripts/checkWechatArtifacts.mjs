import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { extname, join, relative, resolve } from 'node:path'

const scriptDirectory = fileURLToPath(new URL('.', import.meta.url))
const outputDirectory = resolve(scriptDirectory, '../dist/build/mp-weixin')

async function collectJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectJavaScriptFiles(path))
    } else if (extname(entry.name) === '.js') {
      files.push(path)
    }
  }

  return files
}

const unsupportedSyntax = [
  { label: 'nullish coalescing (??)', pattern: /\?\?/ },
  { label: 'optional chaining (?.)', pattern: /\?\.(?!\d)/ },
]

const failures = []
for (const file of await collectJavaScriptFiles(outputDirectory)) {
  const source = await readFile(file, 'utf8')
  for (const syntax of unsupportedSyntax) {
    if (syntax.pattern.test(source)) {
      failures.push(`${relative(outputDirectory, file)}: ${syntax.label}`)
    }
  }
}

if (failures.length > 0) {
  throw new Error(
    `微信构建产物包含安卓真机不支持的语法：\n${failures.join('\n')}`,
  )
}

console.log('微信构建产物语法兼容性检查通过')
