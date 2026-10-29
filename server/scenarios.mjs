/**
 * Runs the synthetic scenarios from Appendix 1 of the project report and
 * prints what the system actually does, so the report can quote observed
 * output rather than intended output.
 */
const BASE = 'http://localhost:4000/api';

const login = async (u, p) => {
  const r = await fetch(BASE + '/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: u, password: p }),
  });
  return (await r.json()).token;
};
const token = await login('dr.anand', 'clinician123');
const H = { 'content-type': 'application/json', authorization: 'Bearer ' + token };

const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: H, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const get = async (p) => (await fetch(BASE + p, { headers: H })).json();

// One patient in a well-stocked group, and one in the most constrained group.
// O-negative recipients can only receive O-negative, so they are the tightest
// case in any blood bank and the right scenario for a shortfall.
const summary = await get('/inventory/summary');
const stockOf = (g) => summary.byGroup.find((x) => x.group === g)?.components.PRBC || 0;
const stocked = summary.byGroup.filter((g) => (g.components.PRBC || 0) >= 4).map((g) => g.group);
const patients = (await get('/patients')).patients;
const normal = patients.find((p) => stocked.includes(p.blood_group));

// Prefer a real O- patient; otherwise raise the ask above whatever is on hand.
const rare = patients.find((p) => p.blood_group === 'O-') || normal;
const shortAsk = stockOf(rare.blood_group) + 4;

const base = { patient_id: normal.id, clinical_context: 'medical', component: 'PRBC', units_requested: 1 };

const SCENARIOS = [
  ['A', 'All fields complete, no rule triggered',
    { ...base, hb_g_dl: 11.4, heart_rate: 78, systolic_bp: 124, blood_group: normal.blood_group }],
  ['B', 'Haemoglobin below the configured threshold',
    { ...base, hb_g_dl: 6.5, heart_rate: 84, systolic_bp: 118, blood_group: normal.blood_group }],
  ['C', 'Active bleeding selected',
    { ...base, hb_g_dl: 9.2, heart_rate: 96, systolic_bp: 108, blood_group: normal.blood_group, active_bleeding: true }],
  ['D', 'Previous transfusion reaction reported',
    { ...base, hb_g_dl: 9.0, heart_rate: 80, systolic_bp: 120, blood_group: normal.blood_group, prior_reaction: true }],
  ['E', 'Required fields missing',
    { ...base, heart_rate: 88, blood_group: normal.blood_group }],
  ['F', 'Selected blood-group stock is short of the request',
    { ...base, hb_g_dl: 6.8, heart_rate: 110, systolic_bp: 92, blood_group: rare.blood_group, units_requested: shortAsk, patient_id: rare.id }],
  // AB-negative accepts AB-, A-, B- and O-, so asking for more than the
  // identical-group stock forces the plan onto substitute groups.
  ['G', 'Request exceeds identical-group stock, so substitutes are used',
    { ...base, hb_g_dl: 7.2, heart_rate: 94, systolic_bp: 110, blood_group: 'AB-', units_requested: stockOf('AB-') + 3 }],
];

console.log('\n=== Appendix 1 scenarios, observed output ===\n');

for (const [id, name, body] of SCENARIOS) {
  const { json: r } = await post('/assessments/preview', body);
  const flags = r.flags.map((f) => f.id);
  console.log('Scenario ' + id + ' - ' + name);
  console.log('  inputs        Hb=' + (body.hb_g_dl ?? 'blank') + '  HR=' + (body.heart_rate ?? 'blank') +
    '  SBP=' + (body.systolic_bp ?? 'blank') + '  group=' + body.blood_group +
    '  bleeding=' + !!body.active_bleeding + '  reaction=' + !!body.prior_reaction +
    '  units=' + body.units_requested);
  console.log('  flags         ' + (flags.length ? flags.join(', ') : '(none)'));
  console.log('  review status ' + r.reviewStatus);
  console.log('  not evaluated ' + (r.notEvaluated.length ? r.notEvaluated.map((n) => n.id).join(', ') : '(none)'));
  console.log('  fulfilment    ' + r.readiness.fulfilment + '  (' + r.readiness.unitsAllocated + '/' +
    r.readiness.unitsRequested + ' covered, ' + r.readiness.compatibleStock + ' compatible in stock)');
  console.log('  allocation    ' + (r.readiness.allocation.length
    ? r.readiness.allocation.map((u) => u.unitCode + ' ' + u.group + ' ' + u.daysToExpiry + 'd').join(' | ')
    : '(none)'));
  console.log('  advisories    ' + r.readiness.advisories.map((a) => a.code).join(', '));
  console.log('');
}

// Rule governance: the same case under both rule versions.
const sets = (await get('/rulesets')).ruleSets;
const active = sets.find((s) => s.is_active);
const draft = sets.find((s) => !s.is_active);
const cmp = await get('/rulesets/' + active.id + '/compare/' + draft.id);
console.log('=== Rule governance ===\n');
console.log('Comparing ' + cmp.from.version + ' -> ' + cmp.to.version);
console.log('  rules removed   ' + (cmp.ruleDiff.removed.map((r) => r.id).join(', ') || '(none)'));
console.log('  rules added     ' + (cmp.ruleDiff.added.map((r) => r.id).join(', ') || '(none)'));
console.log('  thresholds      ' + (cmp.ruleDiff.modified.map((r) => r.id + ': ' + r.from + ' -> ' + r.to).join('; ') || '(none)'));
console.log('  stored cases    ' + cmp.impact.assessmentsChanged + ' of ' + cmp.impact.assessmentsChecked + ' would flag differently');

// Chain verification is restricted, so check it with an authorised account.
const adminToken = await login('admin', 'admin123');
const audit = await (await fetch(BASE + '/audit/verify', { headers: { authorization: 'Bearer ' + adminToken } })).json();
console.log('\n=== Audit chain ===\n');
console.log('  ' + (audit?.ok ? 'intact, ' + audit.checked + ' entries recomputed and matched' : 'BROKEN at ' + audit?.brokenAt + ': ' + audit?.reason));
console.log('');
