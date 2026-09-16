/**
 * Login rate limiting (F9).
 *
 * Two counters guard the shared password: one per client address, and a global
 * one so a distributed attempt cannot simply spread itself across addresses.
 * Both use a fixed 15-minute window — INCR the key, and set the expiry on the
 * first increment so the window starts with the first attempt.
 *
 * With Upstash configured the counters are shared across every serverless
 * instance. Locally (file storage) they are per-process, which is all a single
 * dev server needs.
 */
import { getUpstash } from './upstash.js';

export const WINDOW_SECONDS = 15 * 60;
export const PER_IP_LIMIT = 10;
export const GLOBAL_LIMIT = 100;

const PREFIX = 'wedding-planner:rl:';

const memory = new Map();

/** Exported for tests; also keeps a long-lived dev server from leaking keys. */
export function resetMemoryLimiter() {
  memory.clear();
}

function memoryIncrement(key, now) {
  const entry = memory.get(key);
  if (!entry || entry.expiresAt <= now) {
    const fresh = { count: 1, expiresAt: now + WINDOW_SECONDS * 1000 };
    memory.set(key, fresh);
    return fresh;
  }
  entry.count += 1;
  return entry;
}

function sweep(now) {
  for (const [key, entry] of memory) {
    if (entry.expiresAt <= now) memory.delete(key);
  }
}

/**
 * The first entry of x-forwarded-for is the client as seen by the edge; the
 * rest are proxies and are attacker-controlled, so only the first is used.
 */
export function clientAddress(req) {
  const forwarded = req?.headers?.['x-forwarded-for'];
  if (forwarded) {
    const first = String(forwarded).split(',')[0].trim();
    if (first) return first;
  }
  return req?.headers?.['x-real-ip'] || req?.socket?.remoteAddress || 'unknown';
}

async function increment(client, key, now) {
  if (!client) {
    const entry = memoryIncrement(key, now);
    return { count: entry.count, retryAfter: Math.ceil((entry.expiresAt - now) / 1000) };
  }
  const count = Number(await client.write(['INCR', key]));
  if (count === 1) await client.write(['EXPIRE', key, String(WINDOW_SECONDS)]);
  const ttl = Number(await client.read(['TTL', key]));
  return { count, retryAfter: ttl > 0 ? ttl : WINDOW_SECONDS };
}

/**
 * Records one login attempt and reports whether it should be refused.
 * Returns `{ allowed, retryAfter, scope }`.
 */
export async function recordLoginAttempt(req, { now = Date.now(), client = getUpstash() } = {}) {
  if (!client) sweep(now);
  const address = clientAddress(req);

  const perIp = await increment(client, `${PREFIX}ip:${address}`, now);
  if (perIp.count > PER_IP_LIMIT) {
    return { allowed: false, retryAfter: perIp.retryAfter, scope: 'ip' };
  }

  const global = await increment(client, `${PREFIX}global`, now);
  if (global.count > GLOBAL_LIMIT) {
    return { allowed: false, retryAfter: global.retryAfter, scope: 'global' };
  }

  return { allowed: true, retryAfter: 0, scope: null };
}
