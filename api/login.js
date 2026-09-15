import { createSessionToken, passwordMatches, sessionCookie } from '../lib/server/auth.js';
import { json, methodNotAllowed, requireSameOrigin, readJson } from '../lib/server/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    requireSameOrigin(req);
    const { password } = await readJson(req, 8_000);
    if (!passwordMatches(password)) {
      await new Promise(resolve => setTimeout(resolve, 250));
      return json(res, 401, { error: 'Incorrect password' });
    }
    res.setHeader('Set-Cookie', sessionCookie(createSessionToken()));
    return json(res, 200, { ok: true });
  } catch (error) {
    return json(res, error.statusCode || 500, { error: error.statusCode ? error.message : 'Login is not configured correctly' });
  }
}
