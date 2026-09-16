import type { NormalizedImage } from '@pinbean/bead-core'

export interface SelectedImage {
  name?: string
  path: string
  size?: number
}

export interface SelectedImageInfo extends SelectedImage {
  height: number
  orientation?: string
  width: number
}

interface CallbackError {
  errMsg?: string
}

interface ChooseMediaApi {
  (options: {
    count: number
    mediaType: string[]
    sizeType: string[]
    sourceType: string[]
    success: (result: { tempFiles: Array<{ name?: string; size?: number; tempFilePath: string }> }) => void
    fail: (error: CallbackError) => void
  }): void
}

export async function chooseSingleImage(): Promise<SelectedImage> {
  const chooseMedia = (uni as unknown as { chooseMedia?: ChooseMediaApi }).chooseMedia
  if (typeof chooseMedia === 'function') {
    return new Promise((resolve, reject) => {
      chooseMedia({
        count: 1,
        mediaType: ['image'],
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: result => {
          const selected = result.tempFiles[0]
          if (!selected?.tempFilePath) reject(new Error('未取得图片临时路径'))
          else resolve({ name: selected.name, path: selected.tempFilePath, size: selected.size })
        },
        fail: error => reject(new Error(error.errMsg ?? '选择图片失败')),
      })
    })
  }

  return new Promise((resolve, reject) => {
    uni.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: result => {
        const path = result.tempFilePaths[0]
        const rawFiles = result.tempFiles
        const file = Array.isArray(rawFiles) ? rawFiles[0] : rawFiles
        if (!path) reject(new Error('未取得图片临时路径'))
        else resolve({
          name: typeof file === 'object' && file && 'name' in file && typeof file.name === 'string'
            ? file.name
            : undefined,
          path,
          size: typeof file === 'object' && file ? file.size : undefined,
        })
      },
      fail: error => reject(new Error(error.errMsg ?? '选择图片失败')),
    })
  })
}

export async function inspectImage(image: SelectedImage): Promise<SelectedImageInfo> {
  return new Promise((resolve, reject) => {
    uni.getImageInfo({
      src: image.path,
      success: info => resolve({
        ...image,
        width: info.width,
        height: info.height,
        orientation: info.orientation,
      }),
      fail: error => reject(new Error(error.errMsg ?? '读取图片信息失败')),
    })
  })
}

function drawCanvas(context: UniApp.CanvasContext): Promise<void> {
  return new Promise(resolve => context.draw(false, resolve))
}

export async function decodeImageFromCanvas(
  canvasId: string,
  image: SelectedImageInfo,
): Promise<NormalizedImage> {
  const context = uni.createCanvasContext(canvasId)
  context.clearRect(0, 0, image.width, image.height)
  context.drawImage(image.path, 0, 0, image.width, image.height)
  await drawCanvas(context)

  return new Promise((resolve, reject) => {
    uni.canvasGetImageData({
      canvasId,
      x: 0,
      y: 0,
      width: image.width,
      height: image.height,
      success: result => {
        const rgba = result.data instanceof Uint8ClampedArray
          ? result.data
          : new Uint8ClampedArray(result.data)
        resolve({ width: result.width, height: result.height, rgba })
      },
      fail: error => reject(new Error(error.errMsg ?? '读取图片像素失败')),
    })
  })
}
