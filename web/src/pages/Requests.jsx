import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, fmtDateTime } from '../lib/useApi.js';
import { Badge, Card, Empty, ErrorBox, GroupChip, Loading } from '../components/ui.jsx';

const STATUS_TONE = { pending: 'advisory', reserved: 'info', issued: 'ok', rejected: 'high', cancelled: 'neutral' };
const URGENCY_TONE = { emergency: 'high', urgent: 'moderate', routine: 'neutral' };

const TABS = [
  ['', 'All'],
  ['pending', 'Awaiting blood bank'],
  ['reserved', 'Reserved'],
  ['issued', 'Issued'],
];

export default function Requests() {
  const [status, setStatus] = useState('pending');
  const { data, loading, error } = useApi('/requests' + (status ? '?status=' + status : ''), [status]);

  return (
    <div className="stack">
      <div className="pill-tabs">
        {TABS.map(([k, t]) => (
          <button key={k || 'all'} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{t}</button>
        ))}
      </div>

      <Card title="Blood requests" hint="A request is a clinical ask; issuing requires blood-bank attestation">
        {loading ? <Loading what="requests" /> : error ? <ErrorBox error={error} /> :
          data.requests.length === 0 ? <Empty>No requests in this state.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Request</th><th>Patient</th><th>Need</th><th>Urgency</th>
                  <th>Status</th><th className="num">Units held</th><th>Raised</th><th></th>
                </tr>
              </thead>
              <tbody>
                {data.requests.map((r) => (
                  <tr key={r.id}>
                    <td className="mono tiny">{r.request_code}</td>
                    <td>
                      <Link to={'/patients/' + r.patient_id}>{r.patient_name}</Link>
                      <div className="tiny muted">{r.mrn} &middot; {r.ward || 'ward not set'}</div>
                    </td>
                    <td className="small">{r.units_requested} x {r.component} <GroupChip group={r.blood_group} /></td>
                    <td><Badge tone={URGENCY_TONE[r.urgency]}>{r.urgency}</Badge></td>
                    <td><Badge tone={STATUS_TONE[r.status] || 'neutral'}>{r.status}</Badge></td>
                    <td className="num">{r.status === 'issued' ? r.issued_count : r.reserved_count}</td>
                    <td className="tiny muted">{fmtDateTime(r.created_at)}<div>{r.raised_by_name}</div></td>
                    <td style={{ textAlign: 'right' }}>
                      <Link to={'/requests/' + r.id}><button className="sm">Open</button></Link>
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
