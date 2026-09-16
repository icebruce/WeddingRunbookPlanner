import crypto from 'node:crypto';

const COOKIE_NAME = 'wedding_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters');
  return secret;
}

function sign(value) {
  return crypto.createHmac('sha256', getSecret()).update(value).digest('base64url');
}

/**
 * A short fingerprint of the current password, carried inside the session.
 *
 * Tokens used to say only when they expired, so changing APP_PASSWORD left
 * every existing session working (F28). Binding the token to the password means
 * a password change invalidates all of them, which is what a password change is
 * for. It is an HMAC rather than a hash of the password itself, so the cookie
 * never carries anything derived from the password alone.
 */
export function passwordFingerprint(password = process.env.APP_PASSWORD) {
  if (!password) throw new Error('APP_PASSWORD is not configured');
  return crypto.createHmac('sha256', getSecret()).update(`pv:${password}`).digest('hex').slice(0, 16);
}

export function createSessionToken(now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    iat: now,
    exp: now + MAX_AGE_SECONDS * 1000,
    pv: passwordFingerprint()
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token, now = Date.now()) {
  if (!token || typeof token !== 'string') return false;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return false;

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!Number.isFinite(data.exp) || data.exp <= now) return false;
    // Tokens issued before password binding existed have no `pv` and are no
    // longer accepted: they cannot be checked against the current password.
    return typeof data.pv === 'string' && data.pv === passwordFingerprint();
  } catch {
    return false;
  }
}

export function passwordMatches(candidate) {
  const configured = process.env.APP_PASSWORD;
  if (!configured) throw new Error('APP_PASSWORD is not configured');
  const left = crypto.createHash('sha256').update(String(candidate ?? '')).digest();
  const right = crypto.createHash('sha256').update(configured).digest();
  return crypto.timingSafeEqual(left, right);
}

function isSecureContext() {
  return process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
}

export function sessionCookie(token, secure = isSecureContext()) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE_SECONDS}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(secure = isSecureContext()) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function getCookie(req, name = COOKIE_NAME) {
  const header = req.headers?.cookie || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function isAuthenticated(req) {
  return verifySessionToken(getCookie(req));
}
