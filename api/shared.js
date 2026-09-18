import { fail, json, methodNotAllowed } from '../lib/server/http.js';
import { hashIp, log } from '../lib/server/log.js';
import { clientAddress } from '../lib/server/ratelimit.js';
import { respondWithError } from '../lib/server/respond.js';
import { readSharedPlan } from '../lib/server/storage.js';

const ROUTE = 'shared';

/**
 * The plan, read through a share link. The only route in the app that answers
 * without a session — and the only one a share token can be presented to.
 *
 * There is no PUT here and no cookie set, so "read-only" is not a permission
 * this handler has to remember to enforce: it is the shape of what exists.
 *
 * The token arrives in a header rather than the query string. The page itself
 * keeps it in the URL fragment, which browsers never send anywhere, so the one
 * credential a vendor is holding does not end up written down the length of a
 * request log.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  try {
    const token = req.headers['x-share-token'];
    const shared = await readSharedPlan(typeof token === 'string' ? token : null);

    if (!shared) {
      log.warn(ROUTE, 'bad_share_token', 'share link refused', { ip: hashIp(clientAddress(req)) });
      // Deliberately the same answer whether the link is old, mistyped or
      // invented: there is nothing here to tell them apart with.
      return fail(res, 404, 'bad_share_link', 'This link is no longer available. Ask the couple for a new one.');
    }

    return json(res, 200, { plan: shared.plan, updatedAt: shared.updatedAt });
  } catch (error) {
    return respondWithError(res, ROUTE, error);
  }
}
