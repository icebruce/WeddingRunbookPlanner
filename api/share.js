import { isAuthenticated } from '../lib/server/auth.js';
import { fail, json, methodNotAllowed, requireSameOrigin } from '../lib/server/http.js';
import { respondWithError } from '../lib/server/respond.js';
import { ensureShare, rotateShare } from '../lib/server/storage.js';

const ROUTE = 'share';

/**
 * Managing the read-only link. Signing in is required to see it or replace it;
 * reading the plan through it is `/api/shared`, which requires nothing.
 */
export default async function handler(req, res) {
  try {
    if (!isAuthenticated(req)) return fail(res, 401, 'unauthenticated', 'Sign in to manage the shared link.');

    if (req.method === 'GET') return json(res, 200, { share: await ensureShare() });

    if (req.method === 'POST') {
      requireSameOrigin(req);
      return json(res, 200, { share: await rotateShare() });
    }

    return methodNotAllowed(res, ['GET', 'POST']);
  } catch (error) {
    return respondWithError(res, ROUTE, error);
  }
}
