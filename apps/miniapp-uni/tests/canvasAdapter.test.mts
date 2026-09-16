import assert from 'node:assert/strict'
import test from 'node:test'

import type { NormalizedImage } from '@pinbean/bead-core'

import { putImageOnCanvas } from '../src/adapters/canvasAdapter.ts'

const image: NormalizedImage = {
  height: 1,
  rgba: new Uint8ClampedArray([1, 2, 3, 255]),
  width: 1,
}

interface PutImageOptions {
  canvasId: string
  data: Uint8ClampedArray
  fail: (error: { errMsg: string }) => void
  height: number
  success: () => void
  width: number
  x: number
  y: number
}

test('preview renderer retries while a newly mounted WeChat canvas is empty', async () => {
  let attempts = 0
  globalThis.uni = {
    canvasPutImageData(options: PutImageOptions) {
      attempts += 1
      if (attempts === 1) options.fail({ errMsg: 'canvasPutImageData:fail canvas is empty' })
      else options.success()
    },
  } as typeof uni

  await putImageOnCanvas('preview', image)
  assert.equal(attempts, 2)
})

test('preview renderer does not retry unrelated Canvas failures', async () => {
  let attempts = 0
  globalThis.uni = {
    canvasPutImageData(options: PutImageOptions) {
      attempts += 1
      options.fail({ errMsg: 'canvasPutImageData:fail permission denied' })
    },
  } as typeof uni

  await assert.rejects(() => putImageOnCanvas('preview', image), /permission denied/)
  assert.equal(attempts, 1)
})
