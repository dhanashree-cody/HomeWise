/**
 * Transparent, versioned rule engine.
 *
 * Rules are DATA, not code: each rule set is stored in the database as JSON
 * and evaluated by the small declarative interpreter below. That buys three
 * things the report asks for and that a hard-coded if/else cannot give:
 *
 *   1. Explainability  - every flag carries the exact condition, the observed
 *                        value and the comparison that fired it.
 *   2. Governance      - a rule set has a version, an owner and an approval
 *                        date, and the version used is stored on every
 *                        assessment.
 *   3. Replay          - a past assessment can be re-evaluated against any
 *                        other rule version and the difference shown.
 *
 * The thresholds below are DEMONSTRATION values chosen to be legible. They are
 * not a validated clinical algorithm and must not be read as transfusion
 * advice. A flag means "a qualified clinician should look at this", never
 * "transfuse" or "do not transfuse".
 */

export const SEVERITY_ORDER = { high: 0, moderate: 1, advisory: 2, data: 3, info: 4 };

// ---------------------------------------------------------------- evaluator

const OPS = {
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
  in: (a, b) => Array.isArray(b) && b.includes(a),
  isTrue: (a) => a === true || a === 1,
  isFalse: (a) => a === false || a === 0,
};

const MISSING = Symbol('missing');

function readField(inputs, field) {
  const v = inputs[field];
  if (v === null || v === undefined || v === '') return MISSING;
  return v;
}

/**
 * Evaluate one expression node.
 * Returns { value: true|false|null, evidence: [...] } where null means
 * "could not be evaluated because an input was missing".
 */
function evalNode(node, inputs, evidence) {
  if (node.all) {
    let unknown = false;
    for (const child of node.all) {
      const r = evalNode(child, inputs, evidence);
      if (r === false) return false;
      if (r === null) unknown = true;
    }
    return unknown ? null : true;
  }
  if (node.any) {
    let unknown = false;
    let sawTrue = false;
    for (const child of node.any) {
      const r = evalNode(child, inputs, evidence);
      if (r === true) sawTrue = true;
      if (r === null) unknown = true;
    }
    if (sawTrue) return true;
    return unknown ? null : false;
  }
  if (node.not) {
    const r = evalNode(node.not, inputs, evidence);
    return r === null ? null : !r;
  }

  // Ratio comparison, e.g. shock index = heart rate / systolic blood pressure.
  if (node.ratio) {
    const [fa, fb] = node.ratio;
    const a = readField(inputs, fa);
    const b = readField(inputs, fb);
    if (a === MISSING || b === MISSING || Number(b) === 0) {
      evidence.push({ field: node.ratio.join(' / '), observed: null, op: node.op, expected: node.value, satisfied: null, missing: true });
      return null;
    }
    const ratio = Number(a) / Number(b);
    const satisfied = OPS[node.op](ratio, node.value);
    evidence.push({
      field: node.label || node.ratio.join(' / '),
      observed: Number(ratio.toFixed(2)),
      op: node.op,
      expected: node.value,
      satisfied,
    });
    return satisfied;
  }

  // Simple field comparison.
  const observed = readField(inputs, node.field);
  if (observed === MISSING) {
    evidence.push({ field: node.field, observed: null, op: node.op, expected: node.value, satisfied: null, missing: true });
    return null;
  }
  const satisfied = OPS[node.op](observed, node.value);
  evidence.push({ field: node.field, observed, op: node.op, expected: node.value ?? null, satisfied });
  return satisfied;
}

/**
 * Run a rule set over a set of inputs.
 *
 * A rule whose inputs are incomplete is reported as NOT EVALUATED rather than
 * as "did not trigger". Treating a missing value as a normal value is the
 * hazard the report calls out, so the engine refuses to do it.
 */
export function evaluate(ruleSet, inputs) {
  const flags = [];
  const notEvaluated = [];

  for (const rule of ruleSet.rules) {
    const evidence = [];
    const result = evalNode(rule.when, inputs, evidence);

    if (result === null) {
      notEvaluated.push({
        id: rule.id,
        title: rule.title,
        missingFields: [...new Set(evidence.filter((e) => e.missing).map((e) => e.field))],
      });
      continue;
    }
    if (result === true) {
      flags.push({
        id: rule.id,
        severity: rule.severity,
        title: rule.title,
        condition: rule.condition,
        rationale: rule.rationale,
        source: rule.source || null,
        evidence,
        ruleSetVersion: ruleSet.version,
      });
    }
  }

  flags.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  if (notEvaluated.length) {
    const fields = [...new Set(notEvaluated.flatMap((n) => n.missingFields))];
    flags.push({
      id: 'R-DATA-INCOMPLETE',
      severity: 'data',
      title: 'Some rules could not be evaluated',
      condition: 'One or more inputs used by the rule set were not supplied',
      rationale:
        'These rules were skipped because the data they depend on is missing. A skipped rule is not a negative finding - the question it asks is simply unanswered. Supply the missing values before interpreting this review.',
      source: 'HemoWise data-quality guard',
      evidence: [{ field: fields.join(', '), observed: null, op: 'present', expected: true, satisfied: false, missing: true }],
      skipped: notEvaluated,
      ruleSetVersion: ruleSet.version,
    });
  }

  return { flags, notEvaluated, reviewStatus: reviewStatusFor(flags) };
}

/**
 * Summary label for the assessment. Deliberately phrased as a review prompt.
 * No branch of this function ever says "transfuse" or "do not transfuse".
 */
export function reviewStatusFor(flags) {
  const real = flags.filter((f) => f.severity !== 'info');
  if (real.some((f) => f.severity === 'high')) return 'Priority clinician review';
  if (real.some((f) => f.severity === 'moderate')) return 'Clinician review suggested';
  if (real.some((f) => f.severity === 'data')) return 'Incomplete - review data entry';
  if (real.some((f) => f.severity === 'advisory')) return 'Advisory notes for clinician';
  return 'No demonstration rule triggered';
}

/** Compare two evaluations of the same inputs. Drives the rule-replay view. */
export function diffFlags(beforeFlags, afterFlags) {
  const key = (f) => f.id;
  const b = new Map(beforeFlags.map((f) => [key(f), f]));
  const a = new Map(afterFlags.map((f) => [key(f), f]));
  const added = [...a.values()].filter((f) => !b.has(key(f)));
  const removed = [...b.values()].filter((f) => !a.has(key(f)));
  const changed = [...a.values()]
    .filter((f) => b.has(key(f)) && b.get(key(f)).severity !== f.severity)
    .map((f) => ({ id: f.id, title: f.title, from: b.get(key(f)).severity, to: f.severity }));
  return { added, removed, changed, identical: !added.length && !removed.length && !changed.length };
}

// ---------------------------------------------------------- seeded rule sets

/**
 * v1.0 - restrictive demonstration thresholds, loosely echoing the shape of
 * restrictive-strategy guidance (a single Hb trigger around 7 g/dL for stable
 * adults, around 8 g/dL where cardiac disease or surgery is in the picture).
 * Reproduced here only as a demonstration of transparent rule structure.
 */
export const RULESET_V1 = {
  version: '1.0.0',
  title: 'Demonstration review rules - restrictive thresholds',
  description:
    'Transparent demonstration rules for the academic prototype. Thresholds are illustrative and have not been clinically validated or approved by a transfusion committee.',
  approvedBy: 'Academic prototype - not clinically approved',
  rules: [
    {
      id: 'R-HB-CRITICAL',
      severity: 'high',
      title: 'Haemoglobin below 7.0 g/dL',
      condition: 'hb_g_dl < 7.0',
      rationale:
        'A haemoglobin this low is commonly a trigger for clinical reassessment in hospitalised adults. The value alone does not establish that a transfusion is indicated - symptoms, bleeding, comorbidity and alternatives all matter.',
      source: 'Demonstration threshold',
      when: { field: 'hb_g_dl', op: 'lt', value: 7.0 },
    },
    {
      id: 'R-HB-CARDIAC',
      severity: 'moderate',
      title: 'Haemoglobin below 8.0 g/dL with cardiac or perioperative context',
      condition: 'hb_g_dl < 8.0 AND clinical_context in (cardiac, perioperative)',
      rationale:
        'Where cardiac disease or surgery is part of the picture, a higher review threshold is often discussed. This flag prompts that discussion; it does not set a transfusion trigger.',
      source: 'Demonstration threshold',
      when: {
        all: [
          { field: 'hb_g_dl', op: 'lt', value: 8.0 },
          { field: 'clinical_context', op: 'in', value: ['cardiac', 'perioperative'] },
        ],
      },
    },
    {
      id: 'R-HB-LOW',
      severity: 'moderate',
      title: 'Haemoglobin between 7.0 and 8.0 g/dL',
      condition: '7.0 <= hb_g_dl < 8.0',
      rationale: 'Borderline range. Interpretation depends on symptoms, trend and the clinical setting rather than on the number alone.',
      source: 'Demonstration threshold',
      when: { all: [{ field: 'hb_g_dl', op: 'gte', value: 7.0 }, { field: 'hb_g_dl', op: 'lt', value: 8.0 }] },
    },
    {
      id: 'R-BLEED-ACTIVE',
      severity: 'high',
      title: 'Active bleeding reported',
      condition: 'active_bleeding is true',
      rationale:
        'With active bleeding a single haemoglobin measurement can lag behind the patient. Reassessment and the local major-haemorrhage pathway take precedence over any threshold in this prototype.',
      source: 'Demonstration rule',
      when: { field: 'active_bleeding', op: 'isTrue' },
    },
    {
      id: 'R-SBP-LOW',
      severity: 'high',
      title: 'Systolic blood pressure below 90 mmHg',
      condition: 'systolic_bp < 90',
      rationale: 'Hypotension recorded in the entered observations. Haemodynamic assessment at the bedside is required.',
      source: 'Demonstration threshold',
      when: { field: 'systolic_bp', op: 'lt', value: 90 },
    },
    {
      id: 'R-SHOCK-INDEX',
      severity: 'high',
      title: 'Shock index at or above 1.0',
      condition: 'heart_rate / systolic_bp >= 1.0',
      rationale:
        'The shock index combines the two entered observations rather than reading either alone. A raised value is a prompt for urgent bedside review, not a transfusion trigger.',
      source: 'Demonstration composite indicator',
      when: { ratio: ['heart_rate', 'systolic_bp'], op: 'gte', value: 1.0, label: 'shock index (HR / SBP)' },
    },
    {
      id: 'R-HR-HIGH',
      severity: 'moderate',
      title: 'Heart rate above 100 bpm',
      condition: 'heart_rate > 100',
      rationale: 'Tachycardia in the entered observations. Many causes are unrelated to anaemia; interpret alongside the rest of the picture.',
      source: 'Demonstration threshold',
      when: { field: 'heart_rate', op: 'gt', value: 100 },
    },
    {
      id: 'R-REACTION-HISTORY',
      severity: 'advisory',
      title: 'Previous transfusion reaction reported',
      condition: 'prior_reaction is true',
      rationale:
        'A reported previous reaction is a reason to check the transfusion history and any special component requirements with the transfusion service before issue. This prototype cannot determine the reaction type or what it implies.',
      source: 'Demonstration rule',
      when: { field: 'prior_reaction', op: 'isTrue' },
    },
    {
      id: 'R-AGE-ELDERLY',
      severity: 'advisory',
      title: 'Age 65 or above with haemoglobin below 9.0 g/dL',
      condition: 'age >= 65 AND hb_g_dl < 9.0',
      rationale: 'Volume status and cardiac reserve are worth explicit consideration in older patients. Advisory only.',
      source: 'Demonstration rule',
      when: { all: [{ field: 'age', op: 'gte', value: 65 }, { field: 'hb_g_dl', op: 'lt', value: 9.0 }] },
    },
    {
      id: 'R-HB-ADEQUATE',
      severity: 'info',
      title: 'Haemoglobin at or above 10.0 g/dL with no bleeding reported',
      condition: 'hb_g_dl >= 10.0 AND active_bleeding is false',
      rationale:
        'Recorded for completeness. Under a restrictive strategy this combination is usually a prompt to ask whether a transfusion is needed at all, and to consider alternatives such as treating the underlying cause of anaemia.',
      source: 'Demonstration rule',
      when: { all: [{ field: 'hb_g_dl', op: 'gte', value: 10.0 }, { field: 'active_bleeding', op: 'isFalse' }] },
    },
  ],
};

/**
 * v1.1 - a deliberately different variant kept alongside v1.0 so the rule
 * replay and diff view has something real to compare against. It raises the
 * critical haemoglobin threshold and drops the composite shock-index rule,
 * which is exactly the kind of change a governance group would want to see
 * the effect of before approving.
 */
export const RULESET_V1_1 = {
  version: '1.1.0-draft',
  title: 'Draft variant - higher haemoglobin trigger, no composite index',
  description:
    'Draft rule set used to demonstrate rule governance. It raises the critical haemoglobin threshold from 7.0 to 8.0 g/dL and removes the shock-index rule. Not approved and not active.',
  approvedBy: null,
  rules: [
    {
      ...RULESET_V1.rules[0],
      title: 'Haemoglobin below 8.0 g/dL',
      condition: 'hb_g_dl < 8.0',
      when: { field: 'hb_g_dl', op: 'lt', value: 8.0 },
    },
    RULESET_V1.rules[1],
    RULESET_V1.rules[3],
    RULESET_V1.rules[4],
    RULESET_V1.rules[6],
    RULESET_V1.rules[7],
    RULESET_V1.rules[8],
    RULESET_V1.rules[9],
  ],
};
