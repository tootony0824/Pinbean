import { NextRequest, NextResponse } from 'next/server';

import {
  MAX_AI_IMAGE_BYTES,
  aiError,
  aiJobStore,
  getCredentialsFromEnv,
  parseAiOptimizationInput,
  publicJobState,
  refreshProviderJob,
  requestId,
  submitProviderTaskForJob,
  type AiHttpError,
} from '@/server/aiOptimize';

import { AI_SESSION_COOKIE, AI_SESSION_MAX_AGE, aiQuotaKey, issueAiSession, verifyAiSession } from '@/server/aiSession';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
let pendingSubmissions = 0;
const MAX_PENDING_SUBMISSIONS = 8;

async function readJson(request: NextRequest): Promise<unknown> {
  const maxBytes = Math.ceil(MAX_AI_IMAGE_BYTES * 4 / 3) + 16_384;
  const oversized = () => aiError('IMAGE_TOO_LARGE', '请求体过大。', false, 413);
  if (Number(request.headers.get('content-length')) > maxBytes) throw oversized();
  const reader = request.body?.getReader();
  if (!reader) throw aiError('BAD_JSON', '请求体不是有效 JSON。', false);
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 15_000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw oversized();
      }
      chunks.push(value);
    }
    if (timedOut) throw aiError('REQUEST_TIMEOUT', '请求体读取超时。', true, 408);
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof Error && error.name === 'AiHttpError') throw error;
    throw aiError('BAD_JSON', '请求体不是有效 JSON。', false);
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

function allowedOrigins(request: NextRequest): Set<string> {
  const configured = process.env.AI_ALLOWED_ORIGINS?.split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  return new Set(configured && configured.length > 0 ? configured : [request.nextUrl.origin]);
}

function assertSameOrigin(request: NextRequest): void {
  const allowed = allowedOrigins(request);
  const origin = request.headers.get('origin');
  if (origin && !allowed.has(origin)) {
    throw aiError('BAD_ORIGIN', '请求来源不被允许。', false, 403);
  }
  const referer = request.headers.get('referer');
  if (!origin && referer) {
    try {
      if (!allowed.has(new URL(referer).origin)) throw aiError('BAD_ORIGIN', '请求来源不被允许。', false, 403);
    } catch (error) {
      if (error instanceof Error && error.name === 'AiHttpError') throw error;
      throw aiError('BAD_ORIGIN', '请求来源不被允许。', false, 403);
    }
  }
}

function assertAiRequestHeader(request: NextRequest): void {
  if (request.headers.get('x-pinbean-ai-request') !== '1') {
    throw aiError('BAD_CSRF', 'AI 请求缺少安全校验头。', false, 403);
  }
}

function jsonOk(data: unknown, status = 200, id = requestId()) {
  return NextResponse.json({ ok: true, data, requestId: id }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function errorStatus(error: Error): number {
  return error.name === 'AiHttpError' ? (error as AiHttpError).status : 500;
}

function jsonError(error: unknown, id = requestId()) {
  const err = error instanceof Error ? error : new Error(String(error));
  const isHttp = err.name === 'AiHttpError';
  const httpError = isHttp ? err as AiHttpError : null;
  const status = errorStatus(err);
  const retryAfterMs = httpError?.retryAfterMs;
  const headers = { 'Cache-Control': 'no-store', ...(retryAfterMs ? { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } : {}) };
  return NextResponse.json({
    ok: false,
    error: {
      code: httpError?.code ?? 'AI_INTERNAL_ERROR',
      message: isHttp ? err.message : 'AI 服务暂时不可用，请稍后重试。',
      ...(retryAfterMs ? { retryAfterMs } : {}),
      retryable: httpError?.retryable ?? true,
    },
    requestId: id,
  }, { headers, status });
}

export async function POST(request: NextRequest) {
  const id = requestId();
  let admitted = false;
  try {
    assertSameOrigin(request);
    assertAiRequestHeader(request);
    if (pendingSubmissions >= MAX_PENDING_SUBMISSIONS) throw aiError('AI_BUSY', 'AI 服务繁忙，请稍后重试。', true, 429, 15_000);
    pendingSubmissions += 1;
    admitted = true;
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      throw aiError('UNSUPPORTED_MEDIA_TYPE', 'Content-Type 必须是 application/json。', false, 415);
    }
    const quotaKey = aiQuotaKey(request.headers);
    const globalToken = aiJobStore.takeGlobalToken();
    if (!globalToken.allowed) throw aiError('RATE_LIMITED', 'AI 请求过于频繁，请稍后重试。', true, 429, globalToken.retryAfterMs);
    const token = aiJobStore.takeToken(quotaKey);
    if (!token.allowed) throw aiError('RATE_LIMITED', 'AI 请求过于频繁，请稍后重试。', true, 429, token.retryAfterMs);
    const existingSession = request.cookies.get(AI_SESSION_COOKIE)?.value;
    const verifiedClient = verifyAiSession(existingSession);
    const session = verifiedClient && existingSession ? existingSession : issueAiSession();
    const client = verifiedClient ?? verifyAiSession(session);
    if (!client) throw aiError('AI_SESSION_FAILED', 'AI 会话暂时不可用。', true, 500);
    const sessionToken = aiJobStore.takeToken(`session:${client}`);
    if (!sessionToken.allowed) throw aiError('RATE_LIMITED', 'AI 请求过于频繁，请稍后重试。', true, 429, sessionToken.retryAfterMs);
    const credentials = getCredentialsFromEnv();
    const input = parseAiOptimizationInput(await readJson(request));
    const job = aiJobStore.create({ clientKey: client, quotaKey, requestId: id });
    console.info('[ai-optimize]', { event: 'queued', jobId: job.jobId, requestId: id, status: 202 });
    void submitProviderTaskForJob(job.jobId, input, credentials);
    const response = jsonOk({ jobId: job.jobId, status: job.status }, 202, id);
    response.cookies.set(AI_SESSION_COOKIE, session, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/ai-optimize',
      maxAge: AI_SESSION_MAX_AGE,
    });
    return response;
  } catch (error) {
    console.warn('[ai-optimize]', {
      code: error instanceof Error && error.name === 'AiHttpError' ? (error as AiHttpError).code : 'AI_INTERNAL_ERROR',
      event: 'rejected',
      requestId: id,
      status: error instanceof Error ? errorStatus(error) : 500,
    });
    return jsonError(error, id);
  } finally {
    if (admitted) pendingSubmissions -= 1;
  }
}

export async function GET(request: NextRequest) {
  const id = requestId();
  try {
    assertSameOrigin(request);
    assertAiRequestHeader(request);
    const jobId = request.nextUrl.searchParams.get('jobId');
    if (!jobId) throw aiError('BAD_JOB_ID', '缺少 jobId。', false, 400);
    const client = verifyAiSession(request.cookies.get(AI_SESSION_COOKIE)?.value);
    const job = client ? aiJobStore.getForClient(jobId, client) : null;
    if (!job) throw aiError('JOB_NOT_FOUND', 'AI 任务不存在或已过期。', false, 404);
    const refreshed = await refreshProviderJob(jobId, getCredentialsFromEnv());
    if (!refreshed) throw aiError('JOB_NOT_FOUND', 'AI 任务不存在或已过期。', false, 404);
    return jsonOk(publicJobState(refreshed), 200, id);
  } catch (error) {
    console.warn('[ai-optimize]', {
      code: error instanceof Error && error.name === 'AiHttpError' ? (error as AiHttpError).code : 'AI_INTERNAL_ERROR',
      event: 'query_failed',
      requestId: id,
      status: error instanceof Error ? errorStatus(error) : 500,
    });
    return jsonError(error, id);
  }
}
