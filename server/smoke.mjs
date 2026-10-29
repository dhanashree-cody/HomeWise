/** End-to-end smoke test against a running HemoWise API. */
const BASE = process.env.BASE || 'http://localhost:4000/api';
let pass = 0, fail = 0;
const tokens = {};

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json };
}

function check(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra ? '  -> ' + JSON.stringify(extra).slice(0, 300) : '')); }
}

const login = async (u, p) => {
  const r = await call('POST', '/auth/login', { body: { username: u, password: p } });
  if (r.status !== 200) throw new Error('login failed for ' + u + ': ' + JSON.stringify(r.json));
  return r.json.token;
};

console.log('\n=== HemoWise API smoke test ===\n');

// --- auth -------------------------------------------------------------
console.log('auth');
const health = await call('GET', '/health');
check('health responds', health.status === 200 && health.json.ok, health.json);
check('health names the active rule set', !!health.json?.activeRuleSet?.version, health.json);
check('bad password rejected', (await call('POST', '/auth/login', { body: { username: 'admin', password: 'wrong' } })).status === 401);
check('unauthenticated request rejected', (await call('GET', '/patients')).status === 401);

tokens.clinician = await login('dr.anand', 'clinician123');
tokens.bloodbank = await login('bb.kumar', 'bloodbank123');
tokens.admin = await login('admin', 'admin123');
check('three roles can sign in', !!(tokens.clinician && tokens.bloodbank && tokens.admin));

// --- role gates -------------------------------------------------------
console.log('\nrole gates');
const cliAddUnit = await call('POST', '/inventory/units', {
  token: tokens.clinician,
  body: { component: 'PRBC', blood_group: 'O+', collected_on: new Date().toISOString().slice(0, 10) },
});
check('clinician cannot add stock', cliAddUnit.status === 403, cliAddUnit.json);

const bbPatient = await call('POST', '/patients', {
  token: tokens.bloodbank,
  body: { full_name: 'Test Person', age: 40, sex: 'M' },
});
check('blood bank cannot create patients', bbPatient.status === 403, bbPatient.json);

// --- validation -------------------------------------------------------
console.log('\nvalidation');
const badPatient = await call('POST', '/patients', {
  token: tokens.clinician,
  body: { full_name: 'X', age: 999, sex: 'Q' },
});
check('invalid patient rejected with field errors', badPatient.status === 400 && !!badPatient.json.details, badPatient.json);

// --- patients + assessment -------------------------------------------
console.log('\nassessment');
const newPatient = await call('POST', '/patients', {
  token: tokens.clinician,
  body: { full_name: 'Smoke Test Patient', age: 68, sex: 'F', blood_group: 'A+', ward: 'ICU' },
});
check('patient created', newPatient.status === 201 && !!newPatient.json.patient.mrn, newPatient.json);
const pid = newPatient.json.patient.id;

const preview = await call('POST', '/assessments/preview', {
  token: tokens.clinician,
  body: {
    patient_id: pid, clinical_context: 'trauma', hb_g_dl: 6.2, heart_rate: 122,
    systolic_bp: 86, blood_group: 'A+', component: 'PRBC', units_requested: 2,
    active_bleeding: true, prior_reaction: false,
  },
});
check('preview returns flags', preview.status === 200 && preview.json.flags.length > 0, preview.json);
const flagIds = (preview.json.flags || []).map((f) => f.id);
check('low Hb flagged', flagIds.includes('R-HB-CRITICAL'), flagIds);
check('active bleeding flagged', flagIds.includes('R-BLEED-ACTIVE'), flagIds);
check('hypotension flagged', flagIds.includes('R-SBP-LOW'), flagIds);
check('shock index flagged', flagIds.includes('R-SHOCK-INDEX'), flagIds);
check('review status is priority', preview.json.reviewStatus === 'Priority clinician review', preview.json.reviewStatus);
check('every flag carries evidence', preview.json.flags.every((f) => Array.isArray(f.evidence) && f.evidence.length > 0));
check('readiness computed', !!preview.json.readiness && Array.isArray(preview.json.readiness.allocation), preview.json.readiness);
check('A+ accepts four donor groups', preview.json.readiness.compatibleGroups.length === 4, preview.json.readiness.compatibleGroups);
check('allocation is FEFO ordered', (() => {
  const a = preview.json.readiness.allocation;
  for (let i = 1; i < a.length; i++) {
    if (a[i].rank < a[i - 1].rank) return false;
    if (a[i].rank === a[i - 1].rank && a[i].daysToExpiry < a[i - 1].daysToExpiry) return false;
  }
  return true;
})(), preview.json.readiness.allocation);

// missing-data guard
const incomplete = await call('POST', '/assessments/preview', {
  token: tokens.clinician,
  body: { patient_id: pid, clinical_context: 'medical', heart_rate: 90 },
});
check('missing data raises the data-quality flag',
  incomplete.json.flags.some((f) => f.id === 'R-DATA-INCOMPLETE'), incomplete.json.flags?.map((f) => f.id));
check('missing data does NOT trigger an Hb flag',
  !incomplete.json.flags.some((f) => f.id.startsWith('R-HB')), incomplete.json.flags?.map((f) => f.id));

const saved = await call('POST', '/assessments', {
  token: tokens.clinician,
  body: {
    patient_id: pid, clinical_context: 'trauma', hb_g_dl: 6.2, heart_rate: 122, systolic_bp: 86,
    blood_group: 'A+', component: 'PRBC', units_requested: 2, active_bleeding: true,
  },
});
check('assessment saved', saved.status === 201 && !!saved.json.assessment.id, saved.json);
const aid = saved.json.assessment.id;

// --- rule governance --------------------------------------------------
console.log('\nrule governance');
const sets = await call('GET', '/rulesets', { token: tokens.admin });
check('two rule sets seeded', sets.json.ruleSets.length === 2, sets.json);
const active = sets.json.ruleSets.find((r) => r.is_active);
const draft = sets.json.ruleSets.find((r) => !r.is_active);

const replay = await call('GET', '/assessments/' + aid + '/replay/' + draft.id, { token: tokens.clinician });
check('replay runs against the draft', replay.status === 200, replay.json);
check('replay reports a difference', replay.json.diff && !replay.json.diff.identical, replay.json.diff);
check('replay leaves the original untouched',
  (await call('GET', '/assessments/' + aid, { token: tokens.clinician })).json.assessment.rule_set_id === active.id);

const compare = await call('GET', '/rulesets/' + active.id + '/compare/' + draft.id, { token: tokens.admin });
check('compare reports rule changes', compare.json.ruleDiff.removed.length > 0 || compare.json.ruleDiff.modified.length > 0, compare.json.ruleDiff);
check('compare reports impact on stored cases', compare.json.impact.assessmentsChanged > 0, compare.json.impact);
check('clinician cannot activate a rule set',
  (await call('POST', '/rulesets/' + draft.id + '/activate', { token: tokens.clinician, body: { approved_by: 'X' } })).status === 403);

// --- request lifecycle ------------------------------------------------
console.log('\nrequest lifecycle');
const raised = await call('POST', '/requests', {
  token: tokens.clinician,
  body: { patient_id: pid, assessment_id: aid, component: 'PRBC', blood_group: 'A+', units_requested: 2, urgency: 'urgent' },
});
check('request raised', raised.status === 201, raised.json);
const rid = raised.json.request.id;

const noChecklist = await call('POST', '/requests/' + rid + '/reserve', { token: tokens.bloodbank, body: {} });
check('reserve blocked without the checklist', noChecklist.status === 400 && !!noChecklist.json.details?.outstanding, noChecklist.json);

const partialChecklist = await call('POST', '/requests/' + rid + '/reserve', {
  token: tokens.bloodbank,
  body: { crossmatch: { IDENTITY: true, GROUPING: true } },
});
check('reserve blocked on a partial checklist', partialChecklist.status === 400, partialChecklist.json);

const full = { IDENTITY: true, GROUPING: true, ANTIBODY: true, CROSSMATCH: true, INSPECTION: true, AUTHORISED: true };
const clinReserve = await call('POST', '/requests/' + rid + '/reserve', { token: tokens.clinician, body: { crossmatch: full } });
check('clinician cannot reserve units', clinReserve.status === 403, clinReserve.json);

const reserved = await call('POST', '/requests/' + rid + '/reserve', { token: tokens.bloodbank, body: { crossmatch: full } });
check('units reserved', reserved.status === 200 && reserved.json.units.length === 2, reserved.json);
check('reserved units are compatible with A+',
  reserved.json.units.every((u) => ['A+', 'A-', 'O+', 'O-'].includes(u.blood_group)), reserved.json.units?.map((u) => u.blood_group));

const reserveTwice = await call('POST', '/requests/' + rid + '/reserve', { token: tokens.bloodbank, body: { crossmatch: full } });
check('a reserved request cannot be reserved again', reserveTwice.status === 409, reserveTwice.json);

const issued = await call('POST', '/requests/' + rid + '/issue', { token: tokens.bloodbank });
check('units issued', issued.status === 200 && issued.json.request.status === 'issued', issued.json);

const trace = await call('GET', '/requests/trace/' + reserved.json.units[0].unit_code, { token: tokens.bloodbank });
check('unit traces back to its donor', trace.status === 200 && !!trace.json.chain.donor, trace.json?.chain);
check('unit traces forward to the patient', trace.json.chain.patient?.mrn === newPatient.json.patient.mrn, trace.json?.chain?.patient);

// --- incompatible reservation is refused ------------------------------
console.log('\ncompatibility guard');
const bPatient = await call('POST', '/patients', {
  token: tokens.clinician, body: { full_name: 'Incompat Test', age: 30, sex: 'M', blood_group: 'O-' },
});
const bReq = await call('POST', '/requests', {
  token: tokens.clinician,
  body: { patient_id: bPatient.json.patient.id, component: 'PRBC', blood_group: 'O-', units_requested: 1, urgency: 'routine' },
});
const aPlusUnit = (await call('GET', '/inventory/units?status=available&component=PRBC&group=A%2B', { token: tokens.bloodbank })).json.units[0];
if (aPlusUnit) {
  const wrong = await call('POST', '/requests/' + bReq.json.request.id + '/reserve', {
    token: tokens.bloodbank, body: { crossmatch: full, unitIds: [aPlusUnit.id] },
  });
  check('A+ unit refused for an O- recipient', wrong.status === 409 && /not compatible/i.test(wrong.json.error || ''), wrong.json);
} else {
  check('A+ unit refused for an O- recipient (skipped - no A+ stock)', true);
}

// --- donor chain ------------------------------------------------------
console.log('\ndonor chain');
const donor = await call('POST', '/donors', {
  token: tokens.bloodbank,
  body: { full_name: 'Smoke Donor', age: 28, sex: 'M', blood_group: 'B+', weight_kg: 70 },
});
check('donor created', donor.status === 201, donor.json);
const did = donor.json.donor.id;

const lowHb = await call('POST', '/donors/' + did + '/screen', { token: tokens.bloodbank, body: { hb_g_dl: 11.0 } });
check('low-Hb donor fails screening', lowHb.json.eligibility.eligible === false, lowHb.json.eligibility);
const okHb = await call('POST', '/donors/' + did + '/screen', { token: tokens.bloodbank, body: { hb_g_dl: 14.2 } });
check('healthy donor passes screening', okHb.json.eligibility.eligible === true, okHb.json.eligibility);

const blockedDonation = await call('POST', '/donors/' + did + '/donate', {
  token: tokens.bloodbank, body: { donated_on: new Date().toISOString().slice(0, 10), hb_g_dl: 10.5 },
});
check('donation blocked when ineligible', blockedDonation.status === 409, blockedDonation.json);

const donation = await call('POST', '/donors/' + did + '/donate', {
  token: tokens.bloodbank,
  body: { donated_on: new Date().toISOString().slice(0, 10), hb_g_dl: 14.2, components: 'PRBC,FFP' },
});
check('donation recorded', donation.status === 201 && donation.json.units.length === 2, donation.json);
check('new units start quarantined', donation.json.units.every((u) => u.status === 'quarantined'), donation.json.units);
check('PRBC expiry is 42 days out', (() => {
  const u = donation.json.units.find((x) => x.component === 'PRBC');
  return Math.round((new Date(u.expires_on) - new Date(u.collected_on)) / 86400000) === 42;
})(), donation.json.units);

const screened = await call('POST', '/donors/donations/' + donation.json.donation.id + '/screening', {
  token: tokens.bloodbank, body: { outcome: 'passed' },
});
check('passing screening releases units to the shelf',
  screened.json.units.every((u) => u.status === 'available'), screened.json.units);

// --- inventory + forecast --------------------------------------------
console.log('\ninventory and forecast');
const summary = await call('GET', '/inventory/summary', { token: tokens.bloodbank });
check('stock summary returns groups', summary.status === 200 && summary.json.byGroup.length > 0, summary.json);
check('no expired unit is listed as available',
  summary.json.expiring.critical.every((u) => u.daysToExpiry >= 0), summary.json.expiring.critical);

const forecast = await call('GET', '/inventory/forecast?component=PRBC', { token: tokens.bloodbank });
check('forecast produced', forecast.status === 200 && forecast.json.fit.ok, forecast.json.fit);
check('forecast reports its error band', typeof forecast.json.fit.mae === 'number', forecast.json.fit);
check('stock projection returned', forecast.json.projection.timeline.length > 0, forecast.json.projection);

const priority = await call('GET', '/camps/collection-priority', { token: tokens.bloodbank });
check('collection priority ranks all eight groups', priority.json.priority.length === 8, priority.json);

const discard = await call('POST', '/inventory/units/' + aPlusUnit.id + '/discard', {
  token: tokens.bloodbank, body: { reason: 'Smoke test - seal damaged' },
});
check('unit discarded with a reason', discard.status === 200 && discard.json.unit.status === 'discarded', discard.json);
check('discard requires a reason',
  (await call('POST', '/inventory/units/' + aPlusUnit.id + '/discard', { token: tokens.bloodbank, body: {} })).status === 400);

// --- audit ------------------------------------------------------------
console.log('\naudit ledger');
const audit = await call('GET', '/audit?limit=20', { token: tokens.admin });
check('audit entries recorded', audit.status === 200 && audit.json.entries.length > 0, audit.json?.total);
check('entries are hash chained', audit.json.entries.every((e) => e.hash && e.prevHash));
const verify = await call('GET', '/audit/verify', { token: tokens.admin });
check('chain verifies intact', verify.status === 200 && verify.json.ok === true, verify.json);

// --- dashboard --------------------------------------------------------
console.log('\ndashboard');
const dash = await call('GET', '/dashboard', { token: tokens.clinician });
check('dashboard responds', dash.status === 200 && typeof dash.json.counts.availableUnits === 'number', dash.json?.counts);
check('issue trend has 30 points', dash.json.issueTrend.length === 30, dash.json.issueTrend?.length);

console.log('\n==============================');
console.log('  passed: ' + pass + '   failed: ' + fail);
console.log('==============================\n');
process.exit(fail ? 1 : 0);
