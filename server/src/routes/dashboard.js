import { Router } from 'express';
import { all, get } from '../db.js';
import { requireAuth } from '../auth.js';
import { availableUnits, dailyIssueRate, sweepExpired, issueEvents } from '../services.js';
import { stockSummary } from '../lib/readiness.js';
import { expiryBucket, daysToExpiry, today, addDays } from '../lib/expiry.js';
import { dailySeries } from '../lib/forecast.js';
import { COMPONENTS } from '../lib/compatibility.js';

export const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const expiredNow = sweepExpired(req.user);
  const units = availableUnits();

  const critical = units.filter((u) => expiryBucket(u.expires_on) === 'critical');
  const soon = units.filter((u) => expiryBucket(u.expires_on) === 'soon');

  const counts = {
    availableUnits: units.length,
    patients: get('SELECT COUNT(*) AS n FROM patients').n,
    donors: get('SELECT COUNT(*) AS n FROM donors').n,
    assessments: get('SELECT COUNT(*) AS n FROM assessments').n,
    pendingRequests: get("SELECT COUNT(*) AS n FROM requests WHERE status = 'pending'").n,
    reservedRequests: get("SELECT COUNT(*) AS n FROM requests WHERE status = 'reserved'").n,
    pendingScreening: get("SELECT COUNT(*) AS n FROM donations WHERE screening = 'pending'").n,
    quarantinedUnits: get("SELECT COUNT(*) AS n FROM units WHERE status = 'quarantined'").n,
    issuedLast30: get("SELECT COUNT(*) AS n FROM units WHERE status = 'issued' AND issued_on >= ?", addDays(today(), -30)).n,
    discardedLast30: get(
      "SELECT COUNT(*) AS n FROM units WHERE status IN ('discarded','expired') AND created_at >= ?",
      addDays(today(), -30) + 'T00:00:00.000Z',
    ).n,
  };

  // Review-status mix across stored assessments.
  const reviewMix = all('SELECT review_status, COUNT(*) AS n FROM assessments GROUP BY review_status ORDER BY n DESC');

  // Which rules fire most often. Useful when tuning a rule set.
  const flagCounts = {};
  for (const row of all('SELECT flags_json FROM assessments')) {
    for (const f of JSON.parse(row.flags_json)) {
      if (f.severity === 'info') continue;
      const e = (flagCounts[f.id] ||= { id: f.id, title: f.title, severity: f.severity, count: 0 });
      e.count++;
    }
  }
  const topFlags = Object.values(flagCounts).sort((a, b) => b.count - a.count).slice(0, 6);

  return res.json({
    asOf: today(),
    sweptExpired: expiredNow,
    counts,
    byGroup: stockSummary(units),
    byComponent: Object.fromEntries(
      Object.keys(COMPONENTS).map((c) => [c, units.filter((u) => u.component === c).length]),
    ),
    expiryAlerts: {
      critical: critical.map((u) => ({ ...u, daysToExpiry: daysToExpiry(u.expires_on) })),
      soonCount: soon.length,
    },
    issueTrend: dailySeries(issueEvents(null, 30), 30),
    dailyIssueRate: dailyIssueRate(),
    reviewMix,
    topFlags,
    openRequests: all(
      `SELECT r.id, r.request_code, r.component, r.blood_group, r.units_requested, r.urgency, r.status, r.created_at,
              p.mrn, p.full_name AS patient_name
         FROM requests r JOIN patients p ON p.id = r.patient_id
        WHERE r.status IN ('pending','reserved')
        ORDER BY CASE r.urgency WHEN 'emergency' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END, r.id DESC
        LIMIT 10`,
    ),
    recentAssessments: all(
      `SELECT a.id, a.created_at, a.review_status, a.clinical_context, a.hb_g_dl, a.blood_group,
              p.mrn, p.full_name AS patient_name
         FROM assessments a JOIN patients p ON p.id = a.patient_id
        ORDER BY a.id DESC LIMIT 8`,
    ),
  });
});
