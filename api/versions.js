import { isAuthenticated } from '../lib/server/auth.js';
import { json, methodNotAllowed, requireSameOrigin, readJson } from '../lib/server/http.js';
import { createVersion, readData, restoreVersion } from '../lib/server/storage.js';

export default async function handler(req, res) {
  if (!isAuthenticated(req)) return json(res, 401, { error: 'Authentication required' });
  try {
    if (req.method === 'GET') {
      const data = await readData();
      return json(res, 200, { versions: data.versions.map(({ plan, ...meta }) => meta), revision: data.revision });
    }
    if (req.method === 'POST') {
      requireSameOrigin(req);
      const { name, revision } = await readJson(req, 16_000);
      const data = await createVersion(name, revision);
      return json(res, 201, { versions: data.versions.map(({ plan, ...meta }) => meta), revision: data.revision });
    }
    if (req.method === 'PUT') {
      requireSameOrigin(req);
      const { id, revision } = await readJson(req, 16_000);
      const data = await restoreVersion(id, revision);
      return json(res, 200, { plan: data.plan, versions: data.versions.map(({ plan, ...meta }) => meta), revision: data.revision, updatedAt: data.updatedAt });
    }
    return methodNotAllowed(res, ['GET', 'POST', 'PUT']);
  } catch (error) {
    if (error.statusCode === 409) return json(res, 409, { error: error.message, latest: { plan: error.data.plan, revision: error.data.revision, updatedAt: error.data.updatedAt } });
    return json(res, error.statusCode || 500, { error: error.statusCode ? error.message : 'Unable to access versions' });
  }
}
