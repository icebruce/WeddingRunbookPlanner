import { isAuthenticated } from '../lib/server/auth.js';
import { json, methodNotAllowed, requireSameOrigin, readJson } from '../lib/server/http.js';
import { readData, savePlan } from '../lib/server/storage.js';

export default async function handler(req, res) {
  if (!isAuthenticated(req)) return json(res, 401, { error: 'Authentication required' });
  try {
    if (req.method === 'GET') {
      const data = await readData();
      return json(res, 200, { plan: data.plan, revision: data.revision, updatedAt: data.updatedAt });
    }
    if (req.method === 'PUT') {
      requireSameOrigin(req);
      const { plan, revision } = await readJson(req);
      const data = await savePlan(plan, revision);
      return json(res, 200, { plan: data.plan, revision: data.revision, updatedAt: data.updatedAt });
    }
    return methodNotAllowed(res, ['GET', 'PUT']);
  } catch (error) {
    if (error.statusCode === 409) return json(res, 409, { error: error.message, latest: { plan: error.data.plan, revision: error.data.revision, updatedAt: error.data.updatedAt } });
    return json(res, error.statusCode || 500, { error: error.statusCode ? error.message : 'Unable to access the plan' });
  }
}
