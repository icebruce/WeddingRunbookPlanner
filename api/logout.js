import { clearSessionCookie } from '../lib/server/auth.js';
import { json, methodNotAllowed, requireSameOrigin } from '../lib/server/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    requireSameOrigin(req);
    res.setHeader('Set-Cookie', clearSessionCookie());
    return json(res, 200, { ok: true });
  } catch (error) {
    return json(res, error.statusCode || 500, { error: error.statusCode ? error.message : 'Unable to sign out' });
  }
}
