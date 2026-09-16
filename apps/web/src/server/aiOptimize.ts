import { createHash, createHmac, randomUUID } from 'node:crypto';

export const VOLC_API_HOST = 'visual.volcengineapi.com';
export const VOLC_API_REGION = 'cn-north-1';
export const VOLC_API_SERVICE = 'cv';
export const VOLC_API_VERSION = '2022-08-31';
export const VOLC_SUBMIT_ACTION = 'CVSync2AsyncSubmitTask';
export const VOLC_RESULT_ACTION = 'CVSync2AsyncGetResult';
export const VOLC_REQUEST_KEY = 'jimeng_t2i_v40';

export const MAX_AI_PROMPT_CHARS = 800;
export const MAX_AI_IMAGE_BYTES = 4 * 1024 * 1024;
export const AI_JOB_TTL_MS = 20 * 60 * 1000;
export const MAX_ACTIVE_JOBS_PER_CLIENT = 2;
export const AI_RATE_LIMIT_CAPACITY = 8;
export const AI_RATE_LIMIT_WINDOW_MS = 60_000;
export const MAX_AI_JOBS = 128;
export const MAX_GLOBAL_ACTIVE_JOBS = 16;
export const MAX_GLOBAL_SUBMISSIONS = 32;
export const MAX_RATE_BUCKETS = 2048;
export const AI_BUCKET_TTL_MS = 5 * 60_000;
export const AI_POLL_INTERVAL_MS = 2000;
export const AI_PROVIDER_TIMEOUT_MS = 30_000;
export const MAX_PROVIDER_CONCURRENCY = 8;

export type AiJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface AiErrorEnvelope {
  code: string;
  message: string;
  retryAfterMs?: number;
  retryable: boolean;
}

export interface AiJobPublicState {
  createdAt: number;
  error?: AiErrorEnvelope;
  imageDataUrl?: string;
  imageUrl?: string;
  jobId: string;
  status: AiJobStatus;
  updatedAt: number;
}

interface AiJobRecord extends AiJobPublicState {
  clientKey: string;
  quotaKey: string;
  providerTaskId?: string;
  requestId: string;
}

export interface AiOptimizationInput {
  imageBase64: string;
  mediaType: 'image/jpeg' | 'image/png';
  prompt: string;
}

export interface VolcCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface VolcRequestOptions {
  body: string;
  credentials: VolcCredentials;
  dateTime: string;
  method: string;
  pathName: string;
  query: Record<string, string>;
}

export interface VolcProviderResult {
  error?: AiErrorEnvelope;
  imageDataUrl?: string;
  imageUrl?: string;
  status: Exclude<AiJobStatus, 'queued'>;
}

interface RateBucket {
  tokens: number;
  updatedAt: number;
}

const headerKeysToIgnore = new Set(['authorization', 'content-length', 'user-agent']);

function now(): number {
  return Date.now();
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmacSha256(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function toAmzDate(date = new Date()): string {
  return date.toISOString().replace(/[:\-]|\.\d{3}/g, '');
}

function uriEscape(value: string): string {
  return encodeURIComponent(value).replace(/[!*'()]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function queryParamsToString(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map(key => `${uriEscape(key)}=${uriEscape(params[key] ?? '')}`)
    .join('&');
}

function canonicalHeaders(headers: Record<string, string>): { canonical: string; signedHeaders: string } {
  const normalized = Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase(), value.trim().replace(/\s+/g, ' ')] as const)
    .filter(([key]) => !headerKeysToIgnore.has(key))
    .sort(([left], [right]) => left.localeCompare(right));
  return {
    canonical: `${normalized.map(([key, value]) => `${key}:${value}`).join('\n')}\n`,
    signedHeaders: normalized.map(([key]) => key).join(';'),
  };
}

export function createVolcAuthorization(options: VolcRequestOptions): { authorization: string; contentSha256: string } {
  const contentSha256 = sha256Hex(options.body);
  const date = options.dateTime.slice(0, 8);
  const headers = {
    host: VOLC_API_HOST,
    'content-type': 'application/json',
    'x-content-sha256': contentSha256,
    'x-date': options.dateTime,
  };
  const signed = canonicalHeaders(headers);
  const canonicalRequest = [
    options.method.toUpperCase(),
    options.pathName,
    queryParamsToString(options.query),
    signed.canonical,
    signed.signedHeaders,
    contentSha256,
  ].join('\n');
  const credentialScope = [date, VOLC_API_REGION, VOLC_API_SERVICE, 'request'].join('/');
  const stringToSign = [
    'HMAC-SHA256',
    options.dateTime,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const kDate = hmacSha256(options.credentials.secretAccessKey, date);
  const kRegion = hmacSha256(kDate, VOLC_API_REGION);
  const kService = hmacSha256(kRegion, VOLC_API_SERVICE);
  const kSigning = hmacSha256(kService, 'request');
  const signature = hmacSha256(kSigning, stringToSign).toString('hex');
  return {
    authorization: [
      'HMAC-SHA256',
      `Credential=${options.credentials.accessKeyId}/${credentialScope},`,
      `SignedHeaders=${signed.signedHeaders},`,
      `Signature=${signature}`,
    ].join(' '),
    contentSha256,
  };
}

export function getCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): VolcCredentials {
  const accessKeyId = env.VOLC_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.VOLC_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) {
    throw aiError('AI_CONFIG_MISSING', 'AI 服务未配置，请在服务器设置 VOLC_ACCESS_KEY_ID 和 VOLC_SECRET_ACCESS_KEY。', false, 500);
  }
  return { accessKeyId, secretAccessKey };
}

export class AiHttpError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly status: number;

  constructor(status: number, code: string, message: string, retryable: boolean, retryAfterMs?: number) {
    super(message);
    this.name = 'AiHttpError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}

export function aiError(
  code: string,
  message: string,
  retryable: boolean,
  status = 400,
  retryAfterMs?: number,
): AiHttpError {
  return new AiHttpError(status, code, message, retryable, retryAfterMs);
}

function estimateBase64Bytes(value: string): number {
  const compact = value.replace(/\s+/g, '');
  const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
  return Math.floor(compact.length * 3 / 4) - padding;
}

function detectImageMediaType(bytes: Buffer): AiOptimizationInput['mediaType'] | null {
  const isPng = bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  if (isPng) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

export function parseAiOptimizationInput(value: unknown): AiOptimizationInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw aiError('BAD_JSON', '请求体必须是 JSON 对象。', false);
  }
  const body = value as Record<string, unknown>;
  if (typeof body.prompt !== 'string') throw aiError('BAD_PROMPT', 'prompt 必须是字符串。', false);
  const prompt = body.prompt.trim();
  if (!prompt) throw aiError('BAD_PROMPT', 'prompt 不能为空。', false);
  if (prompt.length > MAX_AI_PROMPT_CHARS) throw aiError('BAD_PROMPT', `prompt 不能超过 ${MAX_AI_PROMPT_CHARS} 个字符。`, false);
  if (typeof body.imageBase64 !== 'string') throw aiError('BAD_IMAGE', 'imageBase64 必须是字符串。', false);
  const trimmedImage = body.imageBase64.trim();
  const dataUrlMatch = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=\s]+)$/i.exec(trimmedImage);
  const mediaType = dataUrlMatch?.[1]?.toLowerCase() as AiOptimizationInput['mediaType'] | undefined;
  const rawBase64 = dataUrlMatch?.[2] ?? trimmedImage;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(rawBase64) || rawBase64.replace(/\s+/g, '').length === 0) {
    throw aiError('BAD_IMAGE', '图片必须是 JPEG/PNG data URL 或 base64。', false, 415);
  }
  const compactBase64 = rawBase64.replace(/\s+/g, '');
  if (compactBase64.length % 4 !== 0 || /={3,}/.test(compactBase64) || /=[A-Za-z0-9+/]/.test(compactBase64)) {
    throw aiError('BAD_IMAGE', '图片 Base64 编码无效。', false, 415);
  }
  const imageBytes = estimateBase64Bytes(compactBase64);
  if (imageBytes <= 0) throw aiError('BAD_IMAGE', '图片数据为空。', false, 415);
  if (imageBytes > MAX_AI_IMAGE_BYTES) {
    throw aiError('IMAGE_TOO_LARGE', `图片不能超过 ${Math.round(MAX_AI_IMAGE_BYTES / 1024 / 1024)}MB。`, false, 413);
  }
  const decoded = Buffer.from(compactBase64, 'base64');
  const detectedMediaType = detectImageMediaType(decoded);
  if (!detectedMediaType || (mediaType && mediaType !== detectedMediaType)) {
    throw aiError('BAD_IMAGE', '图片内容必须是匹配的 JPEG 或 PNG。', false, 415);
  }
  return {
    imageBase64: compactBase64,
    mediaType: detectedMediaType,
    prompt,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function providerBusinessError(value: Record<string, unknown>): AiErrorEnvelope | null {
  const rawCode = value.code ?? value.Code ?? value.status;
  const code = String(rawCode ?? '');
  const message = String(value.message ?? value.Message ?? '');
  if (code === '50411' || /risk/i.test(message)) {
    return { code: 'IMAGE_RISK', message: '图片未能通过安全检测，请尝试使用其他图片。', retryable: false };
  }
  if (/^\d+$/.test(code) && code !== '10000' && code !== '0') {
    return { code: 'PROVIDER_ERROR', message: 'AI 服务返回失败，请稍后重试。', retryable: /^5|429$/.test(code) };
  }
  return null;
}

export function parseVolcSubmitResponse(value: unknown): string {
  const response = asRecord(value);
  const businessError = providerBusinessError(response);
  if (businessError) throw aiError(businessError.code, businessError.message, businessError.retryable, businessError.retryable ? 502 : 400);
  const data = asRecord(response.data ?? response.Data);
  const taskId = data.task_id ?? response.task_id;
  if (typeof taskId !== 'string' || taskId.length === 0) {
    throw aiError('PROVIDER_BAD_RESPONSE', 'AI 服务返回缺少任务 ID。', true, 502);
  }
  return taskId;
}

export function parseVolcResultResponse(value: unknown): VolcProviderResult {
  const response = asRecord(value);
  const businessError = providerBusinessError(response);
  if (businessError) return { error: businessError, status: 'failed' };
  const data = asRecord(response.data ?? response.Data);
  const rawStatus = String(data.status ?? data.task_status ?? response.status ?? '').toLowerCase();
  if (rawStatus === 'not_found' || rawStatus === 'expired') {
    return {
      error: { code: 'JOB_EXPIRED', message: 'AI 任务已过期，请重新提交。', retryable: false },
      status: 'failed',
    };
  }
  if (rawStatus === 'failed' || rawStatus === 'fail') {
    return {
      error: { code: 'PROVIDER_TASK_FAILED', message: 'AI 任务失败，请稍后重试。', retryable: true },
      status: 'failed',
    };
  }
  const imageUrls = data.image_urls ?? data.images;
  const firstUrl = Array.isArray(imageUrls)
    ? typeof imageUrls[0] === 'string'
      ? imageUrls[0]
      : asRecord(imageUrls[0]).url
    : undefined;
  const imageBase64 = Array.isArray(data.binary_data_base64)
    ? data.binary_data_base64[0]
    : data.binary_data_base64;
  if (typeof firstUrl === 'string' && firstUrl.length > 0) return { imageUrl: firstUrl, status: 'succeeded' };
  if (typeof imageBase64 === 'string' && imageBase64.length > 0) {
    return { imageDataUrl: `data:image/png;base64,${imageBase64}`, status: 'succeeded' };
  }
  if (rawStatus === 'succeeded' || rawStatus === 'success' || rawStatus === 'done') {
    return {
      error: { code: 'PROVIDER_BAD_RESPONSE', message: 'AI 服务返回成功但缺少图片。', retryable: true },
      status: 'failed',
    };
  }
  return { status: 'running' };
}

export async function callVolcApi(
  action: string,
  payload: Record<string, unknown>,
  credentials: VolcCredentials,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<unknown> {
  const body = JSON.stringify(payload);
  const query = { Action: action, Version: VOLC_API_VERSION };
  const dateTime = toAmzDate();
  const signature = createVolcAuthorization({
    body,
    credentials,
    dateTime,
    method: 'POST',
    pathName: '/',
    query,
  });
  const response = await fetchImpl(`https://${VOLC_API_HOST}/?${queryParamsToString(query)}`, {
    body,
    headers: {
      Authorization: signature.authorization,
      'Content-Type': 'application/json',
      Host: VOLC_API_HOST,
      'X-Content-Sha256': signature.contentSha256,
      'X-Date': dateTime,
    },
    method: 'POST',
    signal,
  });
  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw aiError('PROVIDER_BAD_RESPONSE', 'AI 服务返回了无法解析的响应。', true, 502);
  }
  if (!response.ok) {
    const businessError = providerBusinessError(asRecord(json));
    if (businessError) throw aiError(businessError.code, businessError.message, businessError.retryable, businessError.retryable ? 502 : 400);
    if (response.status === 429) throw aiError('PROVIDER_RATE_LIMITED', 'AI 服务繁忙，请稍后重试。', true, 502, 30_000);
    throw aiError('PROVIDER_HTTP_ERROR', 'AI 服务请求失败，请稍后重试。', response.status >= 500, 502);
  }
  return json;
}

export async function submitVolcTask(
  input: AiOptimizationInput,
  credentials: VolcCredentials,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
): Promise<string> {
  const response = await callVolcApi(VOLC_SUBMIT_ACTION, {
    binary_data_base64: [input.imageBase64],
    force_single: true,
    prompt: input.prompt,
    req_key: VOLC_REQUEST_KEY,
    scale: 0.5,
  }, credentials, fetchImpl, signal);
  return parseVolcSubmitResponse(response);
}

export async function queryVolcTask(
  taskId: string,
  credentials: VolcCredentials,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
): Promise<VolcProviderResult> {
  const response = await callVolcApi(VOLC_RESULT_ACTION, {
    req_key: VOLC_REQUEST_KEY,
    task_id: taskId,
  }, credentials, fetchImpl, signal);
  return parseVolcResultResponse(response);
}

export class InMemoryAiJobStore {
  private readonly jobs = new Map<string, AiJobRecord>();
  private readonly rateBuckets = new Map<string, RateBucket>();
  private readonly globalBucket: RateBucket = { tokens: MAX_GLOBAL_SUBMISSIONS, updatedAt: 0 };
  private providerCalls = 0;
  private readonly polls = new Map<string, { nextAt: number; pending?: Promise<AiJobRecord | null> }>();

  constructor(private readonly clock: () => number = now) {}

  create(input: { clientKey: string; quotaKey?: string; requestId: string }): AiJobRecord {
    this.cleanupExpired();
    if (this.jobs.size >= MAX_AI_JOBS) throw aiError('AI_CAPACITY', 'AI 服务容量已满，请稍后重试。', true, 429, 60_000);
    if (this.countActive() >= MAX_GLOBAL_ACTIVE_JOBS) throw aiError('AI_BUSY', 'AI 服务繁忙，请稍后重试。', true, 429, 15_000);
    const quotaKey = input.quotaKey ?? 'ip:shared';
    const activeForQuota = [...this.jobs.values()].filter(job => job.quotaKey === quotaKey && (job.status === 'queued' || job.status === 'running')).length;
    if (this.countActive(input.clientKey) >= MAX_ACTIVE_JOBS_PER_CLIENT || activeForQuota >= MAX_ACTIVE_JOBS_PER_CLIENT) {
      throw aiError('TOO_MANY_ACTIVE_JOBS', '当前已有 AI 任务在处理中，请等待完成后再提交。', true, 429, 15_000);
    }
    const timestamp = this.clock();
    const job: AiJobRecord = {
      clientKey: input.clientKey,
      quotaKey,
      createdAt: timestamp,
      jobId: randomUUID(),
      requestId: input.requestId,
      status: 'queued',
      updatedAt: timestamp,
    };
    this.jobs.set(job.jobId, job);
    return job;
  }

  get(jobId: string): AiJobRecord | null {
    this.cleanupExpired();
    return this.jobs.get(jobId) ?? null;
  }

  getForClient(jobId: string, clientKey: string): AiJobRecord | null {
    const job = this.get(jobId);
    return job?.clientKey === clientKey ? job : null;
  }

  update(jobId: string, patch: Partial<Omit<AiJobRecord, 'jobId' | 'createdAt' | 'requestId' | 'clientKey' | 'quotaKey'>>): AiJobRecord | null {
    const job = this.get(jobId);
    if (!job) return null;
    const updated = { ...job, ...patch, updatedAt: this.clock() };
    this.jobs.set(jobId, updated);
    return updated;
  }

  countActive(clientKey?: string): number {
    this.cleanupExpired();
    let count = 0;
    for (const job of this.jobs.values()) {
      if ((clientKey === undefined || job.clientKey === clientKey) && (job.status === 'queued' || job.status === 'running')) count += 1;
    }
    return count;
  }

  takeToken(clientKey: string): { allowed: boolean; retryAfterMs?: number } {
    this.cleanupExpired();
    let bucket = this.rateBuckets.get(clientKey);
    if (!bucket) {
      if (this.rateBuckets.size >= MAX_RATE_BUCKETS) return { allowed: false, retryAfterMs: AI_BUCKET_TTL_MS };
      bucket = { tokens: AI_RATE_LIMIT_CAPACITY, updatedAt: this.clock() };
      this.rateBuckets.set(clientKey, bucket);
    }
    return this.consume(bucket, AI_RATE_LIMIT_CAPACITY);
  }

  takeGlobalToken(): { allowed: boolean; retryAfterMs?: number } {
    return this.consume(this.globalBucket, MAX_GLOBAL_SUBMISSIONS);
  }

  private consume(bucket: RateBucket, capacity: number): { allowed: boolean; retryAfterMs?: number } {
    const timestamp = this.clock();
    bucket.tokens = Math.min(capacity, bucket.tokens + Math.max(0, timestamp - bucket.updatedAt) * capacity / AI_RATE_LIMIT_WINDOW_MS);
    bucket.updatedAt = timestamp;
    if (bucket.tokens + 1e-9 < 1) return { allowed: false, retryAfterMs: Math.ceil((1 - bucket.tokens) * AI_RATE_LIMIT_WINDOW_MS / capacity) };
    bucket.tokens = Math.max(0, bucket.tokens - 1);
    return { allowed: true };
  }

  async runProvider<T>(jobId: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const job = this.get(jobId);
    if (!job) throw aiError('JOB_EXPIRED', 'AI 任务已过期，请重新提交。', false, 404);
    if (this.providerCalls >= MAX_PROVIDER_CONCURRENCY) throw aiError('AI_BUSY', 'AI 服务繁忙，请稍后重试。', true, 429, AI_POLL_INTERVAL_MS);
    this.providerCalls += 1;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(() => operation(controller.signal)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(aiError('AI_TIMEOUT', 'AI 服务请求超时，请重试。', true, 504));
          }, Math.max(1, Math.min(AI_PROVIDER_TIMEOUT_MS, job.createdAt + AI_JOB_TTL_MS - this.clock())));
        }),
      ]);
    } finally {
      clearTimeout(timer);
      this.providerCalls -= 1;
    }
  }

  poll(jobId: string, operation: () => Promise<AiJobRecord | null>): Promise<AiJobRecord | null> {
    const job = this.get(jobId);
    if (!job || job.status !== 'running') return Promise.resolve(job);
    const previous = this.polls.get(jobId);
    if (previous?.pending) return previous.pending;
    if (previous && previous.nextAt > this.clock()) return Promise.resolve(job);
    const entry: { nextAt: number; pending?: Promise<AiJobRecord | null> } = { nextAt: this.clock() + AI_POLL_INTERVAL_MS };
    entry.pending = Promise.resolve().then(operation).finally(() => {
      entry.pending = undefined;
      entry.nextAt = this.clock() + AI_POLL_INTERVAL_MS;
    });
    this.polls.set(jobId, entry);
    return entry.pending;
  }

  private cleanupExpired(): void {
    const cutoff = this.clock() - AI_JOB_TTL_MS;
    for (const [jobId, job] of this.jobs) {
      if (job.createdAt <= cutoff) {
        this.jobs.delete(jobId);
        this.polls.delete(jobId);
      }
    }
    for (const [key, bucket] of this.rateBuckets) {
      if (bucket.updatedAt <= this.clock() - AI_BUCKET_TTL_MS) this.rateBuckets.delete(key);
    }
  }
}

export const aiJobStore = new InMemoryAiJobStore();

export function publicJobState(job: AiJobRecord): AiJobPublicState {
  return {
    createdAt: job.createdAt,
    ...(job.error ? { error: job.error } : {}),
    ...(job.imageDataUrl ? { imageDataUrl: job.imageDataUrl } : {}),
    ...(job.imageUrl ? { imageUrl: job.imageUrl } : {}),
    jobId: job.jobId,
    status: job.status,
    updatedAt: job.updatedAt,
  };
}

export async function submitProviderTaskForJob(
  jobId: string,
  input: AiOptimizationInput,
  credentials: VolcCredentials,
  fetchImpl?: typeof fetch,
): Promise<void> {
  try {
    const providerTaskId = await aiJobStore.runProvider(jobId, signal => submitVolcTask(input, credentials, fetchImpl, signal));
    aiJobStore.update(jobId, { providerTaskId, status: 'running' });
  } catch (error) {
    const err = error instanceof AiHttpError
      ? { code: error.code, message: error.message, retryAfterMs: error.retryAfterMs, retryable: error.retryable }
      : { code: 'AI_SUBMIT_FAILED', message: 'AI 任务提交失败，请稍后重试。', retryable: true };
    aiJobStore.update(jobId, { error: err, status: 'failed' });
  }
}

export async function refreshProviderJob(
  jobId: string,
  credentials: VolcCredentials,
  fetchImpl?: typeof fetch,
): Promise<AiJobRecord | null> {
  return aiJobStore.poll(jobId, async () => {
    const job = aiJobStore.get(jobId);
    if (!job || job.status !== 'running' || !job.providerTaskId) return job;
    const providerTaskId = job.providerTaskId;
    try {
      const result = await aiJobStore.runProvider(jobId, signal => queryVolcTask(providerTaskId, credentials, fetchImpl, signal));
      if (result.status === 'succeeded') {
        return aiJobStore.update(jobId, {
          imageDataUrl: result.imageDataUrl,
          imageUrl: result.imageUrl,
          status: 'succeeded',
        });
      }
      if (result.status === 'failed') {
        return aiJobStore.update(jobId, {
          error: result.error ?? { code: 'PROVIDER_TASK_FAILED', message: 'AI 任务失败，请稍后重试。', retryable: true },
          status: 'failed',
        });
      }
      return aiJobStore.update(jobId, { status: 'running' });
    } catch (error) {
      if (error instanceof AiHttpError && error.code === 'AI_BUSY') return aiJobStore.get(jobId);
      const err = error instanceof AiHttpError
        ? { code: error.code, message: error.message, retryAfterMs: error.retryAfterMs, retryable: error.retryable }
        : { code: 'AI_QUERY_FAILED', message: 'AI 任务查询失败，请稍后重试。', retryable: true };
      return aiJobStore.update(jobId, { error: err, status: 'failed' });
    }
  });
}

export function requestId(): string {
  return randomUUID();
}
