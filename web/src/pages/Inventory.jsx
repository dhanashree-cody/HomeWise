import { useState } from 'react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/useApi.js';
import { useAuth } from '../lib/auth.jsx';
import { Badge, Card, Empty, ErrorBox, Field, GroupChip, Loading, Notice, Stat } from '../components/ui.jsx';
import { BarChart, LineChart } from '../components/charts.jsx';

const STATUS_TONE = {
  available: 'ok', reserved: 'info', issued: 'neutral',
  quarantined: 'advisory', discarded: 'high', expired: 'high',
};

function ExpiryCell({ days }) {
  if (days < 0) return <Badge tone="high">expired</Badge>;
  if (days <= 3) return <Badge tone="high">{days}d</Badge>;
  if (days <= 7) return <Badge tone="advisory">{days}d</Badge>;
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{days}d</span>;
}

function AddUnits({ meta, onDone }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ component: 'PRBC', blood_group: 'O+', collected_on: today, quantity: 1, storage_loc: 'Main store' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.post('/inventory/units', { ...form, quantity: Number(form.quantity) });
      onDone();
    } catch (e2) { setErr(e2); } finally { setBusy(false); }
  };

  return (
    <Card title="Add stock" hint="For transfers in or stock correction. Donations are recorded on the donor page.">
      <form onSubmit={submit}>
        <div className="grid cols-4">
          <Field label="Component">
            <select value={form.component} onChange={(e) => set('component', e.target.value)}>
              {Object.entries(meta?.components || {}).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="Group">
            <select value={form.blood_group} onChange={(e) => set('blood_group', e.target.value)}>
              {(meta?.bloodGroups || []).map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>
          <Field label="Collected on">
            <input type="date" max={today} value={form.collected_on} onChange={(e) => set('collected_on', e.target.value)} />
          </Field>
          <Field label="Quantity">
            <input type="number" min="1" max="50" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} />
          </Field>
        </div>
        <p className="tiny muted" style={{ marginTop: -4 }}>
          Expiry is derived from the component shelf life
          ({meta?.components?.[form.component]?.shelfLifeDays} days for {meta?.components?.[form.component]?.label}),
          never entered by hand.
        </p>
        {err && <ErrorBox error={err} />}
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="primary" type="submit" disabled={busy}>{busy ? 'Adding...' : 'Add to inventory'}</button>
        </div>
      </form>
    </Card>
  );
}

export default function Inventory() {
  const { can } = useAuth();
  const [tab, setTab] = useState('overview');
  const [filters, setFilters] = useState({ status: 'available', component: '', group: '' });
  const [component, setComponent] = useState('PRBC');
  const [showAdd, setShowAdd] = useState(false);
  const [actionErr, setActionErr] = useState(null);

  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const { data: summary, loading, error, reload: reloadSummary } = useApi('/inventory/summary');
  const { data: unitsData, reload: reloadUnits } = useApi('/inventory/units?' + qs, [qs]);
  const { data: fc } = useApi('/inventory/forecast?component=' + component + '&horizon=14', [component]);
  const { data: meta } = useApi('/inventory/meta');

  const reload = () => { reloadSummary(); reloadUnits(); setShowAdd(false); };

  const discard = async (u) => {
    const reason = window.prompt('Reason for discarding ' + u.unit_code + ':');
    if (!reason) return;
    setActionErr(null);
    try { await api.post('/inventory/units/' + u.id + '/discard', { reason }); reload(); }
    catch (e) { setActionErr(e); }
  };

  if (loading) return <Loading what="inventory" />;
  if (error) return <ErrorBox error={error} />;

  const groupBars = summary.byGroup.map((g) => ({ label: g.group, value: g.total }));
  const componentBars = Object.entries(summary.byComponent)
    .map(([k, v]) => ({ label: meta?.components?.[k]?.label || k, value: v }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="stack">
      <div className="pill-tabs">
        {[['overview', 'Overview'], ['units', 'Units'], ['forecast', 'Demand and wastage']].map(([k, t]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t}</button>
        ))}
      </div>

      {actionErr && <ErrorBox error={actionErr} />}

      {tab === 'overview' && (
        <>
          <div className="grid cols-4">
            <Card><Stat label="Available" value={summary.totalAvailable} note="ready to issue" /></Card>
            <Card><Stat label="Quarantined" value={summary.statusCounts.quarantined || 0} note="awaiting screening" /></Card>
            <Card><Stat label="Expiring 3 days" value={summary.expiring.critical.length} note="rotate first" /></Card>
            <Card><Stat label="Expiring 7 days" value={summary.expiring.soon.length} note="plan allocation" /></Card>
          </div>

          {summary.expiring.critical.length > 0 && (
            <Notice level="critical">
              <strong>Units at immediate risk of discard.</strong>{' '}
              {summary.expiring.critical.map((u) => u.unit_code + ' (' + u.blood_group + ' ' + u.component + ', ' + u.daysToExpiry + 'd)').join(', ')}
            </Notice>
          )}

          <div className="grid cols-2">
            <Card title="Available units by blood group">
              {groupBars.length ? <BarChart data={groupBars} unit="units" /> : <Empty />}
            </Card>
            <Card title="Available units by component">
              {componentBars.length ? <BarChart data={componentBars} unit="units" /> : <Empty />}
            </Card>
          </div>

          <Card title="Stock matrix" hint="Group against component">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Group</th>
                    {Object.entries(meta?.components || {}).map(([k, v]) => <th key={k} className="num">{v.label}</th>)}
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(summary.matrix).map(([g, row]) => {
                    const total = Object.values(row).reduce((s, n) => s + n, 0);
                    return (
                      <tr key={g}>
                        <td><GroupChip group={g} /></td>
                        {Object.keys(meta?.components || {}).map((k) => (
                          <td key={k} className="num">
                            {row[k] ? row[k] : <span className="muted">0</span>}
                          </td>
                        ))}
                        <td className="num"><strong>{total}</strong></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {tab === 'units' && (
        <>
          {showAdd && <AddUnits meta={meta} onDone={reload} />}
          <Card
            title="Unit register"
            hint={(unitsData?.total ?? 0) + ' unit(s) shown'}
            action={can('bloodbank') && !showAdd ? <button className="primary sm" onClick={() => setShowAdd(true)}>Add stock</button> : null}
          >
            <div className="toolbar">
              <Field label="Status">
                <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                  <option value="">All</option>
                  {['available', 'reserved', 'issued', 'quarantined', 'discarded', 'expired'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Component">
                <select value={filters.component} onChange={(e) => setFilters({ ...filters, component: e.target.value })}>
                  <option value="">All</option>
                  {Object.entries(meta?.components || {}).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </Field>
              <Field label="Group">
                <select value={filters.group} onChange={(e) => setFilters({ ...filters, group: e.target.value })}>
                  <option value="">All</option>
                  {(meta?.bloodGroups || []).map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </Field>
            </div>

            {!unitsData?.units?.length ? <Empty>No units match these filters.</Empty> : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Unit</th><th>Component</th><th>Group</th><th>Collected</th>
                      <th>Expires</th><th className="num">Left</th><th>Status</th><th>Location</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {unitsData.units.map((u) => (
                      <tr key={u.id}>
                        <td className="mono">{u.unit_code}</td>
                        <td className="small">{u.componentLabel}</td>
                        <td><GroupChip group={u.blood_group} /></td>
                        <td className="tiny muted nowrap">{u.collected_on}</td>
                        <td className="tiny nowrap">{u.expires_on}</td>
                        <td className="num"><ExpiryCell days={u.daysToExpiry} /></td>
                        <td><Badge tone={STATUS_TONE[u.status] || 'neutral'}>{u.status}</Badge></td>
                        <td className="tiny muted">{u.storage_loc || '-'}</td>
                        <td style={{ textAlign: 'right' }}>
                          {can('bloodbank') && u.status !== 'issued' && u.status !== 'discarded' && (
                            <button className="sm danger" onClick={() => discard(u)}>Discard</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {tab === 'forecast' && (
        <>
          <Card
            title="Demand projection"
            hint={fc?.fit?.ok ? fc.fit.method : 'Insufficient history'}
            action={
              <select value={component} onChange={(e) => setComponent(e.target.value)} style={{ width: 'auto' }}>
                {Object.entries(meta?.components || {}).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            }
          >
            {fc?.fit?.ok ? (
              <>
                <LineChart history={fc.fit.history} forecast={fc.fit.forecast} />
                <div className="grid cols-4" style={{ marginTop: 14 }}>
                  <Stat label="Smoothed level" value={fc.fit.level} note="units/day" />
                  <Stat label="Trend" value={fc.fit.trend > 0 ? '+' + fc.fit.trend : fc.fit.trend} note="units/day change" />
                  <Stat label="Mean abs. error" value={fc.fit.mae} note="one-step-ahead fit" />
                  <Stat label="Smoothing" value={'a=' + fc.fit.params.alpha + ' b=' + fc.fit.params.beta} note="Holt constants" />
                </div>
                <p className="tiny muted" style={{ marginTop: 12, marginBottom: 0 }}>
                  Exponential smoothing is used rather than a neural forecaster because this volume of
                  history cannot support one, and because every figure above can be recomputed by hand
                  from the series and the two constants.
                </p>
              </>
            ) : <Notice level="info">{fc?.fit?.reason || 'Loading...'}</Notice>}
          </Card>

          {fc?.projection && (
            <Card title="Stock projection and wastage risk" hint={'Next ' + fc.projection.timeline.length + ' days'}>
              <div className="grid cols-4">
                <Stat label="Starting stock" value={fc.projection.startingStock} note="units available" />
                <Stat label="Daily demand" value={fc.projection.dailyRate ?? '-'} note="smoothed" />
                <Stat label="Projected stockout" value={fc.projection.stockoutDate ? fc.projection.stockoutDate.slice(5) : 'None'} note="within horizon" />
                <Stat label="Likely wastage" value={fc.projection.projectedWastage} note="expire before use" />
              </div>
              <div className="sep" />
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Date</th><th className="num">Projected stock</th><th className="num">Expiring that day</th></tr></thead>
                  <tbody>
                    {fc.projection.timeline.map((t) => (
                      <tr key={t.date}>
                        <td className="small">{t.date}</td>
                        <td className="num">{t.projectedStock}</td>
                        <td className="num">{t.expiring ? <Badge tone="advisory">{t.expiring}</Badge> : <span className="muted">0</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="tiny muted" style={{ marginTop: 10, marginBottom: 0 }}>{fc.projection.note}</p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
