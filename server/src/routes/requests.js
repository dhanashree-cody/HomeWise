import { Router } from 'express';
import { all, get, run, tx, nowIso } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { HttpError, validate } from '../lib/validate.js';
import { nextCode, readinessFor, sweepExpired } from '../services.js';
import { isCompatible, BLOOD_GROUPS, COMPONENTS } from '../lib/compatibility.js';
import { daysToExpiry, today } from '../lib/expiry.js';

export const router = Router();
router.use(requireAuth);

/**
 * The checklist the blood bank must complete before units can be reserved.
 *
 * The prototype does not and cannot perform these steps. It records that an
 * authorised person confirmed each one, so the audit trail shows who attested
 * to what. Every item must be ticked before a reservation is accepted.
 */
export const CROSSMATCH_CHECKLIST = [
  { id: 'IDENTITY', text: 'Patient identity and sample label verified against the request' },
  { id: 'GROUPING', text: 'Patient ABO/RhD group confirmed on a current sample' },
  { id: 'ANTIBODY', text: 'Antibody screen performed and result reviewed' },
  { id: 'CROSSMATCH', text: 'Crossmatch performed and compatible for the selected units' },
  { id: 'INSPECTION', text: 'Units visually inspected; seal, colour and expiry acceptable' },
  { id: 'AUTHORISED', text: 'Release authorised by the responsible blood-bank officer' },
];

router.get('/checklist', (_req, res) => {
  res.json({
    checklist: CROSSMATCH_CHECKLIST,
    note: 'HemoWise records attestation only. It does not perform grouping, antibody screening or crossmatching.',
  });
});

router.get('/', (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const sql =
    `SELECT r.*, p.mrn, p.full_name AS patient_name, p.ward,
            u1.full_name AS raised_by_name, u2.full_name AS actioned_by_name,
            (SELECT COUNT(*) FROM units un WHERE un.reserved_for = r.id AND un.status = 'reserved') AS reserved_count,
            (SELECT COUNT(*) FROM units un WHERE un.reserved_for = r.id AND un.status = 'issued') AS issued_count
       FROM requests r
       JOIN patients p ON p.id = r.patient_id
       LEFT JOIN users u1 ON u1.id = r.raised_by
       LEFT JOIN users u2 ON u2.id = r.actioned_by` +
    (status ? ' WHERE r.status = ?' : '') +
    ' ORDER BY CASE r.urgency WHEN \'emergency\' THEN 0 WHEN \'urgent\' THEN 1 ELSE 2 END, r.id DESC LIMIT 200';
  res.json({ requests: status ? all(sql, status) : all(sql) });
});

router.get('/:id', (req, res) => {
  const request = get('SELECT * FROM requests WHERE id = ?', Number(req.params.id));
  if (!request) throw new HttpError(404, 'Request not found');
  const patient = get('SELECT * FROM patients WHERE id = ?', request.patient_id);
  const units = all('SELECT * FROM units WHERE reserved_for = ? ORDER BY expires_on', request.id);
  const assessment = request.assessment_id
    ? get('SELECT id, review_status, flags_json, created_at FROM assessments WHERE id = ?', request.assessment_id)
    : null;

  res.json({
    request: { ...request, crossmatch: request.crossmatch_json ? JSON.parse(request.crossmatch_json) : null },
    patient,
    units: units.map((u) => ({ ...u, daysToExpiry: daysToExpiry(u.expires_on) })),
    assessment: assessment ? { ...assessment, flags: JSON.parse(assessment.flags_json) } : null,
    readiness: request.status === 'pending'
      ? readinessFor({ bloodGroup: request.blood_group, component: request.component, unitsRequested: request.units_requested })
      : null,
  });
});

/** A clinician raises a request, normally from an assessment. */
router.post('/', requireRole('clinician'), (req, res) => {
  const data = validate(req.body, {
    patient_id: { type: 'int', required: true },
    assessment_id: { type: 'int' },
    component: { type: 'enum', required: true, values: Object.keys(COMPONENTS) },
    blood_group: { type: 'enum', required: true, values: BLOOD_GROUPS },
    units_requested: { type: 'int', required: true, min: 1, max: 20 },
    urgency: { type: 'enum', required: true, values: ['routine', 'urgent', 'emergency'] },
    note: { type: 'string', maxLength: 500 },
  });

  const patient = get('SELECT * FROM patients WHERE id = ?', data.patient_id);
  if (!patient) throw new HttpError(404, 'Patient not found');
  if (data.assessment_id && !get('SELECT 1 FROM assessments WHERE id = ?', data.assessment_id)) {
    throw new HttpError(404, 'Assessment not found');
  }

  const code = nextCode('requests', 'request_code', 'REQ-', 5);
  const ts = nowIso();
  const info = run(
    `INSERT INTO requests (request_code, patient_id, assessment_id, component, blood_group, units_requested,
                           urgency, status, note, raised_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,'pending',?,?,?,?)`,
    code, patient.id, data.assessment_id, data.component, data.blood_group, data.units_requested,
    data.urgency, data.note, req.user.id, ts, ts,
  );

  audit(req.user, 'request.raise', 'request', info.lastInsertRowid, {
    requestCode: code, mrn: patient.mrn, component: data.component, group: data.blood_group,
    units: data.units_requested, urgency: data.urgency,
  });
  res.status(201).json({ request: get('SELECT * FROM requests WHERE id = ?', info.lastInsertRowid) });
});

/**
 * Reserve units against a request.
 *
 * The blood bank may accept the engine's FEFO plan or name its own units. In
 * either case every unit is re-checked here, inside the transaction, for
 * availability, compatibility and expiry. The suggestion from the readiness
 * engine is never trusted as authorisation.
 */
router.post('/:id/reserve', requireRole('bloodbank'), (req, res) => {
  const request = get('SELECT * FROM requests WHERE id = ?', Number(req.params.id));
  if (!request) throw new HttpError(404, 'Request not found');
  if (request.status !== 'pending') throw new HttpError(409, 'Request ' + request.request_code + ' is ' + request.status + ', not pending');

  sweepExpired(req.user);
  const body = req.body || {};
  const checklist = body.crossmatch || {};
  const missing = CROSSMATCH_CHECKLIST.filter((c) => checklist[c.id] !== true);
  if (missing.length) {
    throw new HttpError(400, 'Every pre-release check must be confirmed before units can be reserved', {
      outstanding: missing.map((c) => ({ id: c.id, text: c.text })),
    });
  }

  // Default to the readiness plan when the blood bank does not name units.
  let unitIds = Array.isArray(body.unitIds) ? body.unitIds.map(Number) : null;
  if (!unitIds || !unitIds.length) {
    const plan = readinessFor({
      bloodGroup: request.blood_group, component: request.component, unitsRequested: request.units_requested,
    });
    unitIds = plan.allocation.map((u) => u.unitId);
  }
  if (!unitIds.length) throw new HttpError(409, 'No compatible units are available to reserve');

  const reserved = tx(() => {
    const out = [];
    for (const id of unitIds) {
      const unit = get('SELECT * FROM units WHERE id = ?', id);
      if (!unit) throw new HttpError(404, 'Unit ' + id + ' not found');
      if (unit.status !== 'available') throw new HttpError(409, 'Unit ' + unit.unit_code + ' is ' + unit.status + ' and cannot be reserved');
      if (unit.component !== request.component) throw new HttpError(409, 'Unit ' + unit.unit_code + ' is ' + unit.component + ', not ' + request.component);
      if (daysToExpiry(unit.expires_on) < 0) throw new HttpError(409, 'Unit ' + unit.unit_code + ' expired on ' + unit.expires_on);
      if (!isCompatible(request.blood_group, unit.blood_group, request.component)) {
        throw new HttpError(409, 'Unit ' + unit.unit_code + ' (' + unit.blood_group + ') is not compatible with recipient group ' + request.blood_group);
      }
      run("UPDATE units SET status = 'reserved', reserved_for = ? WHERE id = ?", request.id, id);
      out.push(get('SELECT * FROM units WHERE id = ?', id));
    }
    run("UPDATE requests SET status = 'reserved', crossmatch_json = ?, actioned_by = ?, updated_at = ? WHERE id = ?",
      JSON.stringify({ confirmedBy: req.user.full_name, confirmedAt: nowIso(), checks: checklist }), req.user.id, nowIso(), request.id);
    return out;
  });

  audit(req.user, 'request.reserve', 'request', request.id, {
    requestCode: request.request_code, unitCodes: reserved.map((u) => u.unit_code), checklistConfirmed: true,
  });
  res.json({ request: get('SELECT * FROM requests WHERE id = ?', request.id), units: reserved });
});

/** Issue the reserved units to the patient. Completes the traceability chain. */
router.post('/:id/issue', requireRole('bloodbank'), (req, res) => {
  const request = get('SELECT * FROM requests WHERE id = ?', Number(req.params.id));
  if (!request) throw new HttpError(404, 'Request not found');
  if (request.status !== 'reserved') throw new HttpError(409, 'Request ' + request.request_code + ' is ' + request.status + '; reserve units before issuing');

  const units = all("SELECT * FROM units WHERE reserved_for = ? AND status = 'reserved'", request.id);
  if (!units.length) throw new HttpError(409, 'No reserved units remain on this request');

  tx(() => {
    for (const u of units) {
      run("UPDATE units SET status = 'issued', issued_to = ?, issued_on = ? WHERE id = ?", request.patient_id, today(), u.id);
    }
    run("UPDATE requests SET status = 'issued', actioned_by = ?, updated_at = ? WHERE id = ?", req.user.id, nowIso(), request.id);
  });

  audit(req.user, 'request.issue', 'request', request.id, {
    requestCode: request.request_code, patientId: request.patient_id, unitCodes: units.map((u) => u.unit_code),
  });
  res.json({
    request: get('SELECT * FROM requests WHERE id = ?', request.id),
    units: all('SELECT * FROM units WHERE reserved_for = ?', request.id),
  });
});

router.post('/:id/reject', requireRole('bloodbank'), (req, res) => {
  const request = get('SELECT * FROM requests WHERE id = ?', Number(req.params.id));
  if (!request) throw new HttpError(404, 'Request not found');
  if (request.status === 'issued') throw new HttpError(409, 'Issued requests cannot be rejected');

  const { reason } = validate(req.body, { reason: { type: 'string', required: true, minLength: 3, maxLength: 300 } });
  tx(() => {
    run("UPDATE units SET status = 'available', reserved_for = NULL WHERE reserved_for = ? AND status = 'reserved'", request.id);
    run("UPDATE requests SET status = 'rejected', note = ?, actioned_by = ?, updated_at = ? WHERE id = ?",
      (request.note ? request.note + ' | ' : '') + 'Rejected: ' + reason, req.user.id, nowIso(), request.id);
  });
  audit(req.user, 'request.reject', 'request', request.id, { requestCode: request.request_code, reason });
  res.json({ request: get('SELECT * FROM requests WHERE id = ?', request.id) });
});

/** Full vein-to-vein trace for one issued unit. */
router.get('/trace/:unitCode', (req, res) => {
  const unit = get('SELECT * FROM units WHERE unit_code = ?', String(req.params.unitCode));
  if (!unit) throw new HttpError(404, 'Unit not found');
  const donation = unit.donation_id ? get('SELECT * FROM donations WHERE id = ?', unit.donation_id) : null;
  const donor = donation ? get('SELECT donor_code, full_name, blood_group, age, sex FROM donors WHERE id = ?', donation.donor_id) : null;
  const camp = donation?.camp_id ? get('SELECT name, location, scheduled_on FROM camps WHERE id = ?', donation.camp_id) : null;
  const request = unit.reserved_for ? get('SELECT * FROM requests WHERE id = ?', unit.reserved_for) : null;
  const patient = unit.issued_to ? get('SELECT mrn, full_name, ward, blood_group FROM patients WHERE id = ?', unit.issued_to) : null;
  const events = all("SELECT ts, actor_name, action, detail_json FROM audit_log WHERE entity = 'unit' AND entity_id = ? ORDER BY id", String(unit.id));

  res.json({
    unit: { ...unit, daysToExpiry: daysToExpiry(unit.expires_on) },
    chain: { donor, camp, donation, request, patient },
    events,
  });
});
