import { all, get, run, nowIso } from './db.js';
import { audit } from './audit.js';
import { assessReadiness } from './lib/readiness.js';
import { dailySeries, holtForecast } from './lib/forecast.js';
import { addDays, today } from './lib/expiry.js';
import { evaluate } from './lib/rules.js';

/** Units currently on the shelf. */
export const availableUnits = () =>
  all("SELECT * FROM units WHERE status = 'available' ORDER BY expires_on ASC");

/**
 * Move past-dated units out of 'available'. Called before any view that
 * reports availability, so the shelf never shows a unit that cannot be used.
 */
export function sweepExpired(actor) {
  const stale = all("SELECT id, unit_code FROM units WHERE status IN ('available','reserved') AND expires_on < ?", today());
  if (!stale.length) return 0;
  for (const u of stale) {
    run("UPDATE units SET status = 'expired' WHERE id = ?", u.id);
  }
  audit(actor, 'units.expired', 'unit', null, { count: stale.length, unitCodes: stale.map((u) => u.unit_code) });
  return stale.length;
}

/** Issue events, used to estimate demand. */
export function issueEvents(component = null, days = 30) {
  const since = addDays(today(), -days);
  const rows = component
    ? all("SELECT issued_on AS date, component FROM units WHERE status = 'issued' AND issued_on >= ? AND component = ?", since, component)
    : all("SELECT issued_on AS date, component FROM units WHERE status = 'issued' AND issued_on >= ?", since);
  return rows.map((r) => ({ date: String(r.date).slice(0, 10), component: r.component, count: 1 }));
}

/** Smoothed daily issue rate per component, for the readiness coverage figure. */
export function dailyIssueRate(days = 30) {
  const rates = {};
  for (const component of ['PRBC', 'WB', 'PLT', 'FFP', 'CRYO']) {
    const events = issueEvents(component, days);
    if (!events.length) { rates[component] = 0; continue; }
    const fit = holtForecast(dailySeries(events, days), 1);
    rates[component] = fit.ok ? fit.dailyRate : Number((events.length / days).toFixed(2));
  }
  return rates;
}

/** Readiness for a request, against live stock. */
export function readinessFor({ bloodGroup, component, unitsRequested }) {
  return assessReadiness(
    { bloodGroup, component, unitsRequested },
    availableUnits(),
    { dailyIssueRate: dailyIssueRate() },
  );
}

export function activeRuleSet() {
  const row = get('SELECT * FROM rule_sets WHERE is_active = 1 ORDER BY id DESC LIMIT 1');
  if (!row) throw new Error('No active rule set. Run `npm run seed` in the server folder.');
  return row;
}

export function parseRuleSet(row) {
  return { id: row.id, version: row.version, title: row.title, ...JSON.parse(row.rules_json) };
}

/** Evaluate inputs against a stored rule set row. */
export function runRules(ruleSetRow, inputs) {
  return evaluate(parseRuleSet(ruleSetRow), inputs);
}

/** Next sequential code for a table, e.g. REQ-0007. */
export function nextCode(table, column, prefix, width = 4) {
  const row = get('SELECT COUNT(*) AS n FROM ' + table);
  let n = (row?.n || 0) + 1;
  for (;;) {
    const code = prefix + String(n).padStart(width, '0');
    if (!get('SELECT 1 FROM ' + table + ' WHERE ' + column + ' = ?', code)) return code;
    n++;
  }
}

export const timestamps = () => ({ created_at: nowIso(), updated_at: nowIso() });
