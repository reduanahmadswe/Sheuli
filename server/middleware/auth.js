import config from '../config.js';

const COOKIE_NAME = 'sheuli_session';

// Behind Railway's (or any) reverse proxy, the container itself only ever
// speaks plain HTTP — `req.secure` only reports the original HTTPS scheme
// correctly because `app.set('trust proxy', 1)` makes Express trust the
// proxy's X-Forwarded-Proto header. Basing `secure` on the ACTUAL request
// (not just NODE_ENV) means this works correctly even if NODE_ENV is ever
// missing/misconfigured in production, while still allowing plain-http
// local dev (req.secure is false there, so the cookie isn't marked secure
// and the browser still sends it back over http).
function cookieOptions(req) {
  return {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction || req?.secure === true,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    path: '/'
  };
}

export function issueSessionCookie(res, req) {
  res.cookie(COOKIE_NAME, 'authenticated', cookieOptions(req));
}

export function clearSessionCookie(res, req) {
  // clearCookie must be called with the SAME attributes the cookie was set
  // with (path/sameSite/secure) or some browsers won't actually remove it.
  res.clearCookie(COOKIE_NAME, cookieOptions(req));
}

export function isAuthenticated(req) {
  return req.signedCookies?.[COOKIE_NAME] === 'authenticated';
}

export function requireAuth(req, res, next) {
  if (isAuthenticated(req)) {
    return next();
  }
  return res.status(401).json({ error: 'Not authenticated' });
}

export { COOKIE_NAME };
export default { issueSessionCookie, clearSessionCookie, isAuthenticated, requireAuth, COOKIE_NAME };
