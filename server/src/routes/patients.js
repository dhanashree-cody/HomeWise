import { Router } from 'express';
import { all, get, run, nowIso } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { HttpError, validate } from '../lib/validate.js';
import { nextCode } from '../services.js';
import { BLOOD_GROUPS } from '../lib/compatibility.js';

export const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const rows = q
    ? all(
        `SELECT * FROM patients WHERE mrn LIKE ? OR full_name LIKE ? OR ward LIKE ?
         ORDER BY id DESC LIMIT 200`,
        '%' + q + '%', '%' + q + '%', '%' + q + '%',
      )
    : all('SELECT * FROM patients ORDER BY id DESC LIMIT 200');
  res.json({ patients: rows });
});

router.get('/:id', (req, res) => {
  const patient = get('SELECT * FROM patients WHERE id = ?', Number(req.params.id));
  if (!patient) throw new HttpError(404, 'Patient not found');
  const assessments = all(
    'SELECT id, created_at, clinical_context, hb_g_dl, blood_group, review_status FROM assessments WHERE patient_id = ? ORDER BY id DESC',
    patient.id,
  );
  const requests = all('SELECT * FROM requests WHERE patient_id = ? ORDER BY id DESC', patient.id);
  const transfused = all(
    "SELECT unit_code, component, blood_group, issued_on FROM units WHERE issued_to = ? AND status = 'issued' ORDER BY issued_on DESC",
    patient.id,
  );
  res.json({ patient, assessments, requests, transfused });
});

router.post('/', requireRole('clinician'), (req, res) => {
  const data = validate(req.body, {
    full_name: { type: 'string', required: true, minLength: 2, maxLength: 80 },
    age: { type: 'int', required: true, min: 0, max: 120 },
    sex: { type: 'enum', required: true, values: ['M', 'F', 'O'] },
    blood_group: { type: 'enum', values: BLOOD_GROUPS },
    ward: { type: 'string', maxLength: 60 },
    notes: { type: 'string', maxLength: 500 },
  });

  const mrn = nextCode('patients', 'mrn', 'SYN-', 5);
  const info = run(
    `INSERT INTO patients (mrn, full_name, age, sex, blood_group, ward, notes, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    mrn, data.full_name, data.age, data.sex, data.blood_group, data.ward, data.notes, nowIso(), req.user.id,
  );
  const patient = get('SELECT * FROM patients WHERE id = ?', info.lastInsertRowid);
  audit(req.user, 'patient.create', 'patient', patient.id, { mrn });
  res.status(201).json({ patient });
});

router.patch('/:id', requireRole('clinician'), (req, res) => {
  const id = Number(req.params.id);
  const existing = get('SELECT * FROM patients WHERE id = ?', id);
  if (!existing) throw new HttpError(404, 'Patient not found');

  const data = validate(req.body, {
    full_name: { type: 'string', required: true, minLength: 2, maxLength: 80 },
    age: { type: 'int', required: true, min: 0, max: 120 },
    sex: { type: 'enum', required: true, values: ['M', 'F', 'O'] },
    blood_group: { type: 'enum', values: BLOOD_GROUPS },
    ward: { type: 'string', maxLength: 60 },
    notes: { type: 'string', maxLength: 500 },
  });

  run(
    'UPDATE patients SET full_name=?, age=?, sex=?, blood_group=?, ward=?, notes=? WHERE id=?',
    data.full_name, data.age, data.sex, data.blood_group, data.ward, data.notes, id,
  );
  audit(req.user, 'patient.update', 'patient', id, { before: existing, after: data });
  res.json({ patient: get('SELECT * FROM patients WHERE id = ?', id) });
});
