import { createSessionToken, passwordMatches, sessionCookie } from '../lib/server/auth.js';
import { fail, json, methodNotAllowed, readJson, requireSameOrigin } from '../lib/server/http.js';
import { hashIp, log } from '../lib/server/log.js';
import { clearLoginAttempts, clientAddress, loginStatus, recordLoginFailure } from '../lib/server/ratelimit.js';
import { respondWithError } from '../lib/server/respond.js';

const ROUTE = 'login';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    requireSameOrigin(req);

    // Checked before the password is, so a correct guess at the end of a long
    // run of wrong ones is still refused.
    const limit = await loginStatus(req);
    if (limit.blocked) {
      log.warn(ROUTE, 'rate_limited', 'login attempt refused', { scope: limit.scope, ip: hashIp(clientAddress(req)) });
      return fail(res, 429, 'rate_limited', 'Too many attempts. Try again in 15 minutes.', {
        headers: { 'Retry-After': String(limit.retryAfter) }
      });
    }

    const { password } = await readJson(req, 8_000);
    if (!passwordMatches(password)) {
      await recordLoginFailure(req);
      log.warn(ROUTE, 'bad_password', 'incorrect password', { ip: hashIp(clientAddress(req)) });
      await new Promise(resolve => setTimeout(resolve, 250));
      return fail(res, 401, 'bad_password', "That password didn't work. Try again.");
    }

    // The password was right, so this address is not the one being guessed at.
    await clearLoginAttempts(req);
    res.setHeader('Set-Cookie', sessionCookie(createSessionToken()));
    return json(res, 200, { ok: true });
  } catch (error) {
    return respondWithError(res, ROUTE, error);
  }
}
