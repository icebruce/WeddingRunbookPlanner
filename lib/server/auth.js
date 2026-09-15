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

export function createSessionToken(now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ exp: now + MAX_AGE_SECONDS * 1000 })).toString('base64url');
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
    return Number.isFinite(data.exp) && data.exp > now;
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

export function sessionCookie(token, secure = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL)) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE_SECONDS}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(secure = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL)) {
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
