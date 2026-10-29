import { useState } from 'react';
import { api } from '../lib/api.js';
import { useApi, fmtDateTime } from '../lib/useApi.js';
import { useAuth } from '../lib/auth.jsx';
import { Badge, Card, Empty, ErrorBox, Loading, Notice, SeverityBadge } from '../components/ui.jsx';

function RuleDetail({ id }) {
  const { data, loading } = useApi(id ? '/rulesets/' + id : null, [id]);
  if (!id) return null;
  if (loading || !data) return <Loading what="rule set" />;
  const rs = data.ruleSet;

  return (
    <Card title={rs.version + ' - ' + rs.title} hint={rs.rules.length + ' rules'}>
      <p className="small">{rs.description}</p>
      <div className="sep" />
      {rs.rules.map((r) => (
        <div key={r.id} className="flag" style={{ borderLeftColor: 'var(--border)' }}>
          <div className="flag-top">
            <span className="flag-title">{r.title}</span>
            <SeverityBadge severity={r.severity} />
          </div>
          <div className="evidence">
            <div className="evidence-row"><span className="k">when</span><span className="v">{r.condition}</span></div>
          </div>
          <p className="flag-why">{r.rationale}</p>
          <div className="tiny muted">{r.id}{r.source ? ' · ' + r.source : ''}</div>
        </div>
      ))}
    </Card>
  );
}

function Compare({ sets }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true); setErr(null);
    try { setResult(await api.get('/rulesets/' + a + '/compare/' + b)); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };

  return (
    <Card title="Compare two versions" hint="Textual diff plus the effect on stored cases">
      <p className="small">
        A threshold change is easy to write and hard to judge. This replays every stored assessment
        through both versions, so the question becomes &ldquo;which cases would read differently?&rdquo;
        rather than &ldquo;does the new wording look sensible?&rdquo;
      </p>
      <div className="row" style={{ marginBottom: 12 }}>
        <select value={a} onChange={(e) => setA(e.target.value)}>
          <option value="">From...</option>
          {sets.map((s) => <option key={s.id} value={s.id}>{s.version}</option>)}
        </select>
        <span className="muted">to</span>
        <select value={b} onChange={(e) => setB(e.target.value)}>
          <option value="">To...</option>
          {sets.map((s) => <option key={s.id} value={s.id}>{s.version}</option>)}
        </select>
        <button className="primary" onClick={run} disabled={!a || !b || a === b || busy}>
          {busy ? 'Comparing...' : 'Compare'}
        </button>
      </div>

      {err && <ErrorBox error={err} />}

      {result && (
        <>
          <Notice level={result.impact.assessmentsChanged > 0 ? 'warning' : 'ok'}>
            <strong>
              {result.impact.assessmentsChanged} of {result.impact.assessmentsChecked} stored assessment(s)
              would flag differently.
            </strong>
            <div className="tiny" style={{ marginTop: 3 }}>{result.note}</div>
          </Notice>

          <div className="grid cols-3" style={{ marginTop: 12 }}>
            <div>
              <h3 style={{ marginBottom: 6 }}>Rules removed</h3>
              {result.ruleDiff.removed.length ? result.ruleDiff.removed.map((r) => (
                <div key={r.id} className="small" style={{ padding: '3px 0' }}>{r.title}<div className="tiny muted mono">{r.condition}</div></div>
              )) : <div className="tiny muted">None</div>}
            </div>
            <div>
              <h3 style={{ marginBottom: 6 }}>Rules added</h3>
              {result.ruleDiff.added.length ? result.ruleDiff.added.map((r) => (
                <div key={r.id} className="small" style={{ padding: '3px 0' }}>{r.title}<div className="tiny muted mono">{r.condition}</div></div>
              )) : <div className="tiny muted">None</div>}
            </div>
            <div>
              <h3 style={{ marginBottom: 6 }}>Thresholds changed</h3>
              {result.ruleDiff.modified.length ? result.ruleDiff.modified.map((r) => (
                <div key={r.id} className="small" style={{ padding: '3px 0' }}>
                  {r.title}
                  <div className="tiny muted mono">{r.from} &rarr; {r.to}</div>
                </div>
              )) : <div className="tiny muted">None</div>}
            </div>
          </div>

          {result.impact.examples.length > 0 && (
            <>
              <div className="sep" />
              <h3 style={{ marginBottom: 7 }}>Affected cases</h3>
              <div className="table-wrap scroll-y">
                <table>
                  <thead><tr><th>Assessment</th><th>Flags removed</th><th>Flags added</th></tr></thead>
                  <tbody>
                    {result.impact.examples.map((x) => (
                      <tr key={x.assessmentId}>
                        <td><a href={'#/assessments/' + x.assessmentId}>#{x.assessmentId}</a></td>
                        <td className="tiny">{x.removed.map((f) => f.title).join(', ') || '-'}</td>
                        <td className="tiny">{x.added.map((f) => f.title).join(', ') || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </Card>
  );
}

export default function RuleSets() {
  const { can } = useAuth();
  const { data, loading, error, reload } = useApi('/rulesets');
  const [open, setOpen] = useState(null);
  const [actErr, setActErr] = useState(null);

  if (loading) return <Loading what="rule sets" />;
  if (error) return <ErrorBox error={error} />;

  const activate = async (rs) => {
    const approver = window.prompt('Who is approving activation of ' + rs.version + '?');
    if (!approver) return;
    setActErr(null);
    try { await api.post('/rulesets/' + rs.id + '/activate', { approved_by: approver }); reload(); }
    catch (e) { setActErr(e); }
  };

  return (
    <div className="stack">
      <Notice level="info">
        Rules are stored as versioned data, not as code. Every assessment records the version that
        produced its flags, so a historical review can always be explained &mdash; and changing the
        active version never rewrites what was already decided.
      </Notice>

      {actErr && <ErrorBox error={actErr} />}

      <Card title="Rule set versions">
        {data.ruleSets.length === 0 ? <Empty /> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Version</th><th>Title</th><th className="num">Rules</th><th className="num">Used by</th><th>Approved</th><th>State</th><th></th></tr>
              </thead>
              <tbody>
                {data.ruleSets.map((rs) => (
                  <tr key={rs.id}>
                    <td className="mono">{rs.version}</td>
                    <td className="small">{rs.title}</td>
                    <td className="num">{rs.ruleCount}</td>
                    <td className="num">{rs.usedBy}</td>
                    <td className="tiny muted">
                      {rs.approved_by || 'not approved'}
                      {rs.approved_on && <div>{fmtDateTime(rs.approved_on)}</div>}
                    </td>
                    <td>{rs.is_active ? <Badge tone="ok">active</Badge> : <Badge tone="neutral">inactive</Badge>}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
                        <button className="sm" onClick={() => setOpen(open === rs.id ? null : rs.id)}>
                          {open === rs.id ? 'Hide' : 'View rules'}
                        </button>
                        {can('admin') && !rs.is_active && (
                          <button className="sm primary" onClick={() => activate(rs)}>Activate</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <RuleDetail id={open} />
      <Compare sets={data.ruleSets} />
    </div>
  );
}
