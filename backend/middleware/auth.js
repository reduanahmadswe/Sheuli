const COOKIE_NAME = 'sheuli_session';

// Behind Railway's (or any) reverse proxy, the container itself only ever
// speaks plain HTTP — `req.secure` only reports the original HTTPS scheme
// correctly because `app.set('trust proxy', 1)` makes Express trust the
// proxy's X-Forwarded-Proto header. Basing `secure` on the ACTUAL request
// rather than `NODE_ENV` ensures login works over plain HTTP (e.g., direct IP
// access on a VM: http://34.87.43.102:3000) where browsers refuse to store
// Secure cookies, while automatically applying Secure when accessed over HTTPS
// (behind a proxy like Railway or Caddy).
export function cookieOptions(req) {
  const isSecure = Boolean(
    req?.secure === true ||
    req?.protocol === 'https' ||
    (typeof req?.headers?.['x-forwarded-proto'] === 'string' && req.headers['x-forwarded-proto'].split(',')[0].trim() === 'https') ||
    (Array.isArray(req?.headers?.['x-forwarded-proto']) && req.headers['x-forwarded-proto'][0]?.split(',')[0]?.trim() === 'https')
  );

  return {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
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
export default { issueSessionCookie, clearSessionCookie, isAuthenticated, requireAuth, cookieOptions, COOKIE_NAME };
