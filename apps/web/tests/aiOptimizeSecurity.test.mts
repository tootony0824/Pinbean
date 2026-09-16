import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { GET, POST } from '../src/app/api/ai-optimize/route';
import {
  AI_BUCKET_TTL_MS, AI_JOB_TTL_MS, AI_POLL_INTERVAL_MS, AI_RATE_LIMIT_CAPACITY,
  AI_RATE_LIMIT_WINDOW_MS, AiHttpError, InMemoryAiJobStore, MAX_AI_JOBS,
  MAX_GLOBAL_ACTIVE_JOBS, MAX_GLOBAL_SUBMISSIONS, MAX_PROVIDER_CONCURRENCY,
  MAX_RATE_BUCKETS, aiJobStore, refreshProviderJob,
} from '../src/server/aiOptimize';
import { AI_SESSION_COOKIE, AI_SESSION_MAX_AGE, aiQuotaKey, issueAiSession, verifyAiSession } from '../src/server/aiSession';

const isCode = (code: string) => (error: unknown) => error instanceof AiHttpError && error.code === code;

test('proxy headers are untrusted by default; closed mode validates and normalizes one IP', () => {
  const headers = (ip: string) => new Headers({ 'x-forwarded-for': ip, 'x-real-ip': '1.2.3.4' });
  assert.equal(aiQuotaKey(headers('1.2.3.4'), {}), 'ip:shared');
  const env = { AI_PROXY_MODE: 'closed-proxy' };
  for (const value of ['1.2.3.4, 5.6.7.8', '1.2.3.4:80', '[::1]', 'fe80::1%eth0', 'arbitrary', '']) {
    assert.equal(aiQuotaKey(headers(value), env), 'ip:shared');
  }
  assert.equal(aiQuotaKey(new Headers({ 'x-real-ip': '1.2.3.4' }), env), 'ip:shared');
  assert.equal(aiQuotaKey(headers('2001:0DB8:0:0:0:0:0:1'), env), 'ip:2001:db8::1');
  assert.equal(aiQuotaKey(headers('::ffff:192.0.2.1'), env), 'ip:192.0.2.1');
});

test('anonymous session signatures reject tampering, expiry and arbitrary identities', () => {
  const time = 1_800_000_000_000;
  const cookie = issueAiSession(time);
  assert(verifyAiSession(cookie, time));
  assert.notEqual(verifyAiSession(cookie, time), verifyAiSession(issueAiSession(time), time));
  assert.equal(verifyAiSession(cookie.slice(0, -1) + (cookie.endsWith('0') ? '1' : '0'), time), null);
  assert.equal(verifyAiSession(cookie, time + AI_SESSION_MAX_AGE * 1000), null);
  assert.equal(verifyAiSession('client-a', time), null);
});

test('quota buckets refill fractionally under repeated rejection, expire and never evict live keys at capacity', () => {
  let time = 1_800_000_000_000;
  const store = new InMemoryAiJobStore(() => time);
  for (let i = 0; i < AI_RATE_LIMIT_CAPACITY; i++) assert(store.takeToken('same').allowed);
  for (let i = 0; i < 7; i++) { time += 1000; assert.equal(store.takeToken('same').allowed, false); }
  time += 500;
  assert(store.takeToken('same').allowed);
  for (let i = 1; i < MAX_RATE_BUCKETS; i++) assert(store.takeToken(`key-${i}`).allowed);
  assert.equal(store.takeToken('overflow').allowed, false);
  assert.equal(store.takeToken('same').allowed, false);
  time += AI_BUCKET_TTL_MS;
  assert(store.takeToken('overflow').allowed);
  for (let i = 0; i < MAX_GLOBAL_SUBMISSIONS; i++) assert(store.takeGlobalToken().allowed);
  assert.equal(store.takeGlobalToken().allowed, false);
  time += AI_RATE_LIMIT_WINDOW_MS;
  assert(store.takeGlobalToken().allowed);
});

test('session/IP active caps and global job capacity survive rotating identities', () => {
  const store = new InMemoryAiJobStore();
  const create = (client: string, ip: string) => store.create({ clientKey: client, quotaKey: ip, requestId: 'test' });
  const a = create('a', 'ip-a');
  create('b', 'ip-a');
  assert.throws(() => create('c', 'ip-a'), isCode('TOO_MANY_ACTIVE_JOBS'));
  create('a', 'ip-b');
  assert.throws(() => create('a', 'ip-c'), isCode('TOO_MANY_ACTIVE_JOBS'));
  for (let i = 3; i < MAX_GLOBAL_ACTIVE_JOBS; i++) create(`client-${i}`, `ip-${i}`);
  assert.throws(() => create('new', 'new'), isCode('AI_BUSY'));
  store.update(a.jobId, { status: 'succeeded' });
  create('new', 'new');
  const capacity = new InMemoryAiJobStore();
  for (let i = 0; i < MAX_AI_JOBS; i++) {
    const job = capacity.create({ clientKey: 'a', requestId: 'test' });
    capacity.update(job.jobId, { status: 'failed' });
  }
  assert.throws(() => capacity.create({ clientKey: 'a', requestId: 'test' }), isCode('AI_CAPACITY'));
});

test('task absolute deadline defeats refreshes and late updates; provider calls abort at remaining deadline', async () => {
  let time = 1_800_000_000_000;
  const store = new InMemoryAiJobStore(() => time);
  const job = store.create({ clientKey: 'a', requestId: 'test' });
  time += AI_JOB_TTL_MS - 10;
  store.update(job.jobId, { status: 'running' });
  let signal: AbortSignal | undefined;
  await assert.rejects(store.runProvider(job.jobId, incoming => {
    signal = incoming;
    return new Promise(() => {});
  }), isCode('AI_TIMEOUT'));
  assert.equal(signal?.aborted, true);
  time += 10;
  assert.equal(store.get(job.jobId), null);
  assert.equal(store.update(job.jobId, { status: 'succeeded', imageUrl: 'late' }), null);
});

test('provider concurrency has no unbounded queue and releases slots on completion', async () => {
  const store = new InMemoryAiJobStore();
  const job = store.create({ clientKey: 'a', requestId: 'test' });
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const calls = Array.from({ length: MAX_PROVIDER_CONCURRENCY }, () => store.runProvider(job.jobId, () => gate));
  await assert.rejects(store.runProvider(job.jobId, async () => {}), isCode('AI_BUSY'));
  finish();
  await Promise.all(calls);
  await store.runProvider(job.jobId, async () => {});
});

test('provider polling coalesces in-flight requests and throttles completed running responses', async () => {
  const job = aiJobStore.create({ clientKey: 'poll', quotaKey: 'poll', requestId: 'test' });
  aiJobStore.update(job.jobId, { providerTaskId: 'stub-task', status: 'running' });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  const stub: typeof fetch = async () => {
    calls++;
    await gate;
    return Response.json({ data: { status: 'running' } });
  };
  const credentials = { accessKeyId: 'stub', secretAccessKey: 'stub' };
  const pending = Array.from({ length: 20 }, () => refreshProviderJob(job.jobId, credentials, stub));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  await Promise.all(pending);
  await refreshProviderJob(job.jobId, credentials, stub);
  assert.equal(calls, 1);
  aiJobStore.update(job.jobId, { status: 'failed' });
  let time = 1_800_000_000_000;
  const store = new InMemoryAiJobStore(() => time);
  const timed = store.create({ clientKey: 'a', requestId: 'test' });
  store.update(timed.jobId, { status: 'running' });
  let polls = 0;
  const poll = () => { polls++; return Promise.resolve(store.get(timed.jobId)); };
  await store.poll(timed.jobId, poll);
  await store.poll(timed.jobId, poll);
  assert.equal(polls, 1);
  time += AI_POLL_INTERVAL_MS;
  await store.poll(timed.jobId, poll);
  assert.equal(polls, 2);
});

test('route stub preserves API and signed ownership across IP changes, with production and dev cookie flags', async () => {
  const saved = { ...process.env };
  const originalFetch = globalThis.fetch;
  const jobs: string[] = [];
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    assert(options?.signal);
    return Response.json({ data: { task_id: 'stub-only' } });
  };
  const post = (ip: string) => POST(new NextRequest('https://example.test/api/ai-optimize', {
    method: 'POST', body: JSON.stringify({ imageBase64: 'iVBORw0KGgo=', prompt: 'test' }),
    headers: { origin: 'https://example.test', 'content-type': 'application/json', 'x-pinbean-ai-request': '1', 'x-forwarded-for': ip },
  }));
  const get = (jobId: string, cookie: string, ip: string) => GET(new NextRequest(`https://example.test/api/ai-optimize?jobId=${jobId}`, {
    headers: { cookie, 'x-pinbean-ai-request': '1', 'x-forwarded-for': ip },
  }));
  try {
    process.env.NODE_ENV = 'production';
    process.env.AI_PROXY_MODE = 'closed-proxy';
    process.env.AI_ALLOWED_ORIGINS = 'https://example.test';
    process.env.VOLC_ACCESS_KEY_ID = 'stub';
    process.env.VOLC_SECRET_ACCESS_KEY = 'stub';
    const first = await post('192.0.2.10');
    assert.equal(first.status, 202);
    const firstId = (await first.json()).data.jobId;
    jobs.push(firstId);
    const setCookie = first.headers.get('set-cookie')!;
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /SameSite=strict/i);
    assert.match(setCookie, /Path=\/api\/ai-optimize/);
    const cookie = setCookie.split(';')[0];
    const second = await post('192.0.2.10');
    assert.equal(second.status, 202);
    const secondId = (await second.json()).data.jobId;
    jobs.push(secondId);
    const cookie2 = second.headers.get('set-cookie')!.split(';')[0];
    await new Promise(resolve => setImmediate(resolve));
    aiJobStore.update(firstId, { status: 'succeeded', imageUrl: 'https://example.test/stub.png' });
    assert.equal((await get(firstId, cookie2, '192.0.2.10')).status, 404);
    assert.equal((await get(firstId, '', '192.0.2.10')).status, 404);
    assert.equal((await get(firstId, `${AI_SESSION_COOKIE}=forged`, '192.0.2.10')).status, 404);
    const own = await get(firstId, cookie, '198.51.100.10');
    assert.equal(own.status, 200);
    assert.equal(own.headers.get('cache-control'), 'no-store');
    const body = await own.json();
    assert.equal(body.data.imageUrl, 'https://example.test/stub.png');
    assert.equal(body.data.clientKey, undefined);
    assert.equal(body.data.providerTaskId, undefined);
    process.env.NODE_ENV = 'development';
    const dev = await post('192.0.2.11');
    assert.equal(dev.status, 202);
    jobs.push((await dev.json()).data.jobId);
    assert.doesNotMatch(dev.headers.get('set-cookie')!, /; Secure/i);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 3);
  } finally {
    for (const id of jobs) aiJobStore.update(id, { status: 'failed' });
    globalThis.fetch = originalFetch;
    for (const key of ['NODE_ENV', 'AI_PROXY_MODE', 'AI_ALLOWED_ORIGINS', 'VOLC_ACCESS_KEY_ID', 'VOLC_SECRET_ACCESS_KEY']) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  }
});

test('route fallback rejects rotating forged XFF and cookies; body cap rejects before provider', async () => {
  const saved = { ...process.env };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('provider must not be called'); };
  const send = (ip: string, extra: Record<string, string> = {}) => POST(new NextRequest('http://localhost/api/ai-optimize', {
    method: 'POST', body: '{}', headers: {
      'content-type': 'application/json', 'x-pinbean-ai-request': '1',
      'x-forwarded-for': ip, cookie: `${AI_SESSION_COOKIE}=forged-${ip}`, ...extra,
    },
  }));
  try {
    delete process.env.AI_PROXY_MODE;
    delete process.env.AI_ALLOWED_ORIGINS;
    process.env.VOLC_ACCESS_KEY_ID = 'stub';
    process.env.VOLC_SECRET_ACCESS_KEY = 'stub';
    const oversized = await send('192.0.2.100', { 'content-length': '99999999' });
    assert.equal(oversized.status, 413);
    for (let i = 1; i < AI_RATE_LIMIT_CAPACITY; i++) assert.equal((await send(`192.0.2.${100 + i}`)).status, 400);
    const limited = await send('203.0.113.1');
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error.code, 'RATE_LIMITED');
    assert(limited.headers.get('retry-after'));
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of ['AI_PROXY_MODE', 'AI_ALLOWED_ORIGINS', 'VOLC_ACCESS_KEY_ID', 'VOLC_SECRET_ACCESS_KEY']) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  }
});

test('production template overwrites address headers and default start binds loopback', () => {
  const nginx = readFileSync(new URL('../deploy/nginx.conf', import.meta.url), 'utf8');
  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:3000/);
  assert.match(nginx, /proxy_set_header X-Forwarded-For \$remote_addr;/);
  assert.match(nginx, /proxy_set_header X-Real-IP \$remote_addr;/);
  assert.doesNotMatch(nginx, /proxy_add_x_forwarded_for|try_files/);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts.start, /-H 127\.0\.0\.1/);
});
