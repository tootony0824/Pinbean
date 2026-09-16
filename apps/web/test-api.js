#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const [, , imagePathArg, promptArg] = process.argv;
const imagePath = imagePathArg ? path.resolve(imagePathArg) : path.join(__dirname, 'generated-34df74d1-fab4-4dbd-9662-4f6b8d6f1b93.jpg');
const apiBaseUrl = process.env.PINBEAN_AI_API_BASE_URL || 'http://127.0.0.1:3000';
const prompt = promptArg || '图片修改为：chibi画风，背景白底。pixel art style, 16-bit, retro game aesthetic, sharp focus, high contrast, clean lines, detailed pixel art, masterpiece, best quality';

function assertImagePath(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Image not found: ${filePath}`);
  const ext = path.extname(filePath).toLowerCase();
  if (!['.jpg', '.jpeg', '.png'].includes(ext)) throw new Error('Only JPG and PNG are supported by this local smoke tool.');
}

async function readJson(response) {
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`Local AI API returned non-JSON response: HTTP ${response.status}`);
  }
}

async function main() {
  assertImagePath(imagePath);
  const imageBuffer = fs.readFileSync(imagePath);
  const mediaType = path.extname(imagePath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
  const imageBase64 = `data:${mediaType};base64,${imageBuffer.toString('base64')}`;
  console.log(`Submitting local AI smoke request: ${path.basename(imagePath)} (${imageBuffer.length} bytes)`);

  const submitResponse = await fetch(`${apiBaseUrl}/api/ai-optimize`, {
    body: JSON.stringify({ imageBase64, prompt }),
    headers: {
      'content-type': 'application/json',
      'x-pinbean-ai-request': '1',
    },
    method: 'POST',
  });
  const submitBody = await readJson(submitResponse);
  if (!submitResponse.ok || !submitBody.ok) {
    throw new Error(`Submit failed: ${submitBody.error?.code || submitResponse.status} ${submitBody.error?.message || ''}`.trim());
  }

  const jobId = submitBody.data?.jobId;
  if (!jobId) throw new Error('Submit response did not include jobId.');
  console.log(`Queued AI job ${String(jobId).slice(0, 8)}…; polling sanitized status.`);

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 2_500));
    const statusResponse = await fetch(`${apiBaseUrl}/api/ai-optimize?jobId=${encodeURIComponent(jobId)}`, {
      headers: { 'x-pinbean-ai-request': '1' },
    });
    const statusBody = await readJson(statusResponse);
    if (!statusResponse.ok || !statusBody.ok) {
      throw new Error(`Poll failed: ${statusBody.error?.code || statusResponse.status} ${statusBody.error?.message || ''}`.trim());
    }
    const job = statusBody.data;
    console.log(`Status: ${job.status}`);
    if (job.status === 'succeeded') {
      const result = job.imageDataUrl || job.imageUrl;
      console.log(`Succeeded. Result type: ${job.imageDataUrl ? 'data-url' : 'remote-url'}; length: ${String(result).length}`);
      return;
    }
    if (job.status === 'failed') {
      throw new Error(`AI job failed: ${job.error?.code || ''} ${job.error?.message || ''}`.trim());
    }
  }
  throw new Error('AI job timed out.');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
