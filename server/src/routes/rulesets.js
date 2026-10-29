import { Router } from 'express';
import { all, get, run, tx, nowIso } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { HttpError, validate } from '../lib/validate.js';
import { parseRuleSet, runRules } from '../services.js';
import { diffFlags } from '../lib/rules.js';

export const router = Router();
router.use(requireAuth);

router.get('/', (_req, res) => {
  const rows = all('SELECT * FROM rule_sets ORDER BY id DESC');
  res.json({
    ruleSets: rows.map((r) => ({
      id: r.id, version: r.version, title: r.title, description: r.description,
      is_active: r.is_active, approved_by: r.approved_by, approved_on: r.approved_on,
      created_at: r.created_at, ruleCount: JSON.parse(r.rules_json).rules.length,
      usedBy: get('SELECT COUNT(*) AS n FROM assessments WHERE rule_set_id = ?', r.id).n,
    })),
  });
});

router.get('/:id', (req, res) => {
  const row = get('SELECT * FROM rule_sets WHERE id = ?', Number(req.params.id));
  if (!row) throw new HttpError(404, 'Rule set not found');
  res.json({ ruleSet: { ...parseRuleSet(row), is_active: row.is_active, approved_by: row.approved_by, approved_on: row.approved_on } });
});

/**
 * Compare two rule sets rule by rule, and replay every stored assessment
 * through both. A governance group approving a threshold change can then see
 * the real consequence -- which past cases flag differently -- rather than
 * only the textual diff.
 */
router.get('/:a/compare/:b', (req, res) => {
  const a = get('SELECT * FROM rule_sets WHERE id = ?', Number(req.params.a));
  const b = get('SELECT * FROM rule_sets WHERE id = ?', Number(req.params.b));
  if (!a || !b) throw new HttpError(404, 'Rule set not found');

  const ra = parseRuleSet(a);
  const rb = parseRuleSet(b);
  const idsA = new Map(ra.rules.map((r) => [r.id, r]));
  const idsB = new Map(rb.rules.map((r) => [r.id, r]));

  const ruleDiff = {
    added: rb.rules.filter((r) => !idsA.has(r.id)).map((r) => ({ id: r.id, title: r.title, condition: r.condition })),
    removed: ra.rules.filter((r) => !idsB.has(r.id)).map((r) => ({ id: r.id, title: r.title, condition: r.condition })),
    modified: rb.rules
      .filter((r) => idsA.has(r.id) && JSON.stringify(idsA.get(r.id).when) !== JSON.stringify(r.when))
      .map((r) => ({ id: r.id, title: r.title, from: idsA.get(r.id).condition, to: r.condition })),
  };

  // Impact: replay the stored history through both versions.
  const assessments = all('SELECT id, inputs_json, flags_json FROM assessments ORDER BY id DESC LIMIT 200');
  let changedCount = 0;
  const impacted = [];
  for (const row of assessments) {
    const inputs = JSON.parse(row.inputs_json);
    const fa = runRules(a, inputs).flags;
    const fb = runRules(b, inputs).flags;
    const d = diffFlags(fa, fb);
    if (!d.identical) {
      changedCount++;
      if (impacted.length < 25) impacted.push({ assessmentId: row.id, ...d });
    }
  }

  res.json({
    from: { id: a.id, version: a.version, title: a.title },
    to: { id: b.id, version: b.version, title: b.title },
    ruleDiff,
    impact: { assessmentsChecked: assessments.length, assessmentsChanged: changedCount, examples: impacted },
    note: 'Impact is measured against stored synthetic assessments only. It is not evidence of clinical effect.',
  });
});

/** Activating a version is a governance action, so it is admin-only and logged. */
router.post('/:id/activate', requireRole('admin'), (req, res) => {
  const row = get('SELECT * FROM rule_sets WHERE id = ?', Number(req.params.id));
  if (!row) throw new HttpError(404, 'Rule set not found');
  const { approved_by } = validate(req.body, { approved_by: { type: 'string', required: true, minLength: 2, maxLength: 80 } });

  const previous = get('SELECT version FROM rule_sets WHERE is_active = 1');
  tx(() => {
    run('UPDATE rule_sets SET is_active = 0');
    run('UPDATE rule_sets SET is_active = 1, approved_by = ?, approved_on = ? WHERE id = ?', approved_by, nowIso(), row.id);
  });

  audit(req.user, 'ruleset.activate', 'rule_set', row.id, {
    version: row.version, previousVersion: previous?.version || null, approvedBy: approved_by,
  });
  res.json({
    ruleSet: get('SELECT id, version, title, is_active, approved_by, approved_on FROM rule_sets WHERE id = ?', row.id),
    note: 'Assessments already stored keep the rule version that produced them. Only new assessments use this version.',
  });
});
