import { Router } from 'express';
import { all, get } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { verifyChain } from '../audit.js';

export const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  const entity = req.query.entity ? String(req.query.entity) : null;
  const action = req.query.action ? String(req.query.action) : null;

  const where = [];
  const params = [];
  if (entity) { where.push('entity = ?'); params.push(entity); }
  if (action) { where.push('action LIKE ?'); params.push(action + '%'); }

  const rows = all(
    'SELECT * FROM audit_log' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY id DESC LIMIT ' + limit,
    ...params,
  );

  res.json({
    entries: rows.map((r) => ({
      id: r.id, ts: r.ts, actor: r.actor_name, action: r.action, entity: r.entity, entityId: r.entity_id,
      detail: r.detail_json ? JSON.parse(r.detail_json) : null,
      hash: r.hash, prevHash: r.prev_hash,
    })),
    total: get('SELECT COUNT(*) AS n FROM audit_log').n,
    actions: all('SELECT action, COUNT(*) AS n FROM audit_log GROUP BY action ORDER BY n DESC'),
  });
});

/** Recompute every hash and report whether the ledger is intact. */
router.get('/verify', requireRole('admin', 'bloodbank'), (_req, res) => {
  res.json({
    ...verifyChain(),
    explanation:
      'Each entry commits to the hash of the entry before it. Recomputing the chain detects any row that has been edited, inserted or removed after the fact.',
  });
});
