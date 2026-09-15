import { isAuthenticated } from '../lib/server/auth.js';
import { json, methodNotAllowed } from '../lib/server/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    return json(res, 200, { authenticated: isAuthenticated(req) });
  } catch {
    return json(res, 200, { authenticated: false });
  }
}
