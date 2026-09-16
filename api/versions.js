import { isAuthenticated } from '../lib/server/auth.js';
import { fail, json, methodNotAllowed, readJson, requireSameOrigin } from '../lib/server/http.js';
import { respondWithError } from '../lib/server/respond.js';
import { createVersion, deleteVersion, readData, readVersions, restoreVersion } from '../lib/server/storage.js';

const ROUTE = 'versions';

/** The list never carries plan bodies; restoring fetches the one it needs. */
const listed = versions => versions.map(({ plan, ...meta }) => meta);

export default async function handler(req, res) {
  if (!isAuthenticated(req)) return fail(res, 401, 'unauthenticated', 'Sign in to open version history.');

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const id = url.searchParams.get('id');

      // One version, with its plan. Asked for only when a body is actually
      // needed — putting a deleted version back, for instance.
      if (id) {
        const version = (await readVersions()).find(entry => entry.id === id);
        if (!version) return fail(res, 404, 'not_found', 'Version not found.');
        return json(res, 200, { version });
      }

      const [versions, data] = await Promise.all([readVersions(), readData()]);
      return json(res, 200, { versions: listed(versions), revision: data.revision, updatedAt: data.updatedAt });
    }

    if (req.method === 'POST') {
      requireSameOrigin(req);
      const { name, auto, plan } = await readJson(req);
      const { versions } = await createVersion(name, { auto: Boolean(auto), plan: plan || null });
      return json(res, 201, { versions: listed(versions) });
    }

    if (req.method === 'PUT') {
      requireSameOrigin(req);
      const { id, revision } = await readJson(req, 16_000);
      const data = await restoreVersion(id, revision);
      const versions = await readVersions();
      return json(res, 200, { plan: data.plan, versions: listed(versions), revision: data.revision, updatedAt: data.updatedAt });
    }

    if (req.method === 'DELETE') {
      requireSameOrigin(req);
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      await deleteVersion(url.searchParams.get('id'));
      const versions = await readVersions();
      return json(res, 200, { versions: listed(versions) });
    }

    return methodNotAllowed(res, ['GET', 'POST', 'PUT', 'DELETE']);
  } catch (error) {
    return respondWithError(res, ROUTE, error, {
      latest: error.current
        ? { plan: error.current.plan, revision: error.current.revision, updatedAt: error.current.updatedAt }
        : undefined
    });
  }
}
