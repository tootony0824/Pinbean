import assert from 'node:assert/strict';
import test from 'node:test';

import { NextRequest } from 'next/server';

import { GET, POST } from '../src/app/api/ai-optimize/route';
import {
  AI_RATE_LIMIT_CAPACITY,
  AiHttpError,
  InMemoryAiJobStore,
  MAX_AI_IMAGE_BYTES,
  callVolcApi,
  createVolcAuthorization,
  parseAiOptimizationInput,
  parseVolcResultResponse,
  parseVolcSubmitResponse,
} from '../src/server/aiOptimize';

const authVector = createVolcAuthorization({
  body: JSON.stringify({ req_key: 'jimeng_t2i_v40', prompt: 'pinbean' }),
  credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'SECRETEXAMPLE' },
  dateTime: '20260102T030405Z',
  method: 'POST',
  pathName: '/',
  query: { Action: 'CVSync2AsyncSubmitTask', Version: '2022-08-31' },
});

test('Volc signer is stable for the golden vector', () => {
  assert.equal(authVector.contentSha256, 'd942ddf1ceba6702c8eff7bf827d94a3e43e5482f2c04d7820373dab6f5931b2');
  assert.equal(
    authVector.authorization,
    'HMAC-SHA256 Credential=AKIDEXAMPLE/20260102/cn-north-1/cv/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=c4c2db1d8a255475f49e2c880a4d309cf31d0c10c222a3ed90fb63b7771781e3',
  );
});

test('AI input parser trims prompt and rejects malformed or oversized input', () => {
  const parsed = parseAiOptimizationInput({
    imageBase64: 'data:image/png;base64,iVBORw0KGgo=',
    prompt: '  chibi  ',
  });
  assert.deepEqual(parsed, { imageBase64: 'iVBORw0KGgo=', mediaType: 'image/png', prompt: 'chibi' });
  assert.throws(() => parseAiOptimizationInput({ imageBase64: '', prompt: 'x' }), /图片必须/);
  assert.throws(() => parseAiOptimizationInput({ imageBase64: 'AAAA', prompt: ' '.repeat(1) }), /prompt 不能为空/);
  const oversizedImage = `iVBORw0KGgo${'A'.repeat(MAX_AI_IMAGE_BYTES * 2 + 3)}==`;
  assert.throws(
    () => parseAiOptimizationInput({ imageBase64: oversizedImage, prompt: 'x' }),
    /图片不能超过/,
  );
});

test('Volc response parsers handle nested success and sanitized failures', () => {
  assert.equal(parseVolcSubmitResponse({ data: { task_id: 'task-1' }, status: 10000 }), 'task-1');
  assert.throws(() => parseVolcSubmitResponse({ status: 50411, message: 'Risk image' }), (error: unknown) => {
    assert(error instanceof AiHttpError);
    assert.equal(error.code, 'IMAGE_RISK');
    assert.equal(error.status, 400);
    return true;
  });

  assert.deepEqual(parseVolcResultResponse({ data: { status: 'running' } }), { status: 'running' });
  assert.deepEqual(parseVolcResultResponse({ data: { status: 'succeeded', image_urls: ['https://example.test/a.png'] } }), {
    imageUrl: 'https://example.test/a.png',
    status: 'succeeded',
  });
  assert.deepEqual(parseVolcResultResponse({ data: { status: 'done', binary_data_base64: ['AAAA'] } }), {
    imageDataUrl: 'data:image/png;base64,AAAA',
    status: 'succeeded',
  });
  assert.equal(parseVolcResultResponse({ data: { status: 'expired' } }).error?.code, 'JOB_EXPIRED');
});

test('Volc HTTP wrapper redacts upstream details and maps retryable status', async () => {
  await assert.rejects(
    () => callVolcApi('Action', { image: 'secret-base64' }, { accessKeyId: 'AK', secretAccessKey: 'SK' }, async () => new Response('{"message":"too many"}', { status: 429 }) as Response),
    (error: unknown) => {
      assert(error instanceof AiHttpError);
      assert.equal(error.code, 'PROVIDER_RATE_LIMITED');
      assert.equal(error.status, 502);
      assert(!error.message.includes('secret-base64'));
      return true;
    },
  );
});

test('in-memory AI job store enforces client isolation, rate and concurrency helpers', () => {
  const store = new InMemoryAiJobStore();
  const job = store.create({ clientKey: 'client-a', requestId: 'request-1' });
  assert.equal(store.getForClient(job.jobId, 'client-a')?.jobId, job.jobId);
  assert.equal(store.getForClient(job.jobId, 'client-b'), null);
  assert.equal(store.countActive('client-a'), 1);
  store.update(job.jobId, { status: 'failed' });
  assert.equal(store.countActive('client-a'), 0);

  for (let index = 0; index < AI_RATE_LIMIT_CAPACITY; index += 1) {
    assert.equal(store.takeToken('client-b').allowed, true);
  }
  assert.equal(store.takeToken('client-b').allowed, false);
});

test('AI route rejects requests without CSRF header before reading secrets', async () => {
  const response = await POST(new NextRequest('http://localhost/api/ai-optimize', {
    body: JSON.stringify({ imageBase64: 'AAAA', prompt: 'x' }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  }));
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, 'BAD_CSRF');
});

test('AI route returns sanitized missing-config and bad-job envelopes', async () => {
  const previousAccessKey = process.env.VOLC_ACCESS_KEY_ID;
  const previousSecretKey = process.env.VOLC_SECRET_ACCESS_KEY;
  delete process.env.VOLC_ACCESS_KEY_ID;
  delete process.env.VOLC_SECRET_ACCESS_KEY;
  try {
    const post = await POST(new NextRequest('http://localhost/api/ai-optimize', {
      body: JSON.stringify({ imageBase64: 'AAAA', prompt: 'x' }),
      headers: { 'content-type': 'application/json', 'x-pinbean-ai-request': '1' },
      method: 'POST',
    }));
    assert.equal(post.status, 500);
    assert.equal((await post.json()).error.code, 'AI_CONFIG_MISSING');

    const get = await GET(new NextRequest('http://localhost/api/ai-optimize?jobId=missing', {
      headers: { 'x-pinbean-ai-request': '1' },
      method: 'GET',
    }));
    assert.equal(get.status, 404);
    assert.equal((await get.json()).error.code, 'JOB_NOT_FOUND');
  } finally {
    if (previousAccessKey === undefined) delete process.env.VOLC_ACCESS_KEY_ID;
    else process.env.VOLC_ACCESS_KEY_ID = previousAccessKey;
    if (previousSecretKey === undefined) delete process.env.VOLC_SECRET_ACCESS_KEY;
    else process.env.VOLC_SECRET_ACCESS_KEY = previousSecretKey;
  }
});
