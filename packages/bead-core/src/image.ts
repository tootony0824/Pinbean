import type { NormalizedImage } from './types.js';

export const MAX_IMAGE_PIXELS = 16_000_000;

export function validateImage(image: NormalizedImage): void {
  if (!Number.isInteger(image.width) || image.width <= 0
    || !Number.isInteger(image.height) || image.height <= 0) {
    throw new RangeError('image dimensions must be positive integers');
  }
  const pixels = image.width * image.height;
  const expectedLength = pixels * 4;
  if (!Number.isSafeInteger(pixels) || pixels > MAX_IMAGE_PIXELS || !Number.isSafeInteger(expectedLength)) {
    throw new RangeError(`image exceeds ${MAX_IMAGE_PIXELS} pixels`);
  }
  if (image.rgba.length !== expectedLength) {
    throw new RangeError(`rgba length must be ${expectedLength}`);
  }
}

export function resizeNearestNeighbor(
  image: NormalizedImage,
  targetWidth: number,
  targetHeight: number,
): NormalizedImage {
  validateImage(image);
  if (!Number.isInteger(targetWidth) || targetWidth <= 0
    || !Number.isInteger(targetHeight) || targetHeight <= 0) {
    throw new RangeError('target dimensions must be positive integers');
  }
  const targetPixels = targetWidth * targetHeight;
  const targetLength = targetPixels * 4;
  if (!Number.isSafeInteger(targetPixels) || targetPixels > MAX_IMAGE_PIXELS || !Number.isSafeInteger(targetLength)) {
    throw new RangeError(`target image exceeds ${MAX_IMAGE_PIXELS} pixels`);
  }
  const rgba = new Uint8ClampedArray(targetLength);
  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor(targetY * image.height / targetHeight));
    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor(targetX * image.width / targetWidth));
      const sourceOffset = (sourceY * image.width + sourceX) * 4;
      const targetOffset = (targetY * targetWidth + targetX) * 4;
      rgba[targetOffset] = image.rgba[sourceOffset] ?? 0;
      rgba[targetOffset + 1] = image.rgba[sourceOffset + 1] ?? 0;
      rgba[targetOffset + 2] = image.rgba[sourceOffset + 2] ?? 0;
      rgba[targetOffset + 3] = image.rgba[sourceOffset + 3] ?? 0;
    }
  }
  return { width: targetWidth, height: targetHeight, rgba };
}
