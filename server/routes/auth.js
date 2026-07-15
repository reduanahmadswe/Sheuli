import { Router } from 'express';
import config from '../config.js';
import { issueSessionCookie, clearSessionCookie, isAuthenticated } from '../middleware/auth.js';

const router = Router();

// Minimal in-memory brute-force throttle: after 5 failed attempts from an IP,
// lock that IP out for 60 seconds.
const failedAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60 * 1000;

function isLockedOut(ip) {
  const entry = failedAttempts.get(ip);
  if (!entry) return false;
  if (entry.count < MAX_ATTEMPTS) return false;
  if (Date.now() - entry.lastAttempt > LOCKOUT_MS) {
    failedAttempts.delete(ip);
    return false;
  }
  return true;
}

function recordFailure(ip) {
  const entry = failedAttempts.get(ip) || { count: 0, lastAttempt: 0 };
  entry.count += 1;
  entry.lastAttempt = Date.now();
  failedAttempts.set(ip, entry);
}

router.post('/login', (req, res) => {
  const { password } = req.body || {};

  if (!config.dashboardPassword) {
    return res.status(500).json({ error: 'DASHBOARD_PASSWORD is not configured on the server' });
  }

  if (isLockedOut(req.ip)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });
  }

  if (typeof password !== 'string' || password !== config.dashboardPassword) {
    recordFailure(req.ip);
    return res.status(401).json({ error: 'Incorrect password' });
  }

  failedAttempts.delete(req.ip);
  issueSessionCookie(res);
  return res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  return res.json({ ok: true });
});

router.get('/me', (req, res) => {
  return res.json({ authenticated: isAuthenticated(req) });
});

export default router;
