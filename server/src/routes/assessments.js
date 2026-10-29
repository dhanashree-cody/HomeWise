import { Router } from 'express';
import { all, get, run, nowIso } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { HttpError, validate } from '../lib/validate.js';
import { activeRuleSet, readinessFor, runRules, parseRuleSet, sweepExpired } from '../services.js';
import { diffFlags } from '../lib/rules.js';
import { BLOOD_GROUPS, COMPONENTS } from '../lib/compatibility.js';

export const router = Router();
router.use(requireAuth);

const CONTEXTS = ['medical', 'surgical', 'perioperative', 'cardiac', 'obstetric', 'oncology', 'trauma', 'critical care'];

const INPUT_SPEC = {
  patient_id: { type: 'int', required: true },
  clinical_context: { type: 'enum', required: true, values: CONTEXTS },
  hb_g_dl: { type: 'number', min: 0, max: 30 },
  heart_rate: { type: 'int', min: 0, max: 300 },
  systolic_bp: { type: 'int', min: 0, max: 300 },
  blood_group: { type: 'enum', values: BLOOD_GROUPS },
  component: { type: 'enum', values: Object.keys(COMPONENTS), default: 'PRBC' },
  units_requested: { type: 'int', min: 1, max: 20, default: 1 },
  active_bleeding: { type: 'bool', default: 0 },
  prior_reaction: { type: 'bool', default: 0 },
};

/** Shape the stored row back into the object the rule engine consumes. */
function inputsFor(data, patient) {
  return {
    age: patient.age,
    sex: patient.sex,
    clinical_context: data.clinical_context,
    hb_g_dl: data.hb_g_dl,
    heart_rate: data.heart_rate,
    systolic_bp: data.systolic_bp,
    blood_group: data.blood_group || patient.blood_group,
    component: data.component,
    units_requested: data.units_requested,
    active_bleeding: data.active_bleeding === 1,
    prior_reaction: data.prior_reaction === 1,
  };
}

/**
 * Preview: evaluate without saving. Lets the form show flags and readiness
 * live as the clinician types, which is the point of the coupled view.
 */
router.post('/preview', (req, res) => {
  const data = validate(req.body, INPUT_SPEC);
  const patient = get('SELECT * FROM patients WHERE id = ?', data.patient_id);
  if (!patient) throw new HttpError(404, 'Patient not found');

  sweepExpired(req.user);
  const ruleSetRow = activeRuleSet();
  const inputs = inputsFor(data, patient);
  const evaluation = runRules(ruleSetRow, inputs);
  const readiness = readinessFor({
    bloodGroup: inputs.blood_group,
    component: inputs.component,
    unitsRequested: inputs.units_requested,
  });

  res.json({
    patient,
    inputs,
    ruleSet: { id: ruleSetRow.id, version: ruleSetRow.version, title: ruleSetRow.title },
    ...evaluation,
    readiness,
  });
});

router.post('/', requireRole('clinician'), (req, res) => {
  const data = validate(req.body, INPUT_SPEC);
  const patient = get('SELECT * FROM patients WHERE id = ?', data.patient_id);
  if (!patient) throw new HttpError(404, 'Patient not found');

  sweepExpired(req.user);
  const ruleSetRow = activeRuleSet();
  const inputs = inputsFor(data, patient);
  const evaluation = runRules(ruleSetRow, inputs);
  const readiness = readinessFor({
    bloodGroup: inputs.blood_group,
    component: inputs.component,
    unitsRequested: inputs.units_requested,
  });

  const info = run(
    `INSERT INTO assessments
       (patient_id, rule_set_id, clinical_context, hb_g_dl, heart_rate, systolic_bp, blood_group,
        component, units_requested, active_bleeding, prior_reaction,
        inputs_json, flags_json, readiness_json, review_status, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    patient.id, ruleSetRow.id, data.clinical_context, data.hb_g_dl, data.heart_rate, data.systolic_bp,
    inputs.blood_group, data.component, data.units_requested, data.active_bleeding, data.prior_reaction,
    JSON.stringify(inputs), JSON.stringify(evaluation.flags), JSON.stringify(readiness),
    evaluation.reviewStatus, req.user.id, nowIso(),
  );

  audit(req.user, 'assessment.create', 'assessment', info.lastInsertRowid, {
    patientMrn: patient.mrn,
    ruleSetVersion: ruleSetRow.version,
    reviewStatus: evaluation.reviewStatus,
    flagIds: evaluation.flags.map((f) => f.id),
    fulfilment: readiness.fulfilment,
  });

  res.status(201).json({ assessment: hydrate(get('SELECT * FROM assessments WHERE id = ?', info.lastInsertRowid)) });
});

function hydrate(row) {
  if (!row) return null;
  const ruleSet = get('SELECT version, title FROM rule_sets WHERE id = ?', row.rule_set_id);
  const patient = get('SELECT mrn, full_name, age, sex, ward FROM patients WHERE id = ?', row.patient_id);
  const author = get('SELECT full_name, role FROM users WHERE id = ?', row.created_by);
  return {
    ...row,
    inputs: JSON.parse(row.inputs_json),
    flags: JSON.parse(row.flags_json),
    readiness: JSON.parse(row.readiness_json),
    ruleSet,
    patient,
    author,
  };
}

router.get('/', (req, res) => {
  const rows = all(
    `SELECT a.*, p.mrn, p.full_name AS patient_name, rs.version AS rule_version
       FROM assessments a
       JOIN patients p ON p.id = a.patient_id
       JOIN rule_sets rs ON rs.id = a.rule_set_id
      ORDER BY a.id DESC LIMIT 200`,
  );
  res.json({
    assessments: rows.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      mrn: r.mrn,
      patient_name: r.patient_name,
      clinical_context: r.clinical_context,
      hb_g_dl: r.hb_g_dl,
      blood_group: r.blood_group,
      component: r.component,
      units_requested: r.units_requested,
      review_status: r.review_status,
      rule_version: r.rule_version,
      flagCount: JSON.parse(r.flags_json).filter((f) => f.severity !== 'info').length,
      fulfilment: JSON.parse(r.readiness_json).fulfilment,
    })),
  });
});

// Declared before '/:id' so that 'meta' is not swallowed as an id.
router.get('/meta/contexts', (_req, res) => {
  res.json({ contexts: CONTEXTS, components: COMPONENTS, bloodGroups: BLOOD_GROUPS });
});

router.get('/:id', (req, res) => {
  const row = get('SELECT * FROM assessments WHERE id = ?', Number(req.params.id));
  if (!row) throw new HttpError(404, 'Assessment not found');
  res.json({ assessment: hydrate(row) });
});

/**
 * RULE REPLAY.
 *
 * Re-evaluate a stored assessment against a different rule set and show what
 * changes. This is what makes a threshold change reviewable: a governance
 * group can see which past cases would have flagged differently before they
 * approve the new version, instead of finding out afterwards.
 *
 * Replay never alters the stored assessment. The original flags, and the rule
 * version that produced them, stay exactly as they were recorded.
 */
router.get('/:id/replay/:ruleSetId', (req, res) => {
  const row = get('SELECT * FROM assessments WHERE id = ?', Number(req.params.id));
  if (!row) throw new HttpError(404, 'Assessment not found');
  const target = get('SELECT * FROM rule_sets WHERE id = ?', Number(req.params.ruleSetId));
  if (!target) throw new HttpError(404, 'Rule set not found');

  const original = get('SELECT * FROM rule_sets WHERE id = ?', row.rule_set_id);
  const inputs = JSON.parse(row.inputs_json);
  const before = JSON.parse(row.flags_json);
  const replayed = runRules(target, inputs);

  audit(req.user, 'assessment.replay', 'assessment', row.id, {
    fromVersion: original.version,
    toVersion: target.version,
  });

  res.json({
    assessmentId: row.id,
    inputs,
    original: { ruleSet: { id: original.id, version: original.version, title: original.title }, flags: before, reviewStatus: row.review_status },
    replayed: { ruleSet: { id: target.id, version: target.version, title: target.title }, flags: replayed.flags, reviewStatus: replayed.reviewStatus },
    diff: diffFlags(before, replayed.flags),
    note: 'Replay is read-only. The stored assessment and the rule version that produced it are unchanged.',
  });
});
