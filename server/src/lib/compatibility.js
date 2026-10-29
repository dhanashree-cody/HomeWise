/**
 * ABO/Rh compatibility tables.
 *
 * These express which DONOR groups may be considered for a RECIPIENT, in
 * preference order (index 0 = identical group, preferred). They describe
 * serological group compatibility only. They are NOT a crossmatch: antibody
 * screening, crossmatch and authorised release remain separate, mandatory
 * blood-bank steps before any unit can be issued.
 */

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

export const COMPONENTS = {
  PRBC: { label: 'Packed Red Cells', shelfLifeDays: 42, storage: '2-6 C' },
  WB: { label: 'Whole Blood', shelfLifeDays: 35, storage: '2-6 C' },
  PLT: { label: 'Platelet Concentrate', shelfLifeDays: 5, storage: '20-24 C, agitated' },
  FFP: { label: 'Fresh Frozen Plasma', shelfLifeDays: 365, storage: '-30 C or colder' },
  CRYO: { label: 'Cryoprecipitate', shelfLifeDays: 365, storage: '-30 C or colder' },
};

/** Red-cell compatibility: a recipient may receive cells lacking antigens they lack. */
const RBC = {
  'O-': ['O-'],
  'O+': ['O+', 'O-'],
  'A-': ['A-', 'O-'],
  'A+': ['A+', 'A-', 'O+', 'O-'],
  'B-': ['B-', 'O-'],
  'B+': ['B+', 'B-', 'O+', 'O-'],
  'AB-': ['AB-', 'A-', 'B-', 'O-'],
  'AB+': ['AB+', 'AB-', 'A+', 'A-', 'B+', 'B-', 'O+', 'O-'],
};

/** Plasma compatibility runs the opposite way to red cells (AB plasma is universal). */
const PLASMA = {
  'O-': ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'],
  'O+': ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'],
  'A-': ['A-', 'A+', 'AB-', 'AB+'],
  'A+': ['A+', 'A-', 'AB+', 'AB-'],
  'B-': ['B-', 'B+', 'AB-', 'AB+'],
  'B+': ['B+', 'B-', 'AB+', 'AB-'],
  'AB-': ['AB-', 'AB+'],
  'AB+': ['AB+', 'AB-'],
};

/** Negative groups are the scarce ones worth conserving when an equivalent exists. */
const SCARCE = new Set(['O-', 'AB-', 'B-', 'A-']);

/**
 * Donor groups acceptable for this recipient and component, in preference
 * order, each annotated with why it sits where it does.
 */
export function compatibleDonorGroups(recipientGroup, component = 'PRBC') {
  const table = component === 'FFP' || component === 'CRYO' ? PLASMA : RBC;
  const list = table[recipientGroup];
  if (!list) return [];
  return list.map((group, i) => ({
    group,
    rank: i + 1,
    identical: group === recipientGroup,
    conserve: SCARCE.has(group) && group !== recipientGroup,
    note:
      group === recipientGroup
        ? 'Identical group - first preference'
        : SCARCE.has(group)
          ? 'Compatible, but a scarce group - use only when no closer match is available'
          : 'Compatible alternative group',
  }));
}

export function isCompatible(recipientGroup, donorGroup, component = 'PRBC') {
  return compatibleDonorGroups(recipientGroup, component).some((c) => c.group === donorGroup);
}

/** Platelets carry an ABO preference and an RhD caution rather than a hard rule. */
export function plateletAdvisory(recipientGroup) {
  const notes = [
    'Platelets: ABO-identical units are preferred; ABO-non-identical units may be acceptable under local policy.',
  ];
  if (recipientGroup.endsWith('-')) {
    notes.push(
      'Recipient is RhD negative: RhD-negative platelets are preferred, and anti-D prophylaxis may be considered if RhD-positive platelets are used. Confirm with the transfusion service.',
    );
  }
  return notes;
}
