import { isAuthenticated } from '../lib/server/auth.js';
import { fail, json, methodNotAllowed, readJson, requireSameOrigin } from '../lib/server/http.js';
import { respondWithError } from '../lib/server/respond.js';
import { readData, savePlan } from '../lib/server/storage.js';

const ROUTE = 'plan';

export default async function handler(req, res) {
  try {
    if (!isAuthenticated(req)) return fail(res, 401, 'unauthenticated', 'Sign in to open the plan.');

    if (req.method === 'GET') {
      const data = await readData();
      // `since` lets an idle tab ask "is there anything newer?" without
      // pulling the whole plan down every minute.
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const since = url.searchParams.get('since');
      if (since !== null && Number(since) === Number(data.revision)) {
        return json(res, 200, { unchanged: true, revision: data.revision });
      }
      return json(res, 200, {
        plan: data.plan,
        revision: data.revision,
        updatedAt: data.updatedAt,
        updatedBy: data.updatedBy ?? null
      });
    }

    if (req.method === 'PUT') {
      requireSameOrigin(req);
      const { plan, revision, deviceId } = await readJson(req);
      const data = await savePlan(plan, revision, { updatedBy: typeof deviceId === 'string' ? deviceId.slice(0, 64) : null });
      return json(res, 200, { revision: data.revision, updatedAt: data.updatedAt });
    }

    return methodNotAllowed(res, ['GET', 'PUT']);
  } catch (error) {
    return respondWithError(res, ROUTE, error, {
      latest: error.current
        ? { plan: error.current.plan, revision: error.current.revision, updatedAt: error.current.updatedAt, updatedBy: error.current.updatedBy ?? null }
        : undefined
    });
  }
}
