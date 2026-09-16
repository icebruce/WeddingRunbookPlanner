import { isAuthenticated } from '../lib/server/auth.js';
import { fail, json, methodNotAllowed } from '../lib/server/http.js';
import { respondWithError } from '../lib/server/respond.js';
import { readData } from '../lib/server/storage.js';

/**
 * The plan, as a file. Versions are not included and neither is anything about
 * the store — a backup is the day, not the database.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    if (!isAuthenticated(req)) return fail(res, 401, 'unauthenticated', 'Sign in to export the plan.');

    const data = await readData();
    const filename = `wedding-plan-${data.plan.date}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return json(res, 200, data.plan);
  } catch (error) {
    return respondWithError(res, 'export', error);
  }
}
