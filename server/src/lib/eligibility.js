import { daysBetween, today } from './expiry.js';

/**
 * Donor eligibility screen.
 *
 * Thresholds follow commonly published whole-blood donation criteria and are
 * stated openly so a reviewer can see and change them. They are demonstration
 * criteria for this prototype, not a substitute for the donor-screening
 * procedure and medical officer assessment of a licensed blood centre.
 */
export const ELIGIBILITY_CRITERIA = [
  { id: 'AGE', text: 'Age between 18 and 65 years' },
  { id: 'WEIGHT', text: 'Body weight at least 45 kg' },
  { id: 'HB', text: 'Haemoglobin at least 12.5 g/dL' },
  { id: 'INTERVAL', text: 'At least 90 days since the previous whole-blood donation' },
  { id: 'DEFERRAL', text: 'No active deferral on record' },
];

export function checkEligibility(donor, options = {}) {
  const hb = options.hb_g_dl == null ? null : Number(options.hb_g_dl);
  const onDate = options.onDate || today();
  const checks = [];
  const add = (id, pass, reason, observed) => checks.push({ id, pass, reason, observed });

  if (donor.age == null) add('AGE', false, 'Age not recorded', null);
  else if (donor.age < 18 || donor.age > 65) add('AGE', false, 'Age ' + donor.age + ' is outside 18-65 years', donor.age);
  else add('AGE', true, 'Age ' + donor.age + ' is within 18-65 years', donor.age);

  if (donor.weight_kg == null) add('WEIGHT', false, 'Weight not recorded', null);
  else if (donor.weight_kg < 45) add('WEIGHT', false, 'Weight ' + donor.weight_kg + ' kg is below the 45 kg minimum', donor.weight_kg);
  else add('WEIGHT', true, 'Weight ' + donor.weight_kg + ' kg meets the 45 kg minimum', donor.weight_kg);

  if (hb == null || Number.isNaN(hb)) add('HB', false, 'Pre-donation haemoglobin not measured', null);
  else if (hb < 12.5) add('HB', false, 'Haemoglobin ' + hb + ' g/dL is below 12.5 g/dL', hb);
  else add('HB', true, 'Haemoglobin ' + hb + ' g/dL meets the 12.5 g/dL minimum', hb);

  if (!donor.last_donated_on) {
    add('INTERVAL', true, 'No previous donation on record', null);
  } else {
    const gap = daysBetween(donor.last_donated_on, onDate);
    if (gap < 90) add('INTERVAL', false, 'Only ' + gap + ' days since the last donation on ' + donor.last_donated_on, gap);
    else add('INTERVAL', true, gap + ' days since the last donation', gap);
  }

  if (donor.deferred_until && donor.deferred_until > onDate) {
    const why = donor.deferral_reason ? ' (' + donor.deferral_reason + ')' : '';
    add('DEFERRAL', false, 'Deferred until ' + donor.deferred_until + why, donor.deferred_until);
  } else {
    add('DEFERRAL', true, 'No active deferral on record', null);
  }

  const blockers = checks.filter((c) => !c.pass);
  return {
    eligible: blockers.length === 0,
    checks,
    blockers: blockers.map((b) => b.reason),
    evaluatedOn: onDate,
    note: 'Demonstration screening criteria. Final donor acceptance rests with the blood centre medical officer.',
  };
}
