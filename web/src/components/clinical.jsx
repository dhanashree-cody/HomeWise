import { useState } from 'react';
import { Badge, Card, Empty, GroupChip, Notice, SeverityBadge } from './ui.jsx';

const OP_TEXT = {
  lt: '<', lte: '<=', gt: '>', gte: '>=', eq: 'is', ne: 'is not',
  in: 'is one of', isTrue: 'is', isFalse: 'is', present: 'present',
};

const FIELD_LABEL = {
  hb_g_dl: 'Haemoglobin', heart_rate: 'Heart rate', systolic_bp: 'Systolic BP',
  active_bleeding: 'Active bleeding', prior_reaction: 'Previous reaction',
  clinical_context: 'Clinical context', age: 'Age', blood_group: 'Blood group',
};

const label = (f) => FIELD_LABEL[f] || f;

function showValue(v) {
  if (v === null || v === undefined) return 'not recorded';
  if (v === true) return 'yes';
  if (v === false) return 'no';
  if (Array.isArray(v)) return v.join(' / ');
  return String(v);
}

/**
 * One flag, with the evidence that produced it.
 *
 * The evidence row is the point of the whole screen: it shows the observed
 * value, the comparison and the threshold, so a reviewer can tell at a glance
 * whether the flag is reasonable instead of taking it on trust.
 */
export function Flag({ flag }) {
  const [open, setOpen] = useState(flag.severity === 'high' || flag.severity === 'data');
  return (
    <article className={'flag flag-' + flag.severity}>
      <div className="flag-top">
        <span className="flag-title">{flag.title}</span>
        <span className="row" style={{ gap: 7 }}>
          <SeverityBadge severity={flag.severity} />
          <button className="link tiny" onClick={() => setOpen(!open)}>
            {open ? 'Hide' : 'Why?'}
          </button>
        </span>
      </div>

      {open && (
        <>
          <div className="evidence">
            {flag.evidence.map((e, i) => (
              <div className="evidence-row" key={i}>
                <span className="k">{label(e.field)}</span>
                <span className="v">{showValue(e.observed)}</span>
                <span className="op">{OP_TEXT[e.op] || e.op}</span>
                <span className="v">{showValue(e.expected)}</span>
                {e.missing && <Badge tone="data">not supplied</Badge>}
              </div>
            ))}
          </div>
          <p className="flag-why">{flag.rationale}</p>
          <div className="tiny muted">
            Rule {flag.id} &middot; rule set {flag.ruleSetVersion}
            {flag.source ? ' · ' + flag.source : ''}
          </div>
          {flag.skipped?.length > 0 && (
            <div className="tiny muted" style={{ marginTop: 5 }}>
              Not evaluated: {flag.skipped.map((s) => s.id).join(', ')}
            </div>
          )}
        </>
      )}
    </article>
  );
}

export function FlagList({ flags }) {
  if (!flags?.length) {
    return <Notice level="ok">No demonstration rule was triggered by the values entered. This is not a statement that the patient is well, nor that a transfusion is or is not indicated.</Notice>;
  }
  return <div>{flags.map((f) => <Flag key={f.id} flag={f} />)}</div>;
}

const FULFILMENT = {
  full: { tone: 'ok', text: 'Stock can cover this request' },
  partial: { tone: 'advisory', text: 'Stock covers only part of this request' },
  none: { tone: 'high', text: 'No compatible stock available' },
  unknown: { tone: 'data', text: 'Cannot be determined' },
};

/**
 * FULFILMENT READINESS PANEL - the coupled view.
 *
 * This is what distinguishes HemoWise from the systems in the literature: the
 * operational answer sits beside the clinical review rather than in a separate
 * application, and it names actual units rather than reporting a stock count.
 */
export function ReadinessPanel({ readiness: r, compact = false }) {
  if (!r) return null;
  const f = FULFILMENT[r.fulfilment] || FULFILMENT.unknown;

  return (
    <Card
      title="Fulfilment readiness"
      hint={'Operational availability for ' + r.unitsRequested + ' x ' + (r.componentLabel || r.component)}
      action={<Badge tone={f.tone}>{f.text}</Badge>}
    >
      <Notice level="info">
        Availability is logistics, not an indication. Stock on the shelf does not mean a transfusion
        is needed, and an empty shelf does not mean it is. Units still require antibody screening,
        crossmatch and authorised release.
      </Notice>

      <div className="grid cols-3" style={{ marginTop: 12 }}>
        <div className="stat">
          <div className="stat-label">Covered</div>
          <div className="stat-value">{r.unitsAllocated}<span className="muted" style={{ fontSize: 16 }}> / {r.unitsRequested}</span></div>
          {r.shortfall > 0 && <div className="stat-note" style={{ color: 'var(--critical)' }}>Short by {r.shortfall}</div>}
        </div>
        <div className="stat">
          <div className="stat-label">Compatible stock</div>
          <div className="stat-value">{r.compatibleStock}</div>
          <div className="stat-note">{r.exactMatchStock} identical group</div>
        </div>
        <div className="stat">
          <div className="stat-label">Days of cover</div>
          <div className="stat-value">{r.coverageDays ?? '-'}</div>
          <div className="stat-note">{r.dailyIssueRate != null ? 'at ' + r.dailyIssueRate + ' units/day' : 'no recent demand'}</div>
        </div>
      </div>

      {r.compatibleGroups?.length > 0 && (
        <>
          <div className="sep" />
          <h3 style={{ marginBottom: 7 }}>Acceptable donor groups for {r.recipientGroup}</h3>
          <div className="row" style={{ gap: 7 }}>
            {r.compatibleGroups.map((g) => (
              <span key={g.group} title={g.note} className="row" style={{ gap: 4 }}>
                <GroupChip group={g.group} />
                {g.identical && <Badge tone="ok">identical</Badge>}
                {g.conserve && <Badge tone="advisory">scarce</Badge>}
              </span>
            ))}
          </div>
          <p className="tiny muted" style={{ marginTop: 6, marginBottom: 0 }}>
            Serological group compatibility, in preference order. This is not a crossmatch result.
          </p>
        </>
      )}

      {r.allocation?.length > 0 && (
        <>
          <div className="sep" />
          <h3 style={{ marginBottom: 2 }}>Suggested allocation</h3>
          <p className="tiny muted" style={{ marginBottom: 8 }}>
            Identical group first, then earliest expiry within each preference rank (first-expiring-first-out),
            so the shelf rotates instead of ageing. The blood bank may reserve different units.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>#</th><th>Unit</th><th>Group</th><th>Expires</th><th className="num">Days left</th>{!compact && <th>Why this unit</th>}</tr>
              </thead>
              <tbody>
                {r.allocation.map((u) => (
                  <tr key={u.unitId}>
                    <td className="muted">{u.order}</td>
                    <td className="mono">{u.unitCode}</td>
                    <td><GroupChip group={u.group} /></td>
                    <td className="tiny nowrap">{u.expiresOn}</td>
                    <td className="num">
                      {u.daysToExpiry <= 3
                        ? <Badge tone="high">{u.daysToExpiry}</Badge>
                        : u.daysToExpiry <= 7
                          ? <Badge tone="advisory">{u.daysToExpiry}</Badge>
                          : u.daysToExpiry}
                    </td>
                    {!compact && <td className="tiny muted">{u.reason}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {r.wastage?.salvageSuggestion && (
        <div style={{ marginTop: 12 }}>
          <Notice level="warning">
            <strong>Wastage alternative. </strong>{r.wastage.salvageSuggestion.text}
          </Notice>
        </div>
      )}

      {r.advisories?.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {r.advisories.map((a, i) => (
            <Notice key={i} level={a.level === 'critical' ? 'critical' : a.level === 'warning' ? 'warning' : a.level === 'ok' ? 'ok' : 'info'}>
              {a.text}
            </Notice>
          ))}
        </div>
      )}
    </Card>
  );
}

export function ReviewStatusBanner({ status, flags }) {
  const counts = (flags || []).reduce((m, f) => ({ ...m, [f.severity]: (m[f.severity] || 0) + 1 }), {});
  const level = status?.startsWith('Priority') ? 'critical'
    : status?.startsWith('Clinician') ? 'warning'
      : status?.startsWith('Incomplete') ? 'info' : 'ok';

  return (
    <Notice level={level}>
      <strong>{status}</strong>
      <div className="tiny" style={{ marginTop: 3 }}>
        {counts.high ? counts.high + ' high' : ''}{counts.high && counts.moderate ? ', ' : ''}
        {counts.moderate ? counts.moderate + ' moderate' : ''}
        {(counts.high || counts.moderate) && counts.advisory ? ', ' : ''}
        {counts.advisory ? counts.advisory + ' advisory' : ''}
        {Object.keys(counts).length ? ' flag(s) triggered. ' : 'No flags triggered. '}
        This is a prompt for clinician review, not a recommendation to transfuse or to withhold.
      </div>
    </Notice>
  );
}
