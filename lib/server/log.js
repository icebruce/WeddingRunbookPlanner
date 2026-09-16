/**
 * One JSON line per event on console.error, which is what Vercel collects.
 *
 * Nothing that identifies a person or reveals plan content is written: no
 * activity titles, no passwords, no cookies, and IP addresses only as a short
 * salted-by-secret hash so repeated attempts from one address can be counted
 * without the address itself being stored.
 */
import crypto from 'node:crypto';

export function hashIp(ip) {
  if (!ip) return null;
  const salt = process.env.SESSION_SECRET || 'unsalted';
  return crypto.createHmac('sha256', salt).update(String(ip)).digest('hex').slice(0, 12);
}

function write(level, route, code, message, extra = {}) {
  const line = { level, route, code, message, at: new Date().toISOString(), ...extra };
  for (const [key, value] of Object.entries(line)) {
    if (value === undefined || value === null) delete line[key];
  }
  console.error(JSON.stringify(line));
}

export const log = {
  /** Unexpected failures. `err` is reduced to its message, never its payload. */
  error(route, code, err, extra = {}) {
    write('error', route, code, err instanceof Error ? err.message : String(err ?? ''), extra);
  },
  /** Expected-but-notable outcomes: rejected input, rate limits, conflicts. */
  warn(route, code, message, extra = {}) {
    write('warn', route, code, message, extra);
  }
};
