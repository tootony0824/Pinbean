import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

export const AI_SESSION_COOKIE = 'pinbean-ai-session';
export const AI_SESSION_MAX_AGE = 24 * 60 * 60;
const sessionSecret = randomBytes(32);

function signature(payload: string): string {
  return createHmac('sha256', sessionSecret).update(payload).digest('hex');
}

export function issueAiSession(timestamp = Date.now()): string {
  const payload = `${randomBytes(32).toString('hex')}.${timestamp + AI_SESSION_MAX_AGE * 1000}`;
  return `${payload}.${signature(payload)}`;
}

export function verifyAiSession(value: string | undefined, timestamp = Date.now()): string | null {
  if (!value || !/^[a-f0-9]{64}\.\d{13}\.[a-f0-9]{64}$/.test(value)) return null;
  const [id, expires, mac] = value.split('.');
  if (Number(expires) <= timestamp || Number(expires) > timestamp + AI_SESSION_MAX_AGE * 1000) return null;
  return timingSafeEqual(Buffer.from(signature(`${id}.${expires}`), 'hex'), Buffer.from(mac, 'hex')) ? id : null;
}

// Request exposes no peer socket: enable only behind an isolated, header-overwriting proxy.
export function aiQuotaKey(headers: Headers, env: NodeJS.ProcessEnv = process.env): string {
  if (env.AI_PROXY_MODE !== 'closed-proxy') return 'ip:shared';
  const value = headers.get('x-forwarded-for')?.trim();
  if (!value || value.includes('%') || !isIP(value)) return 'ip:shared';
  let normalized = isIP(value) === 6 ? new URL(`http://[${value}]/`).hostname.slice(1, -1) : value;
  const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(normalized);
  if (mapped) {
    const bytes = (parseInt(mapped[1], 16) * 65536 + parseInt(mapped[2], 16)) >>> 0;
    normalized = [bytes >>> 24, (bytes >>> 16) & 255, (bytes >>> 8) & 255, bytes & 255].join('.');
  }
  return `ip:${normalized}`;
}
