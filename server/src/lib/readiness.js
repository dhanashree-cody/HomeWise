import { compatibleDonorGroups, plateletAdvisory, COMPONENTS } from './compatibility.js';
import { daysToExpiry, expiryBucket, today } from './expiry.js';

/**
 * FULFILMENT READINESS ENGINE  --  the coupling this project contributes.
 *
 * The systems surveyed in the literature sit on one side of a line. Blood-bank
 * management systems track units, donors and stock levels but know nothing
 * about the patient being reviewed. Transfusion-prediction studies model a
 * patient but know nothing about what is physically on the shelf. A clinician
 * reviewing a case therefore reads a clinical screen, then separately asks the
 * blood bank whether anything is actually available.
 *
 * This module closes that gap. Given the recipient's group, the component and
 * the number of units under discussion, it answers one operational question --
 * "if this were to go ahead, could it be served, with which units, and at what
 * cost to the rest of the shelf?" -- and it answers it in a way a reviewer can
 * audit line by line.
 *
 * It computes four things:
 *
 *   1. COMPATIBILITY  which donor groups are acceptable, in preference order.
 *   2. ALLOCATION     a concrete first-expiring-first-out plan naming real
 *                     unit codes, so the answer is units, not a stock count.
 *   3. COVERAGE       how long compatible stock would last at the observed
 *                     issue rate, so a shortage is visible before it bites.
 *   4. WASTAGE        which units are about to expire, and whether a
 *                     near-expiry compatible unit could serve this case
 *                     instead of a fresh one.
 *
 * SAFETY BOUNDARY. Everything here is operational logistics. Availability is
 * not an indication: a full shelf never means a patient needs blood, and an
 * empty shelf never means they do not. The plan is a suggestion for authorised
 * blood-bank staff, who remain responsible for antibody screening, crossmatch,
 * unit inspection and release. Nothing in this module reserves or issues a
 * unit on its own.
 */

const EXPIRING_SOON_DAYS = 7;
const SALVAGE_WINDOW_DAYS = 3;

/**
 * Build the readiness view.
 *
 * @param {object}   req            { bloodGroup, component, unitsRequested }
 * @param {object[]} availableUnits every unit with status 'available'
 * @param {object}   history        { dailyIssueRate: { [component]: number } }
 */
export function assessReadiness(req, availableUnits, history = {}) {
  const asOf = req.asOf || today();
  const component = req.component || 'PRBC';
  const requested = Math.max(1, Number(req.unitsRequested) || 1);
  const group = req.bloodGroup;

  const base = {
    asOf,
    component,
    componentLabel: COMPONENTS[component]?.label || component,
    recipientGroup: group,
    unitsRequested: requested,
    advisories: [],
    disclaimer:
      'Operational availability only. This is not a crossmatch and not a clinical indication. Units must be screened, crossmatched and released by authorised blood-bank staff.',
  };

  if (!group) {
    return {
      ...base,
      compatibleGroups: [],
      allocation: [],
      unitsAllocated: 0,
      shortfall: requested,
      fulfilment: 'unknown',
      compatibleStock: 0,
      exactMatchStock: 0,
      coverageDays: null,
      wastage: { expiringSoon: [], salvageSuggestion: null },
      advisories: [
        { level: 'warning', code: 'NO_GROUP', text: 'No blood group recorded for this patient, so compatible stock cannot be determined. Confirm the group with the laboratory.' },
      ],
    };
  }

  // 1. COMPATIBILITY ------------------------------------------------------
  const compatibleGroups = compatibleDonorGroups(group, component);
  const rankOf = new Map(compatibleGroups.map((c) => [c.group, c.rank]));

  // 2. ALLOCATION ---------------------------------------------------------
  // Candidates are the right component, a compatible group, and not expired.
  const candidates = availableUnits
    .filter((u) => u.component === component && rankOf.has(u.blood_group) && daysToExpiry(u.expires_on, asOf) >= 0)
    .map((u) => ({
      unitId: u.id,
      unitCode: u.unit_code,
      group: u.blood_group,
      rank: rankOf.get(u.blood_group),
      expiresOn: u.expires_on,
      daysToExpiry: daysToExpiry(u.expires_on, asOf),
      storageLoc: u.storage_loc,
      identical: u.blood_group === group,
    }))
    // Preference rank first (identical group before a substitute), then
    // first-expiring-first-out inside each rank so the shelf rotates.
    .sort((a, b) => a.rank - b.rank || a.daysToExpiry - b.daysToExpiry || a.unitId - b.unitId);

  const allocation = candidates.slice(0, requested).map((u, i) => ({
    ...u,
    order: i + 1,
    // Kept short: the table column is narrow and the policy is spelled out in
    // full above it. The rank is what matters per row.
    reason: u.identical ? 'Identical group, FEFO' : 'Substitute rank ' + u.rank + ', FEFO',
  }));

  const unitsAllocated = allocation.length;
  const shortfall = requested - unitsAllocated;
  const exactMatchStock = candidates.filter((u) => u.identical).length;
  const compatibleStock = candidates.length;

  // 3. COVERAGE -----------------------------------------------------------
  const rate = history.dailyIssueRate?.[component];
  const coverageDays = rate && rate > 0 ? Number((compatibleStock / rate).toFixed(1)) : null;

  // 4. WASTAGE ------------------------------------------------------------
  const expiringSoon = candidates
    .filter((u) => u.daysToExpiry <= EXPIRING_SOON_DAYS)
    .sort((a, b) => a.daysToExpiry - b.daysToExpiry);

  // If a compatible unit is within days of being thrown away while the plan
  // reaches for a fresher one, say so. Using it here is the difference between
  // a unit transfused and a unit discarded -- but it is the blood bank's call.
  let salvageSuggestion = null;
  const nearExpiry = candidates.find((u) => u.daysToExpiry <= SALVAGE_WINDOW_DAYS);
  const allocatedIds = new Set(allocation.map((u) => u.unitId));
  if (nearExpiry && !allocatedIds.has(nearExpiry.unitId) && unitsAllocated > 0) {
    const displaced = allocation[allocation.length - 1];
    salvageSuggestion = {
      candidate: nearExpiry,
      insteadOf: displaced,
      text:
        'Unit ' + nearExpiry.unitCode + ' (' + nearExpiry.group + ') is compatible and expires in ' +
        nearExpiry.daysToExpiry + ' day(s). It is not in the plan above because ' + displaced.unitCode +
        ' is a closer group match. If the transfusion service considers the substitution acceptable for this patient, using it would avoid a likely discard.',
    };
  }

  // Advisories ------------------------------------------------------------
  const advisories = [];

  if (shortfall > 0) {
    advisories.push({
      level: unitsAllocated === 0 ? 'critical' : 'warning',
      code: 'SHORTFALL',
      text:
        unitsAllocated === 0
          ? 'No compatible ' + (COMPONENTS[component]?.label || component) + ' units are on the shelf for group ' + group + '. Contact the blood bank about transfer or an emergency supply before relying on this view.'
          : 'Only ' + unitsAllocated + ' of ' + requested + ' units can be covered from current stock. Shortfall of ' + shortfall + ' unit(s).',
    });
  } else {
    advisories.push({
      level: 'ok',
      code: 'COVERED',
      text: 'Current stock holds ' + requested + ' compatible unit(s) for group ' + group + '. Availability is not an indication to transfuse.',
    });
  }

  if (exactMatchStock === 0 && compatibleStock > 0) {
    advisories.push({
      level: 'warning',
      code: 'NO_EXACT_MATCH',
      text: 'No identical-group (' + group + ') units are in stock. The plan falls back to compatible substitute groups, which the blood bank must confirm.',
    });
  }

  const scarceUsed = allocation.filter((u) => !u.identical && u.group.endsWith('-'));
  if (scarceUsed.length) {
    advisories.push({
      level: 'warning',
      code: 'SCARCE_GROUP',
      text: 'The plan draws ' + scarceUsed.length + ' unit(s) from scarce negative-group stock (' +
        [...new Set(scarceUsed.map((u) => u.group))].join(', ') + '). Confirm no closer match can be sourced first.',
    });
  }

  if (coverageDays !== null && coverageDays < 3) {
    advisories.push({
      level: 'warning',
      code: 'LOW_COVERAGE',
      text: 'Compatible stock for this component covers about ' + coverageDays + ' day(s) at the recent issue rate. Consider scheduling collection.',
    });
  }

  if (expiringSoon.length) {
    advisories.push({
      level: 'info',
      code: 'EXPIRING_SOON',
      text: expiringSoon.length + ' compatible unit(s) expire within ' + EXPIRING_SOON_DAYS + ' days. Rotating these first reduces wastage.',
    });
  }

  if (component === 'PLT') {
    for (const note of plateletAdvisory(group)) {
      advisories.push({ level: 'info', code: 'PLATELET_POLICY', text: note });
    }
  }

  return {
    ...base,
    compatibleGroups,
    allocation,
    unitsAllocated,
    shortfall,
    fulfilment: shortfall === 0 ? 'full' : unitsAllocated === 0 ? 'none' : 'partial',
    compatibleStock,
    exactMatchStock,
    coverageDays,
    dailyIssueRate: rate ?? null,
    wastage: { expiringSoon, salvageSuggestion, windowDays: EXPIRING_SOON_DAYS },
    advisories,
  };
}

/** Group a unit list into the per-group / per-bucket shape the UI renders. */
export function stockSummary(units, asOf = today()) {
  const byGroup = {};
  for (const u of units) {
    const g = (byGroup[u.blood_group] ||= { group: u.blood_group, total: 0, components: {}, expiringSoon: 0 });
    g.total++;
    g.components[u.component] = (g.components[u.component] || 0) + 1;
    const bucket = expiryBucket(u.expires_on, asOf);
    if (bucket === 'critical' || bucket === 'soon') g.expiringSoon++;
  }
  return Object.values(byGroup).sort((a, b) => a.group.localeCompare(b.group));
}
