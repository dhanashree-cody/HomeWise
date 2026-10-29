import { Router } from 'express';
import { all, get, run, nowIso } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { HttpError, validate } from '../lib/validate.js';
import { availableUnits, dailyIssueRate } from '../services.js';
import { BLOOD_GROUPS } from '../lib/compatibility.js';
import { today } from '../lib/expiry.js';

export const router = Router();
router.use(requireAuth);

router.get('/', (_req, res) => {
  const camps = all(
    `SELECT c.*,
            (SELECT COUNT(*) FROM donations d WHERE d.camp_id = c.id) AS donations_recorded
       FROM camps c ORDER BY c.scheduled_on DESC`,
  );
  res.json({ camps });
});

/**
 * Which groups a collection drive should target.
 *
 * The base paper optimises campaign LOCATION from geography. Location data is
 * out of scope here, but the more actionable question for a single blood bank
 * is which GROUPS to call for: the ones where days of cover are shortest.
 * Cover is stock divided by the recent issue rate, so a group with little
 * stock but little demand does not crowd out a group that is genuinely tight.
 */
router.get('/collection-priority', (_req, res) => {
  const units = availableUnits();
  const rates = dailyIssueRate();
  const prbcRate = rates.PRBC || 0;

  const totalStock = units.filter((u) => u.component === 'PRBC').length;
  const rows = BLOOD_GROUPS.map((group) => {
    const stock = units.filter((u) => u.component === 'PRBC' && u.blood_group === group).length;
    // Split the overall issue rate across groups by their share of the shelf,
    // falling back to an even split when the shelf is empty.
    const share = totalStock > 0 ? stock / totalStock : 1 / BLOOD_GROUPS.length;
    const groupRate = Number((prbcRate * share).toFixed(3));
    const coverDays = groupRate > 0 ? Number((stock / groupRate).toFixed(1)) : null;
    return { group, stock, estimatedDailyUse: groupRate, coverDays };
  });

  const ranked = [...rows].sort((a, b) => {
    if (a.coverDays === null && b.coverDays === null) return a.stock - b.stock;
    if (a.coverDays === null) return 1;
    if (b.coverDays === null) return -1;
    return a.coverDays - b.coverDays;
  });

  res.json({
    asOf: today(),
    priority: ranked.map((r, i) => ({
      ...r,
      rank: i + 1,
      urgency: r.coverDays === null ? 'unknown' : r.coverDays < 3 ? 'high' : r.coverDays < 7 ? 'medium' : 'low',
    })),
    method: 'Days of cover = packed-red-cell stock in the group divided by its estimated share of the recent issue rate.',
    note: 'A planning aid for scheduling collection. It does not account for seasonality, local donor demographics or planned surgical lists.',
  });
});

router.post('/', requireRole('bloodbank'), (req, res) => {
  const data = validate(req.body, {
    name: { type: 'string', required: true, minLength: 3, maxLength: 80 },
    location: { type: 'string', required: true, minLength: 2, maxLength: 120 },
    scheduled_on: { type: 'date', required: true },
    target_units: { type: 'int', min: 0, max: 1000, default: 50 },
    organiser: { type: 'string', maxLength: 80 },
  });
  const info = run(
    'INSERT INTO camps (name, location, scheduled_on, target_units, organiser, created_at) VALUES (?,?,?,?,?,?)',
    data.name, data.location, data.scheduled_on, data.target_units, data.organiser, nowIso(),
  );
  const camp = get('SELECT * FROM camps WHERE id = ?', info.lastInsertRowid);
  audit(req.user, 'camp.create', 'camp', camp.id, data);
  res.status(201).json({ camp });
});

router.patch('/:id/status', requireRole('bloodbank'), (req, res) => {
  const camp = get('SELECT * FROM camps WHERE id = ?', Number(req.params.id));
  if (!camp) throw new HttpError(404, 'Camp not found');
  const { status } = validate(req.body, {
    status: { type: 'enum', required: true, values: ['planned', 'active', 'completed', 'cancelled'] },
  });
  run('UPDATE camps SET status = ? WHERE id = ?', status, camp.id);
  audit(req.user, 'camp.status', 'camp', camp.id, { from: camp.status, to: status });
  res.json({ camp: get('SELECT * FROM camps WHERE id = ?', camp.id) });
});

router.get('/:id', (req, res) => {
  const camp = get('SELECT * FROM camps WHERE id = ?', Number(req.params.id));
  if (!camp) throw new HttpError(404, 'Camp not found');
  const donations = all(
    `SELECT d.*, dn.donor_code, dn.full_name, dn.blood_group
       FROM donations d JOIN donors dn ON dn.id = d.donor_id
      WHERE d.camp_id = ? ORDER BY d.id DESC`,
    camp.id,
  );
  res.json({ camp, donations });
});
