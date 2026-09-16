import { isAuthenticated } from '../lib/server/auth.js';
import { json, methodNotAllowed } from '../lib/server/http.js';
import { respondWithError } from '../lib/server/respond.js';

/**
 * Answers only "is this cookie currently valid?".
 *
 * A failure here must be a failure, not a `false`: the client has to be able to
 * tell "signed out" from "could not ask" (F27). Reporting false on a broken
 * configuration would show the sign-in screen to someone who is signed in.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    return json(res, 200, { authenticated: isAuthenticated(req) });
  } catch (error) {
    return respondWithError(res, 'session', error);
  }
}
