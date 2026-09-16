import { clearSessionCookie } from '../lib/server/auth.js';
import { json, methodNotAllowed, requireSameOrigin } from '../lib/server/http.js';
import { respondWithError } from '../lib/server/respond.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    requireSameOrigin(req);
    res.setHeader('Set-Cookie', clearSessionCookie());
    return json(res, 200, { ok: true });
  } catch (error) {
    return respondWithError(res, 'logout', error);
  }
}
