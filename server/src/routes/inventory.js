import { Router } from 'express';
import { all, get, run, tx, nowIso } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { HttpError, validate } from '../lib/validate.js';
import { availableUnits, dailyIssueRate, nextCode, readinessFor, sweepExpired, issueEvents } from '../services.js';
import { stockSummary } from '../lib/readiness.js';
import { BLOOD_GROUPS, COMPONENTS } from '../lib/compatibility.js';
import { expiryFor, daysToExpiry, expiryBucket, today, addDays } from '../lib/expiry.js';
import { dailySeries, holtForecast, projectStock } from '../lib/forecast.js';

export const router = Router();
router.use(requireAuth);

/** Unit list with filters. */
router.get('/units', (req, res) => {
  sweepExpired(req.user);
  const { status, component, group, expiring } = req.query;
  const where = [];
  const params = [];
  if (status) { where.push('status = ?'); params.push(String(status)); }
  if (component) { where.push('component = ?'); params.push(String(component)); }
  if (group) { where.push('blood_group = ?'); params.push(String(group)); }
  if (expiring) { where.push('expires_on <= ?'); params.push(dateInDays(expiring)); }

  const sql = 'SELECT * FROM units' + (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY expires_on ASC, id ASC LIMIT 500';
  const rows = all(sql, ...params).map(decorate);
  res.json({ units: rows, total: rows.length });
});

/** Turn an "expiring within N days" filter into the cut-off date to compare against. */
function dateInDays(v) {
  const n = Number(v);
  return addDays(today(), Number.isFinite(n) ? n : 7);
}

function decorate(u) {
  return {
    ...u,
    componentLabel: COMPONENTS[u.component]?.label || u.component,
    daysToExpiry: daysToExpiry(u.expires_on),
    expiryBucket: expiryBucket(u.expires_on),
  };
}

/** Stock summary by group plus the expiry picture. */
router.get('/summary', (req, res) => {
  sweepExpired(req.user);
  const units = availableUnits();
  const byComponent = {};
  for (const u of units) byComponent[u.component] = (byComponent[u.component] || 0) + 1;

  const matrix = {};
  for (const g of BLOOD_GROUPS) {
    matrix[g] = {};
    for (const c of Object.keys(COMPONENTS)) matrix[g][c] = 0;
  }
  for (const u of units) matrix[u.blood_group][u.component]++;

  res.json({
    asOf: today(),
    totalAvailable: units.length,
    byGroup: stockSummary(units),
    byComponent,
    matrix,
    expiring: {
      critical: units.filter((u) => expiryBucket(u.expires_on) === 'critical').map(decorate),
      soon: units.filter((u) => expiryBucket(u.expires_on) === 'soon').map(decorate),
    },
    statusCounts: Object.fromEntries(
      all('SELECT status, COUNT(*) AS n FROM units GROUP BY status').map((r) => [r.status, r.n]),
    ),
    dailyIssueRate: dailyIssueRate(),
  });
});

/** Readiness check, standalone. Powers the "can we serve this?" widget. */
router.get('/readiness', (req, res) => {
  sweepExpired(req.user);
  const bloodGroup = req.query.group ? String(req.query.group) : null;
  if (bloodGroup && !BLOOD_GROUPS.includes(bloodGroup)) throw new HttpError(400, 'Unknown blood group');
  res.json({
    readiness: readinessFor({
      bloodGroup,
      component: req.query.component ? String(req.query.component) : 'PRBC',
      unitsRequested: Number(req.query.units) || 1,
    }),
  });
});

/** Demand forecast and stock projection per component. */
router.get('/forecast', (req, res) => {
  sweepExpired(req.user);
  const component = req.query.component ? String(req.query.component) : 'PRBC';
  if (!COMPONENTS[component]) throw new HttpError(400, 'Unknown component');
  const horizon = Math.min(30, Math.max(7, Number(req.query.horizon) || 14));

  const events = issueEvents(component, 30);
  const fit = holtForecast(dailySeries(events, 30), horizon);
  const units = availableUnits().filter((u) => u.component === component);
  const projection = projectStock(units, fit.ok ? fit.dailyRate : 0, horizon);

  res.json({ component, componentLabel: COMPONENTS[component].label, fit, projection });
});

/** Add a unit directly (stock correction / external transfer). */
router.post('/units', requireRole('bloodbank'), (req, res) => {
  const data = validate(req.body, {
    component: { type: 'enum', required: true, values: Object.keys(COMPONENTS) },
    blood_group: { type: 'enum', required: true, values: BLOOD_GROUPS },
    collected_on: { type: 'date', required: true },
    volume_ml: { type: 'int', min: 50, max: 600, default: 350 },
    storage_loc: { type: 'string', maxLength: 40, default: 'Main store' },
    quantity: { type: 'int', min: 1, max: 50, default: 1 },
  });

  if (data.collected_on > today()) throw new HttpError(400, 'Collection date cannot be in the future');

  const created = tx(() => {
    const out = [];
    for (let i = 0; i < data.quantity; i++) {
      const code = nextCode('units', 'unit_code', 'U-', 6);
      const expires = expiryFor(data.component, data.collected_on);
      const info = run(
        `INSERT INTO units (unit_code, component, blood_group, volume_ml, collected_on, expires_on, status, storage_loc, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        code, data.component, data.blood_group, data.volume_ml, data.collected_on, expires,
        expires < today() ? 'expired' : 'available', data.storage_loc, nowIso(),
      );
      out.push(get('SELECT * FROM units WHERE id = ?', info.lastInsertRowid));
    }
    return out;
  });

  audit(req.user, 'unit.add', 'unit', null, {
    quantity: created.length, component: data.component, group: data.blood_group,
    unitCodes: created.map((u) => u.unit_code),
  });
  res.status(201).json({ units: created.map(decorate) });
});

/** Discard a unit, with a mandatory reason. */
router.post('/units/:id/discard', requireRole('bloodbank'), (req, res) => {
  const id = Number(req.params.id);
  const unit = get('SELECT * FROM units WHERE id = ?', id);
  if (!unit) throw new HttpError(404, 'Unit not found');
  if (unit.status === 'issued') throw new HttpError(409, 'Unit ' + unit.unit_code + ' has already been issued and cannot be discarded');

  const { reason } = validate(req.body, { reason: { type: 'string', required: true, minLength: 3, maxLength: 200 } });
  run("UPDATE units SET status = 'discarded', discard_reason = ?, reserved_for = NULL WHERE id = ?", reason, id);
  audit(req.user, 'unit.discard', 'unit', id, { unitCode: unit.unit_code, reason, previousStatus: unit.status });
  res.json({ unit: decorate(get('SELECT * FROM units WHERE id = ?', id)) });
});

/** Release a reserved unit back to the shelf. */
router.post('/units/:id/release', requireRole('bloodbank'), (req, res) => {
  const id = Number(req.params.id);
  const unit = get('SELECT * FROM units WHERE id = ?', id);
  if (!unit) throw new HttpError(404, 'Unit not found');
  if (unit.status !== 'reserved') throw new HttpError(409, 'Unit ' + unit.unit_code + ' is not reserved');

  run("UPDATE units SET status = 'available', reserved_for = NULL WHERE id = ?", id);
  audit(req.user, 'unit.release', 'unit', id, { unitCode: unit.unit_code, wasReservedFor: unit.reserved_for });
  res.json({ unit: decorate(get('SELECT * FROM units WHERE id = ?', id)) });
});

router.get('/meta', (_req, res) => {
  res.json({ components: COMPONENTS, bloodGroups: BLOOD_GROUPS });
});
