/** Verify every endpoint the web UI calls responds for the role that calls it. */
const BASE = 'http://localhost:4000/api';
let pass = 0, fail = 0;

const login = async (u, p) => {
  const r = await fetch(BASE + '/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: u, password: p }),
  });
  return (await r.json()).token;
};

const T = {
  clinician: await login('dr.anand', 'clinician123'),
  bloodbank: await login('bb.kumar', 'bloodbank123'),
  admin: await login('admin', 'admin123'),
};

async function hit(role, path) {
  const res = await fetch(BASE + path, { headers: { authorization: 'Bearer ' + T[role] } });
  let body = null;
  try { body = await res.json(); } catch { /* none */ }
  if (res.ok) { pass++; console.log('  200  ' + role.padEnd(10) + path); }
  else { fail++; console.log('  ' + res.status + '  ' + role.padEnd(10) + path + '  -> ' + (body?.error || '')); }
  return body;
}

console.log('\n=== UI endpoint reachability ===\n');

// Discover live ids so the detail routes are exercised for real.
const patients = await hit('clinician', '/patients');
const assessments = await hit('clinician', '/assessments');
const requests = await hit('clinician', '/requests');
const donorList = await hit('bloodbank', '/donors');
const camps = await hit('bloodbank', '/camps');
const rulesets = await hit('admin', '/rulesets');

const pid = patients.patients[0].id;
const aid = assessments.assessments[0].id;
const rid = requests.requests[0].id;
const did = donorList.donors[0].id;
const cid = camps.camps[0].id;
const rsA = rulesets.ruleSets[0].id;
const rsB = rulesets.ruleSets[1].id;

await hit('clinician', '/dashboard');
await hit('clinician', '/assessments/meta/contexts');
await hit('clinician', '/assessments/' + aid);
await hit('clinician', '/assessments/' + aid + '/replay/' + rsB);
await hit('clinician', '/patients/' + pid);
await hit('clinician', '/patients?q=SYN');
await hit('bloodbank', '/inventory/meta');
await hit('bloodbank', '/inventory/summary');
await hit('bloodbank', '/inventory/units?status=available');
await hit('bloodbank', '/inventory/units?status=available&component=PRBC&group=O%2B');
await hit('bloodbank', '/inventory/forecast?component=PRBC&horizon=14');
await hit('bloodbank', '/inventory/forecast?component=PLT&horizon=14');
await hit('bloodbank', '/inventory/readiness?group=A%2B&component=PRBC&units=2');
await hit('bloodbank', '/donors?q=');
await hit('bloodbank', '/donors/criteria');
await hit('bloodbank', '/donors/' + did);
await hit('bloodbank', '/donors/donations/pending');
await hit('bloodbank', '/camps/collection-priority');
await hit('bloodbank', '/camps/' + cid);
await hit('bloodbank', '/requests/checklist');
await hit('bloodbank', '/requests/' + rid);
await hit('bloodbank', '/requests?status=pending');
await hit('bloodbank', '/requests?status=issued');
await hit('admin', '/rulesets/' + rsA);
await hit('admin', '/rulesets/' + rsA + '/compare/' + rsB);
await hit('admin', '/audit?limit=200');
await hit('admin', '/audit?limit=200&entity=unit');
await hit('admin', '/audit/verify');

// Trace needs a unit that exists.
const units = await hit('bloodbank', '/inventory/units?status=issued');
if (units?.units?.length) await hit('bloodbank', '/requests/trace/' + units.units[0].unit_code);

// The static bundle must actually be served.
for (const path of ['/', '/assets']) {
  const res = await fetch('http://localhost:4000' + (path === '/' ? '/' : '/nope-spa-route'));
  const html = await res.text();
  const ok = res.ok && html.includes('<div id="root">');
  if (ok) { pass++; console.log('  200  static     ' + path + ' serves the SPA shell'); }
  else { fail++; console.log('  FAIL static     ' + path); }
}

console.log('\n  passed: ' + pass + '   failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
