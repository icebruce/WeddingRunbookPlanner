/**
 * Login rate limiting (F9).
 *
 * The budget is spent by *failures*, not by attempts. Counting successful
 * sign-ins would lock out a household behind one address, or a couple on the
 * same café Wi-Fi, after ten ordinary sign-ins — and it would let a burst of
 * legitimate logins fill the global ceiling for everyone.
 *
 * Two counters guard the shared password: one per client address, and a global
 * one so an attempt spread across many addresses is still bounded. Both use a
 * fixed 15-minute window: the counter is incremented on a wrong password, and
 * its expiry is set on the first increment so the window starts with the first
 * failure. A correct password clears that address's counter.
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
const GLOBAL_KEY = `${PREFIX}global`;

const memory = new Map();

/** Exported for tests; also keeps a long-lived dev server from leaking keys. */
export function resetMemoryLimiter() {
  memory.clear();
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

function ipKey(req) {
  return `${PREFIX}ip:${clientAddress(req)}`;
}

function sweep(now) {
  for (const [key, entry] of memory) {
    if (entry.expiresAt <= now) memory.delete(key);
  }
}

async function readCounter(client, key, now) {
  if (!client) {
    const entry = memory.get(key);
    if (!entry || entry.expiresAt <= now) return { count: 0, retryAfter: WINDOW_SECONDS };
    return { count: entry.count, retryAfter: Math.ceil((entry.expiresAt - now) / 1000) };
  }
  const [value, ttl] = await Promise.all([
    client.read(['GET', key]),
    client.read(['TTL', key])
  ]);
  const count = Number(value) || 0;
  return { count, retryAfter: Number(ttl) > 0 ? Number(ttl) : WINDOW_SECONDS };
}

async function bump(client, key, now) {
  if (!client) {
    const entry = memory.get(key);
    if (!entry || entry.expiresAt <= now) {
      memory.set(key, { count: 1, expiresAt: now + WINDOW_SECONDS * 1000 });
      return;
    }
    entry.count += 1;
    return;
  }
  const count = Number(await client.write(['INCR', key]));
  if (count === 1) await client.write(['EXPIRE', key, String(WINDOW_SECONDS)]);
}

/**
 * Asks, without changing anything, whether this request should be refused.
 * Runs before the password is checked, so a correct guess at the end of a long
 * run of wrong ones is still refused.
 */
export async function loginStatus(req, { now = Date.now(), client = getUpstash() } = {}) {
  if (!client) sweep(now);

  const perIp = await readCounter(client, ipKey(req), now);
  if (perIp.count >= PER_IP_LIMIT) {
    return { blocked: true, retryAfter: perIp.retryAfter, scope: 'ip' };
  }

  const global = await readCounter(client, GLOBAL_KEY, now);
  if (global.count >= GLOBAL_LIMIT) {
    return { blocked: true, retryAfter: global.retryAfter, scope: 'global' };
  }

  return { blocked: false, retryAfter: 0, scope: null };
}

/** Called after a wrong password, and only then. */
export async function recordLoginFailure(req, { now = Date.now(), client = getUpstash() } = {}) {
  await bump(client, ipKey(req), now);
  await bump(client, GLOBAL_KEY, now);
}

/**
 * Called after a correct password. Clears that address's counter so a run of
 * wrong guesses followed by the right one does not leave the person one
 * mistake away from a fifteen-minute wait. The global ceiling is deliberately
 * not cleared: one valid sign-in should not reopen the budget for everyone.
 */
export async function clearLoginAttempts(req, { client = getUpstash() } = {}) {
  const key = ipKey(req);
  if (!client) {
    memory.delete(key);
    return;
  }
  await client.write(['DEL', key]);
}
