import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from 'node:crypto';
import { get, run, nowIso } from './db.js';
import { HttpError } from './lib/validate.js';

const SESSION_HOURS = 12;

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}

export function verifyPassword(password, salt, expected) {
  const actual = scryptSync(password, salt, 64);
  const want = Buffer.from(expected, 'hex');
  return actual.length === want.length && timingSafeEqual(actual, want);
}

export function createSession(userId) {
  const token = randomUUID() + randomBytes(16).toString('hex');
  const expires = new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString();
  run('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)', token, userId, nowIso(), expires);
  return { token, expiresAt: expires };
}

export function destroySession(token) {
  run('DELETE FROM sessions WHERE token = ?', token);
}

/** Populates req.user from the bearer token. Does not reject on its own. */
export function attachUser(req, _res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    const row = get(
      `SELECT u.id, u.username, u.full_name, u.role, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND u.active = 1`,
      token,
    );
    if (row && row.expires_at > nowIso()) {
      req.user = { id: row.id, username: row.username, full_name: row.full_name, role: row.role };
      req.token = token;
    } else if (row) {
      destroySession(token);
    }
  }
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Sign in to continue'));
  next();
}

/** Role gate. Admin is allowed everywhere so one account can run a demo. */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Sign in to continue'));
    if (req.user.role === 'admin' || roles.includes(req.user.role)) return next();
    next(new HttpError(403, 'Your role (' + req.user.role + ') cannot perform this action. Required: ' + roles.join(' or ')));
  };
}
