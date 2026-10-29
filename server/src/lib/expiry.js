import { COMPONENTS } from './compatibility.js';

export const DAY_MS = 86400000;

export const today = () => new Date().toISOString().slice(0, 10);

export function addDays(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso, toIso) {
  const a = new Date(fromIso + 'T00:00:00Z').getTime();
  const b = new Date(toIso + 'T00:00:00Z').getTime();
  return Math.round((b - a) / DAY_MS);
}

/** Shelf life is component-specific; platelets are the binding constraint at 5 days. */
export function expiryFor(component, collectedOn) {
  const spec = COMPONENTS[component];
  if (!spec) throw new Error('Unknown component: ' + component);
  return addDays(collectedOn, spec.shelfLifeDays);
}

export function daysToExpiry(expiresOn, from = today()) {
  return daysBetween(from, expiresOn);
}

/** Buckets drive the inventory colour coding and the wastage-risk panel. */
export function expiryBucket(expiresOn, from = today()) {
  const d = daysToExpiry(expiresOn, from);
  if (d < 0) return 'expired';
  if (d <= 3) return 'critical';
  if (d <= 7) return 'soon';
  return 'ok';
}
