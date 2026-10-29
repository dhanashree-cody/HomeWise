import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApi, fmtDateTime } from '../lib/useApi.js';
import { useAuth } from '../lib/auth.jsx';
import { Badge, Card, Empty, ErrorBox, GroupChip, Loading, Notice } from '../components/ui.jsx';
import { ReadinessPanel } from '../components/clinical.jsx';

const STATUS_TONE = { pending: 'advisory', reserved: 'info', issued: 'ok', rejected: 'high', cancelled: 'neutral' };

/**
 * Pre-release attestation.
 *
 * HemoWise cannot perform grouping, antibody screening or crossmatching, and
 * it does not pretend to. What it can do is refuse to let units be reserved
 * until an authorised person has confirmed each step, and record who confirmed
 * it. Enforcement lives on the server; this form is only the attestation UI.
 */
function Crossmatch({ request, onDone }) {
  const { data: meta } = useApi('/requests/checklist');
  const [checks, setChecks] = useState({});
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const list = meta?.checklist || [];
  const allChecked = list.length > 0 && list.every((c) => checks[c.id]);

  const reserve = async () => {
    setBusy(true); setErr(null);
    try {
      await api.post('/requests/' + request.id + '/reserve', { crossmatch: checks });
      onDone();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  const reject = async () => {
    const reason = window.prompt('Reason for rejecting this request:');
    if (!reason) return;
    setBusy(true); setErr(null);
    try {
      await api.post('/requests/' + request.id + '/reject', { reason });
      onDone();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  return (
    <Card title="Pre-release checks" hint="Every item must be confirmed before units can be reserved">
      <Notice level="warning">
        HemoWise does not perform any of these steps. Ticking a box records that you, as an authorised
        member of blood-bank staff, have carried it out and confirmed the result. Your name and the
        time are written to the audit ledger.
      </Notice>

      <div style={{ marginTop: 10 }}>
        {list.map((c) => (
          <label className="check" key={c.id}>
            <input type="checkbox" checked={!!checks[c.id]} onChange={(e) => setChecks({ ...checks, [c.id]: e.target.checked })} />
            <span>{c.text}</span>
          </label>
        ))}
      </div>

      {err && <ErrorBox error={err} />}

      <div className="btn-row" style={{ marginTop: 12 }}>
        <button className="primary" onClick={reserve} disabled={!allChecked || busy}>
          {busy ? 'Reserving...' : 'Confirm and reserve units'}
        </button>
        <button className="danger" onClick={reject} disabled={busy}>Reject request</button>
      </div>
      {!allChecked && <p className="tiny muted" style={{ marginTop: 8, marginBottom: 0 }}>
        {list.filter((c) => !checks[c.id]).length} check(s) outstanding.
      </p>}
    </Card>
  );
}

export default function RequestDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data, loading, error, reload } = useApi('/requests/' + id);
  const [actionErr, setActionErr] = useState(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading what="request" />;
  if (error) return <ErrorBox error={error} />;

  const { request: r, patient, units, assessment, readiness } = data;

  const issue = async () => {
    setBusy(true); setActionErr(null);
    try { await api.post('/requests/' + r.id + '/issue'); reload(); }
    catch (e) { setActionErr(e); } finally { setBusy(false); }
  };

  return (
    <div className="grid split">
      <div className="stack">
        <Card
          title={r.request_code}
          hint={'Raised ' + fmtDateTime(r.created_at)}
          action={<Badge tone={STATUS_TONE[r.status] || 'neutral'}>{r.status}</Badge>}
        >
          <div className="grid cols-2">
            <dl className="kv">
              <dt>Patient</dt>
              <dd><Link to={'/patients/' + patient.id}>{patient.full_name}</Link> <span className="tiny muted mono">{patient.mrn}</span></dd>
              <dt>Ward</dt><dd>{patient.ward || '-'}</dd>
              <dt>Age / sex</dt><dd>{patient.age} {patient.sex}</dd>
            </dl>
            <dl className="kv">
              <dt>Component</dt><dd>{r.component}</dd>
              <dt>Recipient group</dt><dd><GroupChip group={r.blood_group} /></dd>
              <dt>Units requested</dt><dd>{r.units_requested}</dd>
              <dt>Urgency</dt><dd style={{ textTransform: 'capitalize' }}>{r.urgency}</dd>
            </dl>
          </div>
          {r.note && <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>{r.note}</p>}

          {assessment && (
            <>
              <div className="sep" />
              <div className="spread">
                <div>
                  <div className="small" style={{ fontWeight: 600 }}>Linked assessment #{assessment.id}</div>
                  <div className="tiny muted">{assessment.review_status} &middot; {assessment.flags.filter((f) => f.severity !== 'info').length} flag(s)</div>
                </div>
                <Link to={'/assessments/' + assessment.id}><button className="sm">View review</button></Link>
              </div>
            </>
          )}
        </Card>

        {actionErr && <ErrorBox error={actionErr} />}

        {r.status === 'pending' && can('bloodbank') && <Crossmatch request={r} onDone={reload} />}

        {r.status === 'pending' && !can('bloodbank') && (
          <Notice level="info">
            This request is waiting for blood-bank staff to complete the pre-release checks. Your role
            cannot reserve or issue units.
          </Notice>
        )}

        {r.crossmatch && (
          <Card title="Pre-release attestation" hint={'Confirmed by ' + r.crossmatch.confirmedBy + ' on ' + fmtDateTime(r.crossmatch.confirmedAt)}>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Check</th><th>Confirmed</th></tr></thead>
                <tbody>
                  {Object.entries(r.crossmatch.checks || {}).map(([k, v]) => (
                    <tr key={k}>
                      <td className="small">{k}</td>
                      <td>{v ? <Badge tone="ok">yes</Badge> : <Badge tone="high">no</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <Card
          title={'Units on this request (' + units.length + ')'}
          action={r.status === 'reserved' && can('bloodbank')
            ? <button className="primary sm" onClick={issue} disabled={busy}>{busy ? 'Issuing...' : 'Issue to patient'}</button>
            : null}
        >
          {units.length === 0 ? <Empty>No units reserved yet.</Empty> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Unit</th><th>Group</th><th>Expires</th><th className="num">Days left</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {units.map((u) => (
                    <tr key={u.id}>
                      <td className="mono">{u.unit_code}</td>
                      <td><GroupChip group={u.blood_group} /></td>
                      <td className="tiny nowrap">{u.expires_on}</td>
                      <td className="num">{u.daysToExpiry}</td>
                      <td><Badge tone={u.status === 'issued' ? 'ok' : 'info'}>{u.status}</Badge></td>
                      <td style={{ textAlign: 'right' }}>
                        <Link to={'/trace?unit=' + u.unit_code}><button className="sm">Trace</button></Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="stack">
        {readiness
          ? <ReadinessPanel readiness={readiness} />
          : (
            <Card title="Fulfilment readiness">
              <p className="small" style={{ marginBottom: 0 }}>
                Readiness is computed while a request is pending. This request has moved to
                &ldquo;{r.status}&rdquo;, so the units above are the record of what was actually allocated.
              </p>
            </Card>
          )}
      </div>
    </div>
  );
}
