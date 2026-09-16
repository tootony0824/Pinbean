import type { NormalizedImage } from '@pinbean/bead-core'

const CANVAS_READY_RETRY_DELAYS = [0, 80, 200, 400] as const

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function putImageDataOnce(
  canvasId: string,
  image: NormalizedImage,
): Promise<void> {
  return new Promise((resolve, reject) => {
    uni.canvasPutImageData({
      canvasId,
      data: image.rgba,
      x: 0,
      y: 0,
      width: image.width,
      height: image.height,
      success: () => resolve(),
      fail: error => reject(new Error(error.errMsg ?? '绘制图案失败')),
    })
  })
}

export async function putImageOnCanvas(
  canvasId: string,
  image: NormalizedImage,
): Promise<void> {
  let lastError: Error | null = null
  for (const retryDelay of CANVAS_READY_RETRY_DELAYS) {
    if (retryDelay > 0) await delay(retryDelay)
    try {
      await putImageDataOnce(canvasId, image)
      return
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (!/canvas is empty/i.test(lastError.message)) throw lastError
    }
  }
  throw lastError ?? new Error('绘制图案失败')
}
