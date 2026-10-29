import { Link } from 'react-router-dom';
import { useApi, fmtDate, fmtDateTime } from '../lib/useApi.js';
import { Card, Stat, Badge, GroupChip, Notice, Loading, ErrorBox, Empty, SeverityBadge } from '../components/ui.jsx';
import { BarChart, LineChart } from '../components/charts.jsx';

const URGENCY_TONE = { emergency: 'high', urgent: 'moderate', routine: 'neutral' };

function statusTone(s) {
  if (s?.startsWith('Priority')) return 'high';
  if (s?.startsWith('Clinician')) return 'moderate';
  if (s?.startsWith('Incomplete')) return 'data';
  if (s?.startsWith('Advisory')) return 'advisory';
  return 'ok';
}

export default function Dashboard() {
  const { data, loading, error } = useApi('/dashboard');
  const { data: fc } = useApi('/inventory/forecast?component=PRBC&horizon=14');

  if (loading) return <Loading what="dashboard" />;
  if (error) return <ErrorBox error={error} />;

  const c = data.counts;
  const groupBars = data.byGroup.map((g) => ({
    label: g.group,
    value: g.total,
    note: g.expiringSoon ? g.expiringSoon + ' expiring within 7 days' : null,
  }));

  return (
    <div className="stack">
      <div className="grid cols-4">
        <Card><Stat label="Units available" value={c.availableUnits} note={c.quarantinedUnits + ' in quarantine'} /></Card>
        <Card><Stat label="Open requests" value={c.pendingRequests + c.reservedRequests} note={c.pendingRequests + ' awaiting blood bank'} /></Card>
        <Card><Stat label="Issued (30 days)" value={c.issuedLast30} note={'Rate ' + (data.dailyIssueRate.PRBC ?? 0) + ' PRBC/day'} /></Card>
        <Card><Stat label="Assessments" value={c.assessments} note={c.patients + ' patients on file'} /></Card>
      </div>

      {data.expiryAlerts.critical.length > 0 && (
        <Notice level="critical">
          <strong>{data.expiryAlerts.critical.length} unit(s) expire within 3 days.</strong>{' '}
          {data.expiryAlerts.critical.slice(0, 6).map((u) => u.unit_code + ' (' + u.blood_group + ', ' + u.daysToExpiry + 'd)').join(', ')}
          {data.expiryAlerts.critical.length > 6 && ' and more'}.{' '}
          <Link to="/inventory">Review inventory</Link>
        </Notice>
      )}
      {data.expiryAlerts.soonCount > 0 && (
        <Notice level="warning">
          {data.expiryAlerts.soonCount} further unit(s) expire within 7 days. Rotating these first reduces wastage.
        </Notice>
      )}

      <div className="grid split">
        <Card title="Available stock by blood group" hint="Packed cells, plasma, platelets and whole blood combined">
          {groupBars.length ? <BarChart data={groupBars} unit="units" /> : <Empty>No stock recorded.</Empty>}
          <div className="sep" />
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Group</th><th className="num">Total</th><th className="num">PRBC</th><th className="num">FFP</th><th className="num">PLT</th><th className="num">Exp 7d</th></tr>
              </thead>
              <tbody>
                {data.byGroup.map((g) => (
                  <tr key={g.group}>
                    <td><GroupChip group={g.group} /></td>
                    <td className="num">{g.total}</td>
                    <td className="num">{g.components.PRBC || 0}</td>
                    <td className="num">{g.components.FFP || 0}</td>
                    <td className="num">{g.components.PLT || 0}</td>
                    <td className="num">{g.expiringSoon ? <Badge tone="advisory">{g.expiringSoon}</Badge> : <span className="muted">0</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="stack">
          <Card title="Red cell demand" hint={fc?.fit?.ok ? fc.fit.method + ' (MAE ' + fc.fit.mae + ')' : 'Observed issue history'}>
            <LineChart history={data.issueTrend} forecast={fc?.fit?.forecast || []} />
            {fc?.projection && (
              <div className="kv" style={{ marginTop: 12 }}>
                <dt>Starting stock</dt><dd>{fc.projection.startingStock} units</dd>
                <dt>Smoothed demand</dt><dd>{fc.projection.dailyRate ?? '-'} units/day</dd>
                <dt>Projected stockout</dt>
                <dd>{fc.projection.stockoutDate ? fmtDate(fc.projection.stockoutDate) : 'Not within the horizon'}</dd>
                <dt>Likely to expire unused</dt><dd>{fc.projection.projectedWastage} units</dd>
              </div>
            )}
            <p className="tiny muted" style={{ marginTop: 10, marginBottom: 0 }}>
              A planning aid computed from recent issues. It is not a guarantee of availability.
            </p>
          </Card>

          <Card title="Most frequent review flags" hint="Across all stored assessments">
            {data.topFlags.length ? (
              <div className="stack" style={{ gap: 7 }}>
                {data.topFlags.map((f) => (
                  <div key={f.id} className="spread" style={{ gap: 8 }}>
                    <span className="small">{f.title}</span>
                    <span className="row" style={{ gap: 7 }}>
                      <SeverityBadge severity={f.severity} />
                      <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{f.count}</strong>
                    </span>
                  </div>
                ))}
              </div>
            ) : <Empty>No assessments recorded yet.</Empty>}
          </Card>
        </div>
      </div>

      <div className="grid cols-2">
        <Card title="Open blood requests" action={<Link to="/requests"><button className="sm">View all</button></Link>}>
          {data.openRequests.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Request</th><th>Patient</th><th>Need</th><th>Urgency</th><th>Status</th></tr></thead>
                <tbody>
                  {data.openRequests.map((r) => (
                    <tr key={r.id}>
                      <td><Link to={'/requests/' + r.id} className="mono">{r.request_code}</Link></td>
                      <td>{r.patient_name}<div className="tiny muted">{r.mrn}</div></td>
                      <td>{r.units_requested} x {r.component} <GroupChip group={r.blood_group} /></td>
                      <td><Badge tone={URGENCY_TONE[r.urgency]}>{r.urgency}</Badge></td>
                      <td><Badge tone={r.status === 'pending' ? 'advisory' : 'info'}>{r.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>No open requests.</Empty>}
        </Card>

        <Card title="Recent assessments" action={<Link to="/assessments"><button className="sm">View all</button></Link>}>
          {data.recentAssessments.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>When</th><th>Patient</th><th className="num">Hb</th><th>Review status</th></tr></thead>
                <tbody>
                  {data.recentAssessments.map((a) => (
                    <tr key={a.id}>
                      <td className="tiny muted">{fmtDateTime(a.created_at)}</td>
                      <td><Link to={'/assessments/' + a.id}>{a.patient_name}</Link><div className="tiny muted">{a.clinical_context}</div></td>
                      <td className="num">{a.hb_g_dl ?? <span className="muted">n/r</span>}</td>
                      <td><Badge tone={statusTone(a.review_status)}>{a.review_status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>No assessments yet.</Empty>}
        </Card>
      </div>
    </div>
  );
}
