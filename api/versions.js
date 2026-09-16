import { isAuthenticated } from '../lib/server/auth.js';
import { fail, json, methodNotAllowed, readJson, requireSameOrigin } from '../lib/server/http.js';
import { respondWithError } from '../lib/server/respond.js';
import { createVersion, readData, restoreVersion } from '../lib/server/storage.js';

const ROUTE = 'versions';

/** The list never carries plan bodies; restoring fetches the one that is needed. */
function listVersions(data) {
  return (data.versions || []).map(({ plan, ...meta }) => meta);
}

export default async function handler(req, res) {
  if (!isAuthenticated(req)) return fail(res, 401, 'unauthenticated', 'Sign in to open version history.');

  try {
    if (req.method === 'GET') {
      const data = await readData();
      return json(res, 200, { versions: listVersions(data), revision: data.revision });
    }

    if (req.method === 'POST') {
      requireSameOrigin(req);
      const { name, revision, auto, plan } = await readJson(req);
      const data = await createVersion(name, revision, { auto: Boolean(auto), plan: plan || null });
      return json(res, 201, { versions: listVersions(data), revision: data.revision });
    }

    if (req.method === 'PUT') {
      requireSameOrigin(req);
      const { id, revision } = await readJson(req, 16_000);
      const data = await restoreVersion(id, revision);
      return json(res, 200, { plan: data.plan, versions: listVersions(data), revision: data.revision, updatedAt: data.updatedAt });
    }

    return methodNotAllowed(res, ['GET', 'POST', 'PUT']);
  } catch (error) {
    return respondWithError(res, ROUTE, error, {
      latest: error.current
        ? { plan: error.current.plan, revision: error.current.revision, updatedAt: error.current.updatedAt }
        : undefined
    });
  }
}
