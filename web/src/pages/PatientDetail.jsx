import { Link, useParams } from 'react-router-dom';
import { useApi, fmtDate, fmtDateTime } from '../lib/useApi.js';
import { useAuth } from '../lib/auth.jsx';
import { Badge, Card, Empty, ErrorBox, GroupChip, Loading } from '../components/ui.jsx';

const STATUS_TONE = { pending: 'advisory', reserved: 'info', issued: 'ok', rejected: 'high', cancelled: 'neutral' };

export default function PatientDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data, loading, error } = useApi('/patients/' + id);

  if (loading) return <Loading what="patient" />;
  if (error) return <ErrorBox error={error} />;

  const { patient: p, assessments, requests, transfused } = data;

  return (
    <div className="stack">
      <Card
        title={p.full_name}
        hint={p.mrn + ' - synthetic record'}
        action={can('clinician') ? <Link to={'/assess?patient=' + p.id}><button className="primary sm">New assessment</button></Link> : null}
      >
        <div className="grid cols-4">
          <dl className="kv"><dt>Age</dt><dd>{p.age}</dd></dl>
          <dl className="kv"><dt>Sex</dt><dd>{p.sex}</dd></dl>
          <dl className="kv">
            <dt>Blood group</dt>
            <dd>{p.blood_group ? <GroupChip group={p.blood_group} /> : <Badge tone="data">not grouped</Badge>}</dd>
          </dl>
          <dl className="kv"><dt>Ward</dt><dd>{p.ward || '-'}</dd></dl>
        </div>
        {p.notes && <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>{p.notes}</p>}
      </Card>

      <div className="grid cols-2">
        <Card title={'Assessments (' + assessments.length + ')'}>
          {assessments.length === 0 ? <Empty>No assessments recorded.</Empty> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>When</th><th>Context</th><th className="num">Hb</th><th>Review status</th></tr></thead>
                <tbody>
                  {assessments.map((a) => (
                    <tr key={a.id}>
                      <td className="tiny"><Link to={'/assessments/' + a.id}>{fmtDateTime(a.created_at)}</Link></td>
                      <td className="small">{a.clinical_context}</td>
                      <td className="num">{a.hb_g_dl ?? <span className="muted">n/r</span>}</td>
                      <td className="tiny">{a.review_status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={'Blood requests (' + requests.length + ')'}>
          {requests.length === 0 ? <Empty>No requests raised.</Empty> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Request</th><th>Need</th><th>Urgency</th><th>Status</th></tr></thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id}>
                      <td><Link to={'/requests/' + r.id} className="mono tiny">{r.request_code}</Link></td>
                      <td className="small">{r.units_requested} x {r.component}</td>
                      <td className="small">{r.urgency}</td>
                      <td><Badge tone={STATUS_TONE[r.status] || 'neutral'}>{r.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card title={'Units transfused (' + transfused.length + ')'} hint="Each unit traces back to the donation it came from">
        {transfused.length === 0 ? <Empty>No units issued to this patient.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Unit</th><th>Component</th><th>Group</th><th>Issued</th><th></th></tr></thead>
              <tbody>
                {transfused.map((u) => (
                  <tr key={u.unit_code}>
                    <td className="mono">{u.unit_code}</td>
                    <td className="small">{u.component}</td>
                    <td><GroupChip group={u.blood_group} /></td>
                    <td className="small">{fmtDate(u.issued_on)}</td>
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
  );
}
