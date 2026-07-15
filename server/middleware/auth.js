import config from '../config.js';

const COOKIE_NAME = 'sheuli_session';

export function issueSessionCookie(res) {
  res.cookie(COOKIE_NAME, 'authenticated', {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
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
