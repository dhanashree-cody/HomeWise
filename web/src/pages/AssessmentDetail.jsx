import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApi, fmtDateTime, titleCase } from '../lib/useApi.js';
import { Badge, Card, Empty, ErrorBox, GroupChip, Loading, Notice, SeverityBadge } from '../components/ui.jsx';
import { FlagList, ReadinessPanel, ReviewStatusBanner } from '../components/clinical.jsx';

function Replay({ assessmentId, currentRuleSetId }) {
  const { data: sets } = useApi('/rulesets');
  const [target, setTarget] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const options = (sets?.ruleSets || []).filter((r) => r.id !== currentRuleSetId);

  const run = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api.get('/assessments/' + assessmentId + '/replay/' + target));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Replay against another rule version" hint="Read-only. The stored record never changes.">
      <p className="small">
        Re-run exactly these inputs through a different rule set to see what a threshold change would
        have meant for this case. This is how a change can be reviewed before it is approved rather
        than discovered afterwards.
      </p>
      <div className="row" style={{ marginBottom: 12 }}>
        <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ maxWidth: 360 }}>
          <option value="">Select a rule set...</option>
          {options.map((r) => (
            <option key={r.id} value={r.id}>{r.version} &mdash; {r.title}{r.is_active ? ' (active)' : ''}</option>
          ))}
        </select>
        <button className="primary" onClick={run} disabled={!target || busy}>{busy ? 'Replaying...' : 'Replay'}</button>
      </div>

      {error && <ErrorBox error={error} />}

      {result && (
        <>
          {result.diff.identical ? (
            <Notice level="ok">
              Both rule sets produce exactly the same flags for this case. The change would not have
              altered this review.
            </Notice>
          ) : (
            <Notice level="warning">
              <strong>The flags differ.</strong> Under {result.replayed.ruleSet.version} this case would
              read &ldquo;{result.replayed.reviewStatus}&rdquo; instead of &ldquo;{result.original.reviewStatus}&rdquo;.
            </Notice>
          )}

          <div className="grid cols-2" style={{ marginTop: 12 }}>
            <div>
              <h3 style={{ marginBottom: 7 }}>Removed under {result.replayed.ruleSet.version}</h3>
              {result.diff.removed.length ? result.diff.removed.map((f) => (
                <div key={f.id} className="spread small" style={{ padding: '5px 0' }}>
                  <span>{f.title}</span><SeverityBadge severity={f.severity} />
                </div>
              )) : <div className="tiny muted">None</div>}
            </div>
            <div>
              <h3 style={{ marginBottom: 7 }}>Added under {result.replayed.ruleSet.version}</h3>
              {result.diff.added.length ? result.diff.added.map((f) => (
                <div key={f.id} className="spread small" style={{ padding: '5px 0' }}>
                  <span>{f.title}</span><SeverityBadge severity={f.severity} />
                </div>
              )) : <div className="tiny muted">None</div>}
            </div>
          </div>

          {result.diff.changed.length > 0 && (
            <>
              <div className="sep" />
              <h3 style={{ marginBottom: 7 }}>Severity changed</h3>
              {result.diff.changed.map((c) => (
                <div key={c.id} className="small">{c.title}: {c.from} &rarr; {c.to}</div>
              ))}
            </>
          )}

          <p className="tiny muted" style={{ marginTop: 12, marginBottom: 0 }}>{result.note}</p>
        </>
      )}
    </Card>
  );
}

export default function AssessmentDetail() {
  const { id } = useParams();
  const { data, loading, error } = useApi('/assessments/' + id);

  if (loading) return <Loading what="assessment" />;
  if (error) return <ErrorBox error={error} />;

  const a = data.assessment;
  const i = a.inputs;

  const v = (val, unit) => (val === null || val === undefined
    ? <span className="muted">not recorded</span>
    : <>{val}{unit ? ' ' + unit : ''}</>);

  return (
    <div className="grid split">
      <div className="stack">
        <Card title={'Assessment #' + a.id} hint={fmtDateTime(a.created_at) + ' by ' + (a.author?.full_name || 'unknown')}>
          <ReviewStatusBanner status={a.review_status} flags={a.flags} />

          <div className="sep" />
          <div className="grid cols-2">
            <dl className="kv">
              <dt>Patient</dt>
              <dd><Link to={'/patients/' + a.patient_id}>{a.patient?.full_name}</Link> <span className="tiny muted mono">{a.patient?.mrn}</span></dd>
              <dt>Age / sex</dt><dd>{a.patient?.age} {a.patient?.sex}</dd>
              <dt>Ward</dt><dd>{a.patient?.ward || '-'}</dd>
              <dt>Context</dt><dd>{titleCase(a.clinical_context)}</dd>
            </dl>
            <dl className="kv">
              <dt>Haemoglobin</dt><dd>{v(i.hb_g_dl, 'g/dL')}</dd>
              <dt>Heart rate</dt><dd>{v(i.heart_rate, 'bpm')}</dd>
              <dt>Systolic BP</dt><dd>{v(i.systolic_bp, 'mmHg')}</dd>
              <dt>Active bleeding</dt><dd>{i.active_bleeding ? <Badge tone="high">yes</Badge> : 'no'}</dd>
              <dt>Prior reaction</dt><dd>{i.prior_reaction ? <Badge tone="advisory">yes</Badge> : 'no'}</dd>
              <dt>Requested</dt>
              <dd>{a.units_requested} x {a.component} <GroupChip group={a.blood_group} /></dd>
            </dl>
          </div>

          <div className="sep" />
          <div className="tiny muted">
            Evaluated under rule set <strong className="mono">{a.ruleSet?.version}</strong> &mdash; {a.ruleSet?.title}.
            This record keeps that version permanently, so the flags above can always be explained.
          </div>
        </Card>

        <Card title="Review flags" action={<Badge tone="neutral">{a.flags.length}</Badge>}>
          <FlagList flags={a.flags} />
        </Card>

        <Replay assessmentId={a.id} currentRuleSetId={a.rule_set_id} />
      </div>

      <div className="stack">
        <ReadinessPanel readiness={a.readiness} />
        <Card title="Readiness at the time of review" hint="A snapshot, not live stock">
          <p className="small" style={{ marginBottom: 0 }}>
            The panel above records what stock looked like when this assessment was saved
            ({a.readiness?.asOf}). Current availability may differ &mdash; check the
            {' '}<Link to="/inventory">inventory</Link> before acting.
          </p>
        </Card>
      </div>
    </div>
  );
}
