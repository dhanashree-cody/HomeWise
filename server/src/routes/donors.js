import { Router } from 'express';
import { all, get, run, tx, nowIso } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { HttpError, validate } from '../lib/validate.js';
import { nextCode } from '../services.js';
import { checkEligibility, ELIGIBILITY_CRITERIA } from '../lib/eligibility.js';
import { BLOOD_GROUPS, COMPONENTS } from '../lib/compatibility.js';
import { expiryFor, today } from '../lib/expiry.js';

export const router = Router();
router.use(requireAuth);

router.get('/criteria', (_req, res) => {
  res.json({ criteria: ELIGIBILITY_CRITERIA });
});

router.get('/', (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const rows = q
    ? all(
        'SELECT * FROM donors WHERE donor_code LIKE ? OR full_name LIKE ? OR blood_group = ? ORDER BY id DESC LIMIT 200',
        '%' + q + '%', '%' + q + '%', q,
      )
    : all('SELECT * FROM donors ORDER BY id DESC LIMIT 200');
  res.json({
    donors: rows.map((d) => ({ ...d, eligibility: checkEligibility(d, { hb_g_dl: null }) })),
  });
});

router.get('/:id', (req, res) => {
  const donor = get('SELECT * FROM donors WHERE id = ?', Number(req.params.id));
  if (!donor) throw new HttpError(404, 'Donor not found');
  const donations = all(
    `SELECT d.*, c.name AS camp_name FROM donations d
       LEFT JOIN camps c ON c.id = d.camp_id
      WHERE d.donor_id = ? ORDER BY d.id DESC`,
    donor.id,
  );
  const units = all('SELECT * FROM units WHERE donation_id IN (SELECT id FROM donations WHERE donor_id = ?)', donor.id);
  res.json({ donor, donations, units, eligibility: checkEligibility(donor) });
});

router.post('/', requireRole('bloodbank'), (req, res) => {
  const data = validate(req.body, {
    full_name: { type: 'string', required: true, minLength: 2, maxLength: 80 },
    age: { type: 'int', required: true, min: 16, max: 100 },
    sex: { type: 'enum', required: true, values: ['M', 'F', 'O'] },
    blood_group: { type: 'enum', required: true, values: BLOOD_GROUPS },
    weight_kg: { type: 'number', min: 20, max: 250 },
    phone: { type: 'string', maxLength: 20 },
    last_donated_on: { type: 'date' },
  });

  const code = nextCode('donors', 'donor_code', 'D-', 5);
  const info = run(
    `INSERT INTO donors (donor_code, full_name, age, sex, blood_group, weight_kg, phone, last_donated_on, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    code, data.full_name, data.age, data.sex, data.blood_group, data.weight_kg, data.phone, data.last_donated_on, nowIso(),
  );
  const donor = get('SELECT * FROM donors WHERE id = ?', info.lastInsertRowid);
  audit(req.user, 'donor.create', 'donor', donor.id, { donorCode: code, group: data.blood_group });
  res.status(201).json({ donor, eligibility: checkEligibility(donor) });
});

/** Run the eligibility screen with a measured haemoglobin. */
router.post('/:id/screen', requireRole('bloodbank'), (req, res) => {
  const donor = get('SELECT * FROM donors WHERE id = ?', Number(req.params.id));
  if (!donor) throw new HttpError(404, 'Donor not found');
  const { hb_g_dl } = validate(req.body, { hb_g_dl: { type: 'number', required: true, min: 1, max: 25 } });
  const result = checkEligibility(donor, { hb_g_dl });
  audit(req.user, 'donor.screen', 'donor', donor.id, { hb_g_dl, eligible: result.eligible, blockers: result.blockers });
  res.json({ donor, eligibility: result });
});

router.post('/:id/defer', requireRole('bloodbank'), (req, res) => {
  const donor = get('SELECT * FROM donors WHERE id = ?', Number(req.params.id));
  if (!donor) throw new HttpError(404, 'Donor not found');
  const data = validate(req.body, {
    deferred_until: { type: 'date', required: true },
    deferral_reason: { type: 'string', required: true, minLength: 3, maxLength: 200 },
  });
  run('UPDATE donors SET deferred_until = ?, deferral_reason = ? WHERE id = ?', data.deferred_until, data.deferral_reason, donor.id);
  audit(req.user, 'donor.defer', 'donor', donor.id, data);
  res.json({ donor: get('SELECT * FROM donors WHERE id = ?', donor.id) });
});

/**
 * Record a donation.
 *
 * This is where the donor side meets the inventory side: a donation creates
 * the physical units, each carrying its donation id, so every transfused unit
 * can be traced back to the donor it came from.
 *
 * Units start QUARANTINED. They only reach the shelf once screening is
 * recorded as passed, which mirrors how a real blood bank withholds a
 * component until its mandatory tests are complete.
 */
router.post('/:id/donate', requireRole('bloodbank'), (req, res) => {
  const donor = get('SELECT * FROM donors WHERE id = ?', Number(req.params.id));
  if (!donor) throw new HttpError(404, 'Donor not found');

  const data = validate(req.body, {
    donated_on: { type: 'date', required: true },
    hb_g_dl: { type: 'number', required: true, min: 1, max: 25 },
    volume_ml: { type: 'int', min: 100, max: 600, default: 450 },
    camp_id: { type: 'int' },
    components: { type: 'string', default: 'PRBC,FFP' },
    override_reason: { type: 'string', maxLength: 200 },
  });

  if (data.donated_on > today()) throw new HttpError(400, 'Donation date cannot be in the future');

  const eligibility = checkEligibility(donor, { hb_g_dl: data.hb_g_dl, onDate: data.donated_on });
  if (!eligibility.eligible && !data.override_reason) {
    throw new HttpError(409, 'Donor does not meet the screening criteria', {
      blockers: eligibility.blockers,
      hint: 'Supply override_reason to record this donation anyway. The override and its reason are written to the audit log.',
    });
  }

  const components = data.components.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
  for (const c of components) if (!COMPONENTS[c]) throw new HttpError(400, 'Unknown component: ' + c);

  const result = tx(() => {
    const info = run(
      `INSERT INTO donations (donor_id, camp_id, donated_on, hb_g_dl, volume_ml, screening, recorded_by, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      donor.id, data.camp_id, data.donated_on, data.hb_g_dl, data.volume_ml, 'pending', req.user.id, nowIso(),
    );
    const donationId = info.lastInsertRowid;

    const units = components.map((component) => {
      const code = nextCode('units', 'unit_code', 'U-', 6);
      const u = run(
        `INSERT INTO units (unit_code, donation_id, component, blood_group, volume_ml, collected_on, expires_on, status, storage_loc, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        code, donationId, component, donor.blood_group,
        component === 'PRBC' ? 280 : component === 'FFP' ? 220 : 150,
        data.donated_on, expiryFor(component, data.donated_on), 'quarantined',
        COMPONENTS[component].storage, nowIso(),
      );
      return get('SELECT * FROM units WHERE id = ?', u.lastInsertRowid);
    });

    run('UPDATE donors SET last_donated_on = ? WHERE id = ?', data.donated_on, donor.id);
    return { donationId, units };
  });

  audit(req.user, 'donation.record', 'donation', result.donationId, {
    donorCode: donor.donor_code,
    eligible: eligibility.eligible,
    override: data.override_reason || null,
    unitCodes: result.units.map((u) => u.unit_code),
  });

  res.status(201).json({
    donation: get('SELECT * FROM donations WHERE id = ?', result.donationId),
    units: result.units,
    eligibility,
    note: 'Units are quarantined until screening is recorded as passed.',
  });
});

/** Record the screening outcome; passing releases the units to the shelf. */
router.post('/donations/:id/screening', requireRole('bloodbank'), (req, res) => {
  const donation = get('SELECT * FROM donations WHERE id = ?', Number(req.params.id));
  if (!donation) throw new HttpError(404, 'Donation not found');
  if (donation.screening !== 'pending') throw new HttpError(409, 'Screening for this donation is already recorded as ' + donation.screening);

  const data = validate(req.body, {
    outcome: { type: 'enum', required: true, values: ['passed', 'failed'] },
    reason: { type: 'string', maxLength: 200 },
  });
  if (data.outcome === 'failed' && !data.reason) throw new HttpError(400, 'A reason is required when screening fails');

  const affected = tx(() => {
    run('UPDATE donations SET screening = ? WHERE id = ?', data.outcome, donation.id);
    if (data.outcome === 'passed') {
      run("UPDATE units SET status = 'available' WHERE donation_id = ? AND status = 'quarantined'", donation.id);
    } else {
      run("UPDATE units SET status = 'discarded', discard_reason = ? WHERE donation_id = ? AND status = 'quarantined'",
        'Screening failed: ' + data.reason, donation.id);
    }
    return all('SELECT * FROM units WHERE donation_id = ?', donation.id);
  });

  audit(req.user, 'donation.screening', 'donation', donation.id, {
    outcome: data.outcome, reason: data.reason || null, unitCodes: affected.map((u) => u.unit_code),
  });
  res.json({ donation: get('SELECT * FROM donations WHERE id = ?', donation.id), units: affected });
});

router.get('/donations/pending', (_req, res) => {
  res.json({
    donations: all(
      `SELECT d.*, dn.donor_code, dn.full_name, dn.blood_group,
              (SELECT COUNT(*) FROM units u WHERE u.donation_id = d.id) AS unit_count
         FROM donations d JOIN donors dn ON dn.id = d.donor_id
        WHERE d.screening = 'pending' ORDER BY d.id DESC`,
    ),
  });
});
