export function json(res, status, payload, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.end(JSON.stringify(payload));
}

export async function readJson(req, maxBytes = 256_000) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > maxBytes) throw Object.assign(new Error('Request too large'), { statusCode: 413 });
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { statusCode: 400 });
  }
}

export function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  return json(res, 405, { error: 'Method not allowed' });
}

export function requireSameOrigin(req) {
  const origin = req.headers?.origin;
  if (!origin) return;
  const forwardedProto = String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwardedProto || (req.socket?.encrypted ? 'https' : 'http');
  const host = req.headers?.['x-forwarded-host'] || req.headers?.host;
  if (!host || origin !== `${proto}://${host}`) {
    throw Object.assign(new Error('Invalid request origin'), { statusCode: 403 });
  }
}
