export interface SelectedProjectFile {
  name: string
  text: string
}

export type ProjectFileDelivery = 'download' | 'share'

export function chooseProjectFile(): Promise<SelectedProjectFile> {
  // #ifdef H5
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.pinbean.json,.json,application/json'
    input.style.display = 'none'
    document.body.appendChild(input)
    const cleanup = (): void => input.remove()
    input.addEventListener('cancel', () => {
      cleanup()
      reject(new Error('cancel project file selection'))
    }, { once: true })
    input.addEventListener('change', async () => {
      const file = input.files?.[0]
      cleanup()
      if (!file) {
        reject(new Error('cancel project file selection'))
        return
      }
      try {
        resolve({ name: file.name, text: await file.text() })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        reject(new Error(`读取项目文件失败：${message}`))
      }
    }, { once: true })
    input.click()
  })
  // #endif

  // #ifdef MP-WEIXIN
  return new Promise((resolve, reject) => {
    uni.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['json'],
      success: selection => {
        const file = selection.tempFiles[0]
        if (!file) {
          reject(new Error('没有选择项目文件'))
          return
        }
        uni.getFileSystemManager().readFile({
          filePath: file.path,
          encoding: 'utf8',
          success: result => {
            if (typeof result.data !== 'string') {
              reject(new Error('项目文件不是文本文件'))
              return
            }
            resolve({ name: file.name, text: result.data })
          },
          fail: error => reject(new Error(error.errMsg || '读取项目文件失败')),
        })
      },
      fail: error => reject(new Error(error.errMsg || '选择项目文件失败')),
    })
  })
  // #endif

  return Promise.reject(new Error('当前平台不支持项目文件导入'))
}

export async function deliverProjectFile(
  text: string,
  fileName: string,
): Promise<ProjectFileDelivery> {
  // #ifdef H5
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.download = fileName
  link.href = url
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  return 'download'
  // #endif

  // #ifdef MP-WEIXIN
  const userDataPath = (uni as unknown as { env: { USER_DATA_PATH: string } }).env.USER_DATA_PATH
  const filePath = `${userDataPath}/${fileName}`
  await new Promise<void>((resolve, reject) => {
    uni.getFileSystemManager().writeFile({
      filePath,
      data: text,
      encoding: 'utf8',
      success: () => resolve(),
      fail: error => reject(new Error(error.errMsg || '写入项目文件失败')),
    })
  })
  await new Promise<void>((resolve, reject) => {
    uni.shareFileMessage({
      filePath,
      fileName,
      success: () => resolve(),
      fail: error => reject(new Error(error.errMsg || '分享项目文件失败')),
    })
  })
  return 'share'
  // #endif

  throw new Error('当前平台不支持项目文件导出')
}
