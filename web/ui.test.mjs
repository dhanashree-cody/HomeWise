/**
 * Mount the built HemoWise bundle in a real DOM against the live API and walk
 * every route, failing on any console error or unhandled rejection.
 *
 * Run with the API server up:  node ui.test.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const API = 'http://localhost:4000';
const dist = join(import.meta.dirname, 'dist');
const assets = join(dist, 'assets');

const bundle = readdirSync(assets).find((f) => f.endsWith('.js'));
if (!bundle) { console.error('No build found. Run: npm run build'); process.exit(1); }

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + (e.detail?.message || e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));
vc.on('warn', (...a) => {
  const m = a.map(String).join(' ');
  // React key/prop warnings are real defects; ignore jsdom CSS parse noise.
  if (!/Could not parse CSS|Error: Not implemented/.test(m)) errors.push('console.warn: ' + m);
});

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:4000/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole: vc,
});

const { window } = dom;

// Shims jsdom does not provide that the app relies on.
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
window.scrollTo = () => {};

// Route the app's relative fetches at the live API.
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  return fetch(url.startsWith('http') ? url : API + url, init);
};

globalThis.window = window;
globalThis.document = window.document;
// Node 24 defines navigator as a getter-only global, so redefine rather than assign.
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });

const code = readFileSync(join(assets, bundle), 'utf8');
window.eval(code);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = () => window.document.body.textContent || '';
const html = () => window.document.body.innerHTML;

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra ? '\n          ' + String(extra).slice(0, 400) : '')); }
}

console.log('\n=== HemoWise UI render walk ===\n');

await sleep(700);
check('login screen renders', /Sign in/.test(text()) && /HemoWise/.test(text()), text().slice(0, 200));
check('safety wording on login', /synthetic/i.test(text()));

// Sign in through the real form.
const [userInput, passInput] = window.document.querySelectorAll('input');
const setValue = (el, v) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, v);
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
};
setValue(userInput, 'admin');
setValue(passInput, 'admin123');
window.document.querySelector('button[type=submit]').click();
await sleep(1200);

check('signed in and left the login screen', !/Demonstration accounts/.test(text()), text().slice(0, 200));
check('dashboard loaded', /Units available/.test(text()), text().slice(0, 300));
check('safety bar present after sign-in', /Academic prototype/.test(text()));
check('stock chart rendered', html().includes('<svg'), 'no svg found');

const routes = [
  ['#/', 'Dashboard', /Units available/],
  ['#/assess', 'New assessment', /Select a patient/],
  ['#/assessments', 'Assessments list', /assessment\(s\)/],
  ['#/patients', 'Patients', /Patient register/],
  ['#/requests', 'Requests', /Blood requests/],
  ['#/inventory', 'Inventory', /Available|Quarantined/],
  ['#/donors', 'Donors', /Donor register/],
  ['#/camps', 'Camps', /Collection priority/],
  ['#/trace', 'Trace', /Trace a unit/],
  ['#/rules', 'Rule sets', /Rule set versions/],
  ['#/audit', 'Audit ledger', /Chain integrity/],
  ['#/safety', 'Safety notice', /What this system does/],
];

for (const [hash, name, expect] of routes) {
  window.location.hash = hash;
  await sleep(850);
  check(name + ' renders', expect.test(text()), text().slice(0, 260));
}

// Detail routes, using ids discovered from the API.
const token = window.localStorage.getItem('hemowise.token');
const auth = { headers: { authorization: 'Bearer ' + token } };
const j = async (p) => (await fetch(API + '/api' + p, auth)).json();

const aId = (await j('/assessments')).assessments[0].id;
const pId = (await j('/patients')).patients[0].id;
const rId = (await j('/requests')).requests[0].id;
const dId = (await j('/donors')).donors[0].id;

const details = [
  ['#/assessments/' + aId, 'Assessment detail', /Review flags/],
  ['#/patients/' + pId, 'Patient detail', /Assessments \(/],
  ['#/requests/' + rId, 'Request detail', /Units on this request/],
  ['#/donors/' + dId, 'Donor detail', /Donation history/],
];

for (const [hash, name, expect] of details) {
  window.location.hash = hash;
  await sleep(900);
  check(name + ' renders', expect.test(text()), text().slice(0, 260));
}

// The coupled view is the headline feature - confirm both halves are present.
window.location.hash = '#/assessments/' + aId;
await sleep(900);
const detailText = text();
check('assessment detail shows the readiness panel', /Fulfilment readiness/.test(detailText));
check('readiness shows compatible donor groups', /Acceptable donor groups/.test(detailText));
check('readiness states the safety boundary', /Availability is logistics, not an indication/.test(detailText));
check('flags carry a rule id and version', /Rule R-|rule set 1\.0\.0/.test(detailText));
check('replay control is offered', /Replay against another rule version/.test(detailText));

// ---- the coupled live preview, driven through the form itself ------------
console.log('');
window.location.hash = '#/assess';
await sleep(900);

const selects = [...window.document.querySelectorAll('select')];
const patientSelect = selects[0];
const setSelect = (el, v) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(el, v);
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
};

// Pick a patient whose group actually has red cells on the shelf, so the
// allocation half of the panel has something to show.
const summary = await j('/inventory/summary');
const stocked = summary.byGroup
  .filter((g) => (g.components.PRBC || 0) >= 2)
  .sort((a, b) => (b.components.PRBC || 0) - (a.components.PRBC || 0))
  .map((g) => g.group);

const grouped = [...patientSelect.options].find((o) => o.value && stocked.some((g) => o.textContent.includes('(' + g + ')')))
  || [...patientSelect.options].find((o) => o.value && !/not recorded/.test(o.textContent));
setSelect(patientSelect, grouped.value);
await sleep(900);
check('selecting a patient produces a live preview', /Review flags|Fulfilment readiness/.test(text()), text().slice(0, 240));

// Enter a critically low haemoglobin and confirm the flag appears.
const numberInputs = [...window.document.querySelectorAll('input[type=number]')];
setValue(numberInputs[0], '6.1');   // haemoglobin
setValue(numberInputs[1], '124');   // heart rate
setValue(numberInputs[2], '86');    // systolic BP
await sleep(1100);

const assessText = text();
check('low haemoglobin raises a flag', /Haemoglobin below 7\.0/.test(assessText), assessText.slice(0, 300));
check('shock index is computed from the two observations', /Shock index/.test(assessText));
check('review status escalates to priority', /Priority clinician review/.test(assessText));
check('readiness updates alongside the flags', /Fulfilment readiness/.test(assessText));
check('allocation names specific unit codes', /U-\d{6}/.test(assessText), assessText.slice(0, 300));
check('status never phrased as a transfusion instruction',
  !/\bdo not transfuse\b/i.test(assessText) && !/\brecommend(ed)? transfusion\b/i.test(assessText));

// Clearing haemoglobin must downgrade to "unanswered", not to "normal".
setValue(numberInputs[0], '');
await sleep(1100);
const blankText = text();
check('a blank haemoglobin is reported as unevaluated, not normal',
  /could not be evaluated|Some rules could not be evaluated/i.test(blankText), blankText.slice(0, 300));
check('no haemoglobin flag fires on missing data', !/Haemoglobin below/.test(blankText));

console.log('');
check('no console errors or React warnings during the walk', errors.length === 0, errors.slice(0, 5).join('\n          '));

console.log('\n  passed: ' + pass + '   failed: ' + fail + '\n');
if (errors.length) { console.log('Collected messages:'); errors.slice(0, 12).forEach((e) => console.log('  - ' + e.slice(0, 300))); }
process.exit(fail ? 1 : 0);
