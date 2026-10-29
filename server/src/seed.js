/**
 * Seed the prototype with SYNTHETIC demonstration data.
 *
 * Every name, identifier, measurement and stock figure below is invented for
 * the demonstration. No real patient, donor or blood-bank record is used.
 *
 * The data is shaped to make the system's behaviour visible rather than
 * flattering: stock is deliberately uneven, some units are days from expiry,
 * one group is short, and several assessments have missing fields so the
 * data-quality guard has something to catch.
 *
 * Run with:  npm run seed          (in the server folder)
 */
import { migrate, db, run, get, all, tx, nowIso } from './db.js';
import { hashPassword } from './auth.js';
import { audit } from './audit.js';
import { RULESET_V1, RULESET_V1_1, evaluate } from './lib/rules.js';
import { assessReadiness } from './lib/readiness.js';
import { expiryFor, addDays, today } from './lib/expiry.js';
import { COMPONENTS, BLOOD_GROUPS } from './lib/compatibility.js';

// Deterministic pseudo-random generator, so every seed run and every demo
// produces exactly the same database. Reviewers can reproduce screenshots.
let _s = 20260924;
const rnd = () => ((_s = (_s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const num = (lo, hi, dp = 1) => Number((lo + rnd() * (hi - lo)).toFixed(dp));
const chance = (p) => rnd() < p;

/** Weighted draw reflecting a commonly cited Indian blood-group distribution. */
const GROUP_WEIGHTS = [
  ['O+', 37], ['B+', 32], ['A+', 21], ['AB+', 7],
  ['O-', 1.4], ['B-', 0.6], ['A-', 0.5], ['AB-', 0.2],
];
const GROUP_TOTAL = GROUP_WEIGHTS.reduce((s, [, w]) => s + w, 0);
function pickGroup() {
  let r = rnd() * GROUP_TOTAL;
  for (const [g, w] of GROUP_WEIGHTS) { if ((r -= w) <= 0) return g; }
  return 'O+';
}

const FIRST = ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Ananya', 'Ishaan', 'Saanvi', 'Vihaan', 'Aditi',
  'Arjun', 'Kavya', 'Nikhil', 'Priya', 'Rahul', 'Sneha', 'Varun', 'Tara', 'Dev', 'Nisha',
  'Karthik', 'Lakshmi', 'Manoj', 'Pooja', 'Suresh', 'Divya', 'Harish', 'Anjali', 'Vikram', 'Reva'];
const LAST = ['Sharma', 'Iyer', 'Nair', 'Reddy', 'Patel', 'Menon', 'Rao', 'Gupta', 'Desai', 'Pillai',
  'Krishnan', 'Joshi', 'Bose', 'Chandran', 'Verma'];
const name = () => pick(FIRST) + ' ' + pick(LAST);

const WARDS = ['Medical Ward A', 'Medical Ward B', 'Surgical Ward', 'ICU', 'Maternity', 'Oncology Day Unit', 'Emergency'];
const CONTEXTS = ['medical', 'surgical', 'perioperative', 'cardiac', 'obstetric', 'oncology', 'trauma', 'critical care'];

function wipe() {
  // Child tables first: units point at requests, requests point at assessments,
  // and everything eventually points at users. Deleting out of order trips a
  // foreign key on the second and every later seed run.
  for (const t of ['audit_log', 'units', 'requests', 'assessments', 'donations', 'camps', 'donors', 'patients', 'rule_sets', 'sessions', 'users']) {
    db.exec('DELETE FROM ' + t);
  }
  db.exec("DELETE FROM sqlite_sequence WHERE name IN ('audit_log','units','donations','camps','donors','assessments','requests','patients','rule_sets','users')");
}

function seedUsers() {
  const users = [
    ['dr.anand', 'Dr. S. Anand', 'clinician', 'clinician123'],
    ['dr.meera', 'Dr. Meera Raghavan', 'clinician', 'clinician123'],
    ['bb.kumar', 'R. Kumar (Blood Bank)', 'bloodbank', 'bloodbank123'],
    ['admin', 'System Administrator', 'admin', 'admin123'],
  ];
  for (const [username, full_name, role, password] of users) {
    const { salt, hash } = hashPassword(password);
    run('INSERT INTO users (username, full_name, role, pw_salt, pw_hash, created_at) VALUES (?,?,?,?,?,?)',
      username, full_name, role, salt, hash, nowIso());
  }
  return get("SELECT * FROM users WHERE username = 'admin'");
}

function seedRuleSets() {
  const store = (rs, active) =>
    run('INSERT INTO rule_sets (version, title, description, rules_json, is_active, approved_by, approved_on, created_at) VALUES (?,?,?,?,?,?,?,?)',
      rs.version, rs.title, rs.description, JSON.stringify(rs), active ? 1 : 0,
      active ? 'Project guide (academic approval only)' : null, active ? nowIso() : null, nowIso());

  store(RULESET_V1, true);
  store(RULESET_V1_1, false);
  return get('SELECT * FROM rule_sets WHERE is_active = 1');
}

function seedCamps() {
  const camps = [
    ['College Blood Drive', 'VSB Engineering College, Karur', -21, 60, 'completed', 'NSS Unit'],
    ['District Hospital Camp', 'Govt. Hospital Grounds, Coimbatore', -9, 80, 'completed', 'District Health Office'],
    ['IT Park Donation Camp', 'Tidel Park, Coimbatore', -2, 50, 'completed', 'Corporate CSR Team'],
    ['Republic Day Mega Camp', 'Town Hall, Coimbatore', 12, 120, 'planned', 'Red Cross Volunteers'],
    ['Rural Outreach Camp', 'PHC Annur', 25, 40, 'planned', 'Rotary Club'],
  ];
  const ids = [];
  for (const [name_, location, offset, target, status, organiser] of camps) {
    const info = run('INSERT INTO camps (name, location, scheduled_on, target_units, status, organiser, created_at) VALUES (?,?,?,?,?,?,?)',
      name_, location, addDays(today(), offset), target, status, organiser, nowIso());
    ids.push({ id: info.lastInsertRowid, offset, status });
  }
  return ids;
}

let unitSeq = 0;
function newUnit(donationId, component, group, collectedOn, status) {
  unitSeq++;
  const code = 'U-' + String(unitSeq).padStart(6, '0');
  const info = run(
    `INSERT INTO units (unit_code, donation_id, component, blood_group, volume_ml, collected_on, expires_on, status, storage_loc, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    code, donationId, component, group,
    component === 'PRBC' ? 280 : component === 'FFP' ? 220 : 150,
    collectedOn, expiryFor(component, collectedOn), status, COMPONENTS[component].storage, nowIso(),
  );
  return { id: info.lastInsertRowid, code, component, group, collectedOn };
}

function newDonation(donorId, campId, donatedOn, hb, screening, recordedBy) {
  const info = run(
    'INSERT INTO donations (donor_id, camp_id, donated_on, hb_g_dl, volume_ml, screening, recorded_by, created_at) VALUES (?,?,?,?,?,?,?,?)',
    donorId, campId, donatedOn, hb, 450, screening, recordedBy, nowIso(),
  );
  run('UPDATE donors SET last_donated_on = ? WHERE id = ? AND (last_donated_on IS NULL OR last_donated_on < ?)',
    donatedOn, donorId, donatedOn);
  return info.lastInsertRowid;
}

/** Donors, their donations, and the units those donations produced. */
function seedDonorsAndStock(camps, adminId) {
  const completedCamps = camps.filter((c) => c.status === 'completed');
  const donorIds = [];
  let seq = 0;

  const addDonor = (group) => {
    seq++;
    const code = 'D-' + String(seq).padStart(5, '0');
    const info = run(
      'INSERT INTO donors (donor_code, full_name, age, sex, blood_group, weight_kg, phone, created_at) VALUES (?,?,?,?,?,?,?,?)',
      code, name(), int(19, 58), chance(0.6) ? 'M' : 'F', group, num(48, 88), '9' + String(int(100000000, 999999999)), nowIso(),
    );
    donorIds.push({ id: info.lastInsertRowid, group, code });
  };

  for (let i = 0; i < 34; i++) addDonor(pickGroup());

  // Every group needs donors on file, or the rarer groups can never be
  // restocked and the compatibility features have nothing to demonstrate.
  for (const g of BLOOD_GROUPS) {
    const have = donorIds.filter((d) => d.group === g).length;
    for (let i = have; i < 2; i++) addDonor(g);
  }

  // Two donors carry an active deferral so the eligibility screen has a case
  // that fails for a reason other than a laboratory value.
  run("UPDATE donors SET deferred_until = ?, deferral_reason = ? WHERE id = ?",
    addDays(today(), 45), 'Recent tattoo - standard deferral period', donorIds[3].id);
  run("UPDATE donors SET deferred_until = ?, deferral_reason = ? WHERE id = ?",
    addDays(today(), 10), 'Low haemoglobin at last screening', donorIds[7].id);

  const allUnits = [];

  // Donations across the last 45 days. Red cells last 42 days, so the oldest
  // of these are already at or past expiry -- which is the point: the sweep
  // and the wastage panel need something real to act on.
  for (let dayOffset = 45; dayOffset >= 0; dayOffset--) {
    const donationsToday = dayOffset % 7 === 0 ? int(3, 6) : int(0, 3);
    const campToday = completedCamps.find((c) => Math.abs(c.offset + dayOffset) < 1);

    for (let d = 0; d < donationsToday; d++) {
      const donor = pick(donorIds);
      const donatedOn = addDays(today(), -dayOffset);
      const hb = num(12.4, 16.8);
      const screening = dayOffset <= 1 ? (chance(0.5) ? 'pending' : 'passed') : chance(0.04) ? 'failed' : 'passed';

      const donationId = newDonation(donor.id, campToday ? campToday.id : null, donatedOn, hb, screening, adminId);
      audit({ id: adminId, full_name: 'R. Kumar (Blood Bank)' }, 'donation.record', 'donation', donationId,
        { donorCode: donor.code, group: donor.group, hb_g_dl: hb },
        donatedOn + 'T10:15:00.000Z');
      if (screening !== 'pending') {
        audit({ id: adminId, full_name: 'R. Kumar (Blood Bank)' }, 'donation.screening', 'donation', donationId,
          { outcome: screening }, addDays(donatedOn, 1) + 'T11:00:00.000Z');
      }

      const components = ['PRBC'];
      if (chance(0.55)) components.push('FFP');
      if (chance(0.2)) components.push('PLT');

      for (const component of components) {
        const status =
          screening === 'pending' ? 'quarantined'
            : screening === 'failed' ? 'discarded'
              : expiryFor(component, donatedOn) < today() ? 'expired' : 'available';
        const u = newUnit(donationId, component, donor.group, donatedOn, status);
        if (status === 'discarded') run("UPDATE units SET discard_reason = 'Screening failed: reactive marker on mandatory testing' WHERE id = ?", u.id);
        allUnits.push({ ...u, status, donationId });
      }
    }
  }

  return { donorIds, units: allUnits };
}

/**
 * Bring the shelf to a believable resting state after historical issues have
 * drawn it down.
 *
 * Without this the common groups are consumed to nothing while rarer ones pile
 * up, which is backwards and makes the demonstration misleading. Targets are
 * loosely proportional to the group distribution, with B-negative left
 * deliberately tight so the shortage advisory has a genuine case to fire on.
 */
const PRBC_TARGET = { 'O+': 13, 'A+': 11, 'B+': 10, 'AB+': 4, 'O-': 4, 'A-': 3, 'B-': 1, 'AB-': 2 };

function balanceStock(donorIds, adminId) {
  let added = 0;
  for (const [group, target] of Object.entries(PRBC_TARGET)) {
    const have = get(
      "SELECT COUNT(*) AS n FROM units WHERE component = 'PRBC' AND blood_group = ? AND status = 'available'",
      group,
    ).n;
    const donors = donorIds.filter((d) => d.group === group);
    if (!donors.length) continue;

    for (let i = have; i < target; i++) {
      // Spread collection dates so the shelf has a realistic age range and the
      // first-expiring-first-out ordering has something to sort.
      const donatedOn = addDays(today(), -int(1, 30));
      const donor = donors[i % donors.length];
      const donationId = newDonation(donor.id, null, donatedOn, num(12.6, 16.4), 'passed', adminId);
      newUnit(donationId, 'PRBC', group, donatedOn, 'available');
      if (chance(0.4)) newUnit(donationId, 'FFP', group, donatedOn, 'available');
      added++;
    }
  }

  // A few platelets collected in the last four days. Their five-day shelf life
  // makes them the sharpest wastage case in the system.
  for (const group of ['O+', 'A+', 'B+']) {
    const donor = donorIds.find((d) => d.group === group);
    if (!donor) continue;
    const donatedOn = addDays(today(), -int(0, 3));
    const donationId = newDonation(donor.id, null, donatedOn, num(12.8, 15.9), 'passed', adminId);
    newUnit(donationId, 'PLT', group, donatedOn, 'available');
    added++;
  }

  return added;
}

function seedPatients(clinicianId) {
  const ids = [];
  let seq = 0;
  const addPatient = (group) => {
    seq++;
    const info = run(
      'INSERT INTO patients (mrn, full_name, age, sex, blood_group, ward, created_at, created_by) VALUES (?,?,?,?,?,?,?,?)',
      'SYN-' + String(seq).padStart(5, '0'), name(), int(19, 84), chance(0.5) ? 'M' : 'F',
      group, pick(WARDS), nowIso(), clinicianId,
    );
    ids.push(info.lastInsertRowid);
  };

  // One patient per group, so every compatibility path -- including the
  // O-negative recipient, who can only receive O-negative -- can be
  // demonstrated without hunting for a suitable record.
  for (const g of BLOOD_GROUPS) addPatient(g);

  for (let i = 0; i < 12; i++) addPatient(pickGroup());

  // Two patients are not yet grouped, so the "no group recorded" path is real.
  addPatient(null);
  addPatient(null);

  return ids;
}

/**
 * Historical transfusions. These give the forecast a demand series to smooth
 * and complete the donor-to-patient trace for units already issued.
 */
function seedHistory(patientIds, bloodbankId, clinicianId) {
  let reqSeq = 0;
  for (let dayOffset = 28; dayOffset >= 1; dayOffset--) {
    const issuesToday = dayOffset % 7 === 0 ? int(0, 2) : int(1, 4);
    for (let k = 0; k < issuesToday; k++) {
      const patientId = pick(patientIds);
      const patient = get('SELECT * FROM patients WHERE id = ?', patientId);
      if (!patient.blood_group) continue;

      const issuedOn = addDays(today(), -dayOffset);
      const component = chance(0.82) ? 'PRBC' : chance(0.5) ? 'FFP' : 'PLT';
      const wanted = int(1, 2);

      // Only units that existed and were usable on that date.
      const candidates = all(
        `SELECT * FROM units
          WHERE component = ? AND blood_group = ? AND status = 'available'
            AND collected_on <= ? AND expires_on >= ?
          ORDER BY expires_on ASC LIMIT ?`,
        component, patient.blood_group, issuedOn, issuedOn, wanted,
      );
      if (!candidates.length) continue;

      reqSeq++;
      const ts = issuedOn + 'T09:00:00.000Z';
      const info = run(
        `INSERT INTO requests (request_code, patient_id, component, blood_group, units_requested, urgency, status,
                               crossmatch_json, raised_by, actioned_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,'issued',?,?,?,?,?)`,
        'REQ-' + String(reqSeq).padStart(5, '0'), patientId, component, patient.blood_group, candidates.length,
        chance(0.15) ? 'urgent' : 'routine',
        JSON.stringify({ confirmedBy: 'R. Kumar (Blood Bank)', confirmedAt: ts, checks: { IDENTITY: true, GROUPING: true, ANTIBODY: true, CROSSMATCH: true, INSPECTION: true, AUTHORISED: true } }),
        clinicianId, bloodbankId, ts, ts,
      );
      for (const u of candidates) {
        run("UPDATE units SET status = 'issued', reserved_for = ?, issued_to = ?, issued_on = ? WHERE id = ?",
          info.lastInsertRowid, patientId, issuedOn, u.id);
      }

      // Replay the ledger entries these actions would have produced, stamped
      // with the date each event is meant to have happened, so the audit page
      // and the chain verification have real history to work with.
      const clinician = { id: clinicianId, full_name: 'Dr. S. Anand' };
      const bb = { id: bloodbankId, full_name: 'R. Kumar (Blood Bank)' };
      const code = 'REQ-' + String(reqSeq).padStart(5, '0');
      const unitCodes = candidates.map((u) => u.unit_code);

      audit(clinician, 'request.raise', 'request', info.lastInsertRowid,
        { requestCode: code, mrn: patient.mrn, component, units: candidates.length },
        issuedOn + 'T08:40:00.000Z');
      audit(bb, 'request.reserve', 'request', info.lastInsertRowid,
        { requestCode: code, unitCodes, checklistConfirmed: true },
        issuedOn + 'T08:55:00.000Z');
      audit(bb, 'request.issue', 'request', info.lastInsertRowid,
        { requestCode: code, patientId, unitCodes },
        issuedOn + 'T09:00:00.000Z');
    }
  }
  return reqSeq;
}

/** A handful of stored assessments, including incomplete ones. */
function seedAssessments(patientIds, ruleSetRow, clinicianId) {
  const ruleSet = { id: ruleSetRow.id, version: ruleSetRow.version, ...JSON.parse(ruleSetRow.rules_json) };
  const availUnits = all("SELECT * FROM units WHERE status = 'available'");

  const scenarios = [
    { hb: 6.4, hr: 118, sbp: 88, bleeding: 1, reaction: 0, ctx: 'trauma', units: 2 },
    { hb: 7.6, hr: 96, sbp: 112, bleeding: 0, reaction: 0, ctx: 'medical', units: 1 },
    { hb: 7.9, hr: 88, sbp: 124, bleeding: 0, reaction: 0, ctx: 'cardiac', units: 2 },
    { hb: 11.2, hr: 76, sbp: 128, bleeding: 0, reaction: 0, ctx: 'surgical', units: 1 },
    { hb: 8.8, hr: 104, sbp: 106, bleeding: 0, reaction: 1, ctx: 'oncology', units: 1 },
    { hb: null, hr: 92, sbp: null, bleeding: 0, reaction: 0, ctx: 'medical', units: 1 },
    { hb: 6.9, hr: 130, sbp: 84, bleeding: 1, reaction: 1, ctx: 'obstetric', units: 3 },
    { hb: 9.4, hr: 82, sbp: 118, bleeding: 0, reaction: 0, ctx: 'perioperative', units: 1 },
  ];

  let n = 0;
  for (const s of scenarios) {
    const patient = get('SELECT * FROM patients WHERE id = ? AND blood_group IS NOT NULL', pick(patientIds))
      || get('SELECT * FROM patients WHERE blood_group IS NOT NULL LIMIT 1');

    const inputs = {
      age: patient.age, sex: patient.sex, clinical_context: s.ctx,
      hb_g_dl: s.hb, heart_rate: s.hr, systolic_bp: s.sbp,
      blood_group: patient.blood_group, component: 'PRBC', units_requested: s.units,
      active_bleeding: s.bleeding === 1, prior_reaction: s.reaction === 1,
    };

    const evaluation = evaluate(ruleSet, inputs);
    const readiness = assessReadiness(
      { bloodGroup: inputs.blood_group, component: 'PRBC', unitsRequested: s.units },
      availUnits, { dailyIssueRate: { PRBC: 2.4 } },
    );

    run(
      `INSERT INTO assessments (patient_id, rule_set_id, clinical_context, hb_g_dl, heart_rate, systolic_bp, blood_group,
                                component, units_requested, active_bleeding, prior_reaction,
                                inputs_json, flags_json, readiness_json, review_status, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      patient.id, ruleSetRow.id, s.ctx, s.hb, s.hr, s.sbp, patient.blood_group, 'PRBC', s.units,
      s.bleeding, s.reaction, JSON.stringify(inputs), JSON.stringify(evaluation.flags),
      JSON.stringify(readiness), evaluation.reviewStatus, clinicianId,
      addDays(today(), -int(0, 6)) + 'T' + String(int(8, 18)).padStart(2, '0') + ':30:00.000Z',
    );
    n++;
  }
  return n;
}

/** Two open requests so the blood-bank queue is not empty on first login. */
function seedOpenRequests(clinicianId) {
  const seq = get('SELECT COUNT(*) AS n FROM requests').n;
  const rows = all(
    `SELECT a.id AS assessment_id, a.patient_id, a.blood_group, a.units_requested
       FROM assessments a WHERE a.blood_group IS NOT NULL AND a.review_status LIKE 'Priority%' LIMIT 2`,
  );
  let i = 0;
  for (const r of rows) {
    i++;
    const ts = nowIso();
    run(
      `INSERT INTO requests (request_code, patient_id, assessment_id, component, blood_group, units_requested,
                             urgency, status, note, raised_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,'pending',?,?,?,?)`,
      'REQ-' + String(seq + i).padStart(5, '0'), r.patient_id, r.assessment_id, 'PRBC', r.blood_group,
      r.units_requested, i === 1 ? 'emergency' : 'urgent',
      'Raised from assessment #' + r.assessment_id + ' for blood-bank review.', clinicianId, ts, ts,
    );
  }
  return i;
}

// ------------------------------------------------------------------- driver

migrate();

tx(() => {
  wipe();
  const admin = seedUsers();
  const clinician = get("SELECT * FROM users WHERE username = 'dr.anand'");
  const bloodbank = get("SELECT * FROM users WHERE username = 'bb.kumar'");

  const ruleSet = seedRuleSets();
  const camps = seedCamps();
  const { donorIds, units } = seedDonorsAndStock(camps, admin.id);
  const patientIds = seedPatients(clinician.id);
  const issuedRequests = seedHistory(patientIds, bloodbank.id, clinician.id);
  // Restock AFTER the historical issues, so the shelf ends in a sensible state.
  balanceStock(donorIds, admin.id);
  const assessmentCount = seedAssessments(patientIds, ruleSet, clinician.id);
  const openRequests = seedOpenRequests(clinician.id);

  audit({ id: admin.id, full_name: 'Seed script' }, 'system.seed', 'database', null, {
    users: 4, ruleSets: 2, camps: camps.length, donors: donorIds.length,
    units: units.length, patients: patientIds.length,
    issuedRequests, openRequests, assessments: assessmentCount,
    note: 'All records are synthetic demonstration data.',
  });
});

const summary = {
  users: get('SELECT COUNT(*) AS n FROM users').n,
  ruleSets: get('SELECT COUNT(*) AS n FROM rule_sets').n,
  donors: get('SELECT COUNT(*) AS n FROM donors').n,
  camps: get('SELECT COUNT(*) AS n FROM camps').n,
  donations: get('SELECT COUNT(*) AS n FROM donations').n,
  patients: get('SELECT COUNT(*) AS n FROM patients').n,
  assessments: get('SELECT COUNT(*) AS n FROM assessments').n,
  requests: get('SELECT COUNT(*) AS n FROM requests').n,
};

console.log('\nHemoWise seeded with synthetic demonstration data.\n');
console.table(summary);
console.table(all('SELECT status, COUNT(*) AS units FROM units GROUP BY status ORDER BY units DESC'));
console.log('\nSign in with:');
console.table([
  { username: 'dr.anand', password: 'clinician123', role: 'clinician' },
  { username: 'bb.kumar', password: 'bloodbank123', role: 'blood bank' },
  { username: 'admin', password: 'admin123', role: 'admin' },
]);
console.log('\nAll data above is synthetic. Not for clinical use.\n');
