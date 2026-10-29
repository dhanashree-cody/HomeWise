import { Card, Notice } from '../components/ui.jsx';

const DOES = [
  'Records structured, synthetic patient context and shows which entered values trigger a visible rule.',
  'Explains every flag by naming the rule, the observed value and the threshold it was compared against.',
  'Reports which rules could NOT be evaluated because data was missing, instead of treating a blank as normal.',
  'Shows, alongside the review, which donor groups are serologically compatible and which specific units could cover the request.',
  'Rotates stock by expiry (first-expiring-first-out) and warns when a compatible unit is about to be discarded.',
  'Keeps a versioned rule set, records the version used on every assessment, and can replay a stored case against another version.',
  'Blocks reservation of units until an authorised person attests to each pre-release check, and records who attested.',
  'Maintains a hash-chained, append-only ledger so history cannot be silently rewritten.',
  'Traces every unit from donor and donation through to the patient who received it.',
];

const DOES_NOT = [
  'It does not diagnose, and it does not decide whether a transfusion should happen. That decision belongs to a qualified clinician.',
  'It does not calculate a validated transfusion-necessity score and does not predict clinical outcomes.',
  'It does not perform ABO grouping, antibody screening or crossmatching. The checklist records attestation only.',
  'It does not authorise release of any blood component.',
  'Its thresholds are demonstration values. They have not been reviewed or approved by a transfusion committee.',
  'Its stock is a prototype database, not a live blood-bank system. Availability shown here is not evidence that a unit exists.',
  'Its donor eligibility criteria are illustrative and do not replace the donor-screening procedure or the medical officer assessment.',
  'It has not been clinically validated, usability tested with clinicians, or assessed as a medical device.',
];

const LIMITS = [
  ['Availability is not an indication', 'A full shelf never means a patient needs blood, and an empty shelf never means they do not. The two panels are deliberately kept separate for this reason.'],
  ['A flag is not an order', 'Flags are prompts to look, phrased as review prompts throughout. No screen in this system says "transfuse" or "do not transfuse".'],
  ['Missing is not normal', 'A rule whose inputs are absent is reported as unanswered. Treating a blank as a normal value is the hazard this guard exists to prevent.'],
  ['Group compatibility is not a crossmatch', 'The compatibility table describes ABO/RhD group relationships. It cannot account for antibodies, special requirements or unit-specific findings.'],
  ['Forecasts are planning aids', 'The demand projection is exponential smoothing over recent issues. It carries an error band and no guarantee.'],
];

export default function Safety() {
  return (
    <div className="stack">
      <Notice level="warning">
        <strong>HemoWise is an academic prototype built for a final-year mini-project.</strong> Every
        patient, donor and inventory record in it is synthetic. It must not be used to guide the care
        of any real person.
      </Notice>

      <div className="grid cols-2">
        <Card title="What this system does">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {DOES.map((d) => <li key={d} className="small" style={{ marginBottom: 7 }}>{d}</li>)}
          </ul>
        </Card>

        <Card title="What it deliberately does not do">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {DOES_NOT.map((d) => <li key={d} className="small" style={{ marginBottom: 7 }}>{d}</li>)}
          </ul>
        </Card>
      </div>

      <Card title="Design boundaries" hint="Each one is enforced in the system, not only stated here">
        {LIMITS.map(([title, text]) => (
          <div key={title} style={{ paddingBottom: 11, marginBottom: 11, borderBottom: '1px solid var(--grid)' }}>
            <div className="small" style={{ fontWeight: 650 }}>{title}</div>
            <div className="small muted">{text}</div>
          </div>
        ))}
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          A disclaimer alone is not a safety control. Where a boundary could be enforced in code it
          has been: incompatible units are refused on the server, reservation is blocked until every
          pre-release check is attested, expired units are swept out of availability before any view
          that reports stock, and missing inputs suppress the rules that depend on them.
        </p>
      </Card>

      <Card title="Before any real-world use">
        <p className="small">
          A system of this kind would require, at minimum: a multidisciplinary governance group owning
          the rule set; thresholds sourced from approved local policy with named owners and review
          dates; validation against authorised clinical data; formal hazard analysis and usability
          testing with the clinicians who would use it; secure identity and access management;
          integration tested end to end with the hospital and laboratory systems that hold the real
          data; and a documented route to disable the system if it behaves unsafely.
        </p>
        <p className="small" style={{ marginBottom: 0 }}>
          None of that has been done. The contribution of this project is a workflow design and a
          working demonstration of it, not evidence of clinical benefit.
        </p>
      </Card>
    </div>
  );
}
