import { isAuthenticated } from '../lib/server/auth.js';
import { fail, json, methodNotAllowed } from '../lib/server/http.js';
import { respondWithError } from '../lib/server/respond.js';
import { SEED_PLAN } from '../lib/server/seed-template.js';

/**
 * The wedding template: a day to start from rather than a blank page. The
 * activities come back without ids, because they are about to become somebody
 * else's activities.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    if (!isAuthenticated(req)) return fail(res, 401, 'unauthenticated', 'Sign in to use the template.');

    return json(res, 200, {
      activities: structuredClone(SEED_PLAN.activities).map(({ id, ...activity }) => activity)
    });
  } catch (error) {
    return respondWithError(res, 'template', error);
  }
}
