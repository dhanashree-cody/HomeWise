import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, fmtDateTime } from '../lib/useApi.js';
import { Badge, Card, Empty, ErrorBox, GroupChip, Loading } from '../components/ui.jsx';

const TONE = {
  'Priority clinician review': 'high',
  'Clinician review suggested': 'moderate',
  'Incomplete - review data entry': 'data',
  'Advisory notes for clinician': 'advisory',
  'No demonstration rule triggered': 'ok',
};

const FULFIL_TONE = { full: 'ok', partial: 'advisory', none: 'high', unknown: 'data' };

export default function Assessments() {
  const { data, loading, error } = useApi('/assessments');
  const [filter, setFilter] = useState('all');

  if (loading) return <Loading what="assessments" />;
  if (error) return <ErrorBox error={error} />;

  const rows = data.assessments.filter((a) => {
    if (filter === 'all') return true;
    if (filter === 'priority') return a.review_status?.startsWith('Priority');
    if (filter === 'short') return a.fulfilment !== 'full';
    return true;
  });

  return (
    <Card
      title={rows.length + ' assessment(s)'}
      hint="Each row keeps the rule version that produced its flags"
      action={
        <div className="pill-tabs">
          {[['all', 'All'], ['priority', 'Priority'], ['short', 'Stock short']].map(([k, t]) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{t}</button>
          ))}
        </div>
      }
    >
      {rows.length === 0 ? <Empty>No assessments match this filter.</Empty> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th><th>Patient</th><th>Context</th><th className="num">Hb</th>
                <th>Need</th><th className="num">Flags</th><th>Review status</th><th>Stock</th><th>Rules</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="tiny muted">{fmtDateTime(a.created_at)}</td>
                  <td>
                    <Link to={'/assessments/' + a.id}>{a.patient_name}</Link>
                    <div className="tiny muted mono">{a.mrn}</div>
                  </td>
                  <td className="small">{a.clinical_context}</td>
                  <td className="num">{a.hb_g_dl ?? <span className="muted">n/r</span>}</td>
                  <td className="small">{a.units_requested} x {a.component} <GroupChip group={a.blood_group} /></td>
                  <td className="num">{a.flagCount}</td>
                  <td><Badge tone={TONE[a.review_status] || 'neutral'}>{a.review_status}</Badge></td>
                  <td><Badge tone={FULFIL_TONE[a.fulfilment] || 'neutral'}>{a.fulfilment}</Badge></td>
                  <td className="tiny mono muted">{a.rule_version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
