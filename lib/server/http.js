import { ValidationError } from './validate.js';

export function json(res, status, payload, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.end(JSON.stringify(payload));
}

/** Every failure has the same shape: { error: { code, message, field? } }. */
export function fail(res, status, code, message, extra = {}) {
  const error = { code, message };
  if (extra.field) error.field = extra.field;
  const body = { error };
  if (extra.latest) body.latest = extra.latest;
  return json(res, status, body, extra.headers || {});
}

export function errorStatus(error) {
  if (error instanceof ValidationError) return 400;
  return error?.statusCode || 500;
}

export const MAX_BODY_BYTES = 256_000;

/**
 * Reads a JSON body with a real size limit.
 *
 * Two things were wrong before (F16). On Vercel the platform parses the body
 * before the handler runs, so `req.body` is already an object and the streaming
 * limit below never ran — an oversized payload was accepted. And concatenating
 * chunks into a string splits multi-byte characters across chunk boundaries,
 * corrupting any non-ASCII text. Buffers are collected and decoded once.
 */
export async function readJson(req, maxBytes = MAX_BODY_BYTES) {
  if (req.body && typeof req.body === 'object') {
    const size = Buffer.byteLength(JSON.stringify(req.body));
    if (size > maxBytes) throw Object.assign(new Error('Request too large'), { statusCode: 413, code: 'too_large' });
    return req.body;
  }
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body) > maxBytes) throw Object.assign(new Error('Request too large'), { statusCode: 413, code: 'too_large' });
    return parse(req.body);
  }

  // Breaking out of `for await` destroys the request stream, which resets the
  // connection: the 413 may never reach the sender, and the next request on
  // that keep-alive socket fails for no visible reason. So an oversized body
  // is read to the end and discarded — up to a hard ceiling, past which the
  // connection really is dropped rather than read forever.
  const hardLimit = maxBytes * 4;
  const chunks = [];
  let size = 0;
  let overflowed = false;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      overflowed = true;
      chunks.length = 0;
      if (size > hardLimit) {
        req.destroy();
        break;
      }
      continue;
    }
    chunks.push(buffer);
  }

  if (overflowed) throw Object.assign(new Error('Request too large'), { statusCode: 413, code: 'too_large' });
  if (!size) return {};
  return parse(Buffer.concat(chunks).toString('utf8'));
}

function parse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { statusCode: 400, code: 'invalid_json' });
  }
}

export function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  return fail(res, 405, 'method_not_allowed', 'Method not allowed.');
}

/**
 * Cross-origin guard for writes.
 *
 * A missing Origin header is now refused rather than waved through: browsers
 * send it on every cross-origin request that can change state, so its absence
 * on a mutating request means the request did not come from the app.
 */
export function requireSameOrigin(req) {
  const origin = req.headers?.origin;
  if (!origin) {
    throw Object.assign(new Error('Missing request origin'), { statusCode: 403, code: 'bad_origin' });
  }
  const forwardedProto = String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwardedProto || (req.socket?.encrypted ? 'https' : 'http');
  const host = req.headers?.['x-forwarded-host'] || req.headers?.host;
  if (!host || origin !== `${proto}://${host}`) {
    throw Object.assign(new Error('Invalid request origin'), { statusCode: 403, code: 'bad_origin' });
  }
}
