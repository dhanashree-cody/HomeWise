import { Router } from 'express';
import { get } from '../db.js';
import { createSession, destroySession, verifyPassword, requireAuth } from '../auth.js';
import { audit } from '../audit.js';
import { HttpError, validate } from '../lib/validate.js';

export const router = Router();

router.post('/login', (req, res) => {
  const { username, password } = validate(req.body, {
    username: { type: 'string', required: true },
    password: { type: 'string', required: true },
  });

  const user = get('SELECT * FROM users WHERE username = ? AND active = 1', username.toLowerCase());
  if (!user || !verifyPassword(password, user.pw_salt, user.pw_hash)) {
    audit(null, 'auth.login_failed', 'user', username, { username });
    throw new HttpError(401, 'Incorrect username or password');
  }

  const session = createSession(user.id);
  audit(user, 'auth.login', 'user', user.id);
  res.json({
    token: session.token,
    expiresAt: session.expiresAt,
    user: { id: user.id, username: user.username, fullName: user.full_name, role: user.role },
  });
});

router.post('/logout', requireAuth, (req, res) => {
  destroySession(req.token);
  audit(req.user, 'auth.logout', 'user', req.user.id);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: { id: req.user.id, username: req.user.username, fullName: req.user.full_name, role: req.user.role } });
});
