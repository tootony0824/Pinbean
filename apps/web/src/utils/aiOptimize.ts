const DEFAULT_PROMPT = '图片修改为：chibi画风，背景白底。pixel art style, 16-bit, retro game aesthetic, sharp focus, high contrast, clean lines, detailed pixel art, masterpiece, best quality';
const AI_REQUEST_HEADERS = { 'X-PinBean-AI-Request': '1' };

const MAX_CLIENT_IMAGE_PIXELS = 16_000_000;
const MAX_CLIENT_IMAGE_BYTES = 4 * 1024 * 1024;
const POLL_INTERVAL_MS = 2_500;
const POLL_TIMEOUT_MS = 180_000;

export interface AIOptimizeOptions {
  customPrompt?: string;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

export interface AIOptimizeResult {
  success: boolean;
  imageUrl?: string;
  error?: string;
}

interface ApiEnvelope<T> {
  data?: T;
  error?: {
    code: string;
    message: string;
    retryAfterMs?: number;
    retryable: boolean;
  };
  ok: boolean;
  requestId: string;
}

interface JobState {
  error?: { message: string };
  imageDataUrl?: string;
  imageUrl?: string;
  jobId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('AI optimization was cancelled', 'AbortError'));
      return;
    }
    const timeout = window.setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timeout);
      reject(new DOMException('AI optimization was cancelled', 'AbortError'));
    }, { once: true });
  });
}

function resizeImage(img: HTMLImageElement, maxWidth: number = 2048, maxHeight: number = 2048): HTMLCanvasElement {
  if (img.naturalWidth * img.naturalHeight > MAX_CLIENT_IMAGE_PIXELS) {
    throw new Error('图片分辨率过高，请先压缩后再使用 AI 优化。');
  }
  const canvas = document.createElement('canvas');
  let width = img.width;
  let height = img.height;

  if (width > maxWidth || height > maxHeight) {
    const ratio = Math.min(maxWidth / width, maxHeight / height);
    width = Math.max(1, Math.floor(width * ratio));
    height = Math.max(1, Math.floor(height * ratio));
  }

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);

  return canvas;
}

function canvasToBase64(canvas: HTMLCanvasElement, maxSizeBytes: number = MAX_CLIENT_IMAGE_BYTES): string {
  let dataUrl = canvas.toDataURL('image/png');
  let bytes = Math.round(dataUrl.length * 3 / 4);

  if (bytes > maxSizeBytes) {
    let quality = 0.9;
    while (bytes > maxSizeBytes && quality >= 0.35) {
      dataUrl = canvas.toDataURL('image/jpeg', quality);
      bytes = Math.round(dataUrl.length * 3 / 4);
      quality -= 0.1;
    }
  }

  if (bytes > maxSizeBytes) {
    const scale = Math.sqrt(maxSizeBytes / bytes) * 0.9;
    const resized = document.createElement('canvas');
    resized.width = Math.max(1, Math.floor(canvas.width * scale));
    resized.height = Math.max(1, Math.floor(canvas.height * scale));
    const ctx = resized.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, resized.width, resized.height);
    return canvasToBase64(resized, maxSizeBytes);
  }

  return dataUrl;
}

export function imageToBase64(imageSrc: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        resolve(canvasToBase64(resizeImage(img)));
      } catch (error) {
        reject(error);
      }
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageSrc;
  });
}

async function readEnvelope<T>(response: Response): Promise<ApiEnvelope<T>> {
  let envelope: ApiEnvelope<T>;
  try {
    envelope = await response.json() as ApiEnvelope<T>;
  } catch {
    throw new Error(`API request failed: ${response.status}`);
  }
  if (!response.ok || !envelope.ok) {
    throw new Error(envelope.error?.message || `API request failed: ${response.status}`);
  }
  return envelope;
}

async function submitJob(imageBase64: string, prompt: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch('/api/ai-optimize', {
    body: JSON.stringify({ imageBase64, prompt }),
    headers: { ...AI_REQUEST_HEADERS, 'Content-Type': 'application/json' },
    method: 'POST',
    signal,
  });
  const envelope = await readEnvelope<{ jobId: string; status: string }>(response);
  if (!envelope.data?.jobId) throw new Error('AI 服务未返回任务 ID');
  return envelope.data.jobId;
}

async function pollJob(jobId: string, onProgress?: (progress: number) => void, signal?: AbortSignal): Promise<string> {
  const startedAt = Date.now();
  let attempt = 0;
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    await wait(POLL_INTERVAL_MS, signal);
    attempt += 1;
    onProgress?.(Math.min(95, 35 + attempt * 5));
    const response = await fetch(`/api/ai-optimize?jobId=${encodeURIComponent(jobId)}`, {
      headers: AI_REQUEST_HEADERS,
      signal,
    });
    const envelope = await readEnvelope<JobState>(response);
    const job = envelope.data;
    if (!job) throw new Error('AI 服务未返回任务状态');
    if (job.status === 'succeeded' && (job.imageUrl || job.imageDataUrl)) {
      return job.imageDataUrl || job.imageUrl || '';
    }
    if (job.status === 'failed') {
      throw new Error(job.error?.message || 'AI 任务失败，请重试');
    }
  }
  throw new Error('AI 任务超时，请稍后重试');
}

export async function optimizeImageWithAI(
  imageSrc: string,
  options: AIOptimizeOptions = {},
): Promise<AIOptimizeResult> {
  try {
    const { customPrompt, onProgress, signal } = options;
    onProgress?.(10);
    const base64Image = await imageToBase64(imageSrc);
    onProgress?.(25);
    const jobId = await submitJob(base64Image, customPrompt?.trim() || DEFAULT_PROMPT, signal);
    onProgress?.(35);
    const imageUrl = await pollJob(jobId, onProgress, signal);
    onProgress?.(100);
    return { imageUrl, success: true };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { error: 'AI 优化已取消', success: false };
    }
    return {
      error: error instanceof Error ? error.message : 'AI optimization failed',
      success: false,
    };
  }
}

export async function downloadImageAsDataURL(imageUrl: string): Promise<string> {
  if (imageUrl.startsWith('data:')) return imageUrl;
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error('Failed to download optimized image');
  const blob = await response.blob();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Failed to convert image to data URL'));
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
