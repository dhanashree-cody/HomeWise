import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApi, fmtDate } from '../lib/useApi.js';
import { useAuth } from '../lib/auth.jsx';
import { Badge, Card, Empty, ErrorBox, Field, GroupChip, Loading, Notice } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';

const BLANK = { full_name: '', age: '', sex: 'M', blood_group: 'O+', weight_kg: '', phone: '', last_donated_on: '' };

function PendingScreening({ onDone }) {
  const { data, loading, reload } = useApi('/donors/donations/pending');
  const [err, setErr] = useState(null);

  const record = async (d, outcome) => {
    const reason = outcome === 'failed' ? window.prompt('Reason for the failed screening:') : null;
    if (outcome === 'failed' && !reason) return;
    setErr(null);
    try {
      await api.post('/donors/donations/' + d.id + '/screening', { outcome, reason });
      reload(); onDone?.();
    } catch (e) { setErr(e); }
  };

  if (loading) return null;
  if (!data?.donations?.length) return null;

  return (
    <Card title={'Awaiting screening (' + data.donations.length + ')'} hint="Units stay quarantined until screening is recorded">
      <Notice level="warning">
        Components from these donations are quarantined and cannot be reserved or issued. Recording a
        pass releases them to the shelf; recording a fail discards them with the reason.
      </Notice>
      {err && <ErrorBox error={err} />}
      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table>
          <thead><tr><th>Donor</th><th>Group</th><th>Donated</th><th className="num">Hb</th><th className="num">Units</th><th></th></tr></thead>
          <tbody>
            {data.donations.map((d) => (
              <tr key={d.id}>
                <td><Link to={'/donors/' + d.donor_id}>{d.full_name}</Link><div className="tiny muted mono">{d.donor_code}</div></td>
                <td><GroupChip group={d.blood_group} /></td>
                <td className="small">{fmtDate(d.donated_on)}</td>
                <td className="num">{d.hb_g_dl}</td>
                <td className="num">{d.unit_count}</td>
                <td style={{ textAlign: 'right' }}>
                  <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
                    <button className="sm" onClick={() => record(d, 'passed')}>Pass</button>
                    <button className="sm danger" onClick={() => record(d, 'failed')}>Fail</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function Donors() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const { data, loading, error, reload } = useApi('/donors?q=' + encodeURIComponent(q), [q]);
  const { data: meta } = useApi('/inventory/meta');
  const { data: criteria } = useApi('/donors/criteria');
  const [form, setForm] = useState(BLANK);
  const [adding, setAdding] = useState(false);
  const [saveErr, setSaveErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setSaveErr(null);
    try {
      await api.post('/donors', { ...form, age: Number(form.age), weight_kg: Number(form.weight_kg) || null });
      setForm(BLANK); setAdding(false); reload();
    } catch (err) { setSaveErr(err); } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      {can('bloodbank') && <PendingScreening onDone={reload} />}

      {adding && (
        <Card title="Register a donor" hint="Synthetic demonstration data only">
          <form onSubmit={submit}>
            <div className="grid cols-4">
              <Field label="Full name" error={saveErr?.details?.full_name}>
                <input value={form.full_name} onChange={(e) => set('full_name', e.target.value)} required />
              </Field>
              <Field label="Age" unit="years" error={saveErr?.details?.age}>
                <input type="number" min="16" max="100" value={form.age} onChange={(e) => set('age', e.target.value)} required />
              </Field>
              <Field label="Sex">
                <select value={form.sex} onChange={(e) => set('sex', e.target.value)}>
                  <option value="M">Male</option><option value="F">Female</option><option value="O">Other</option>
                </select>
              </Field>
              <Field label="Blood group">
                <select value={form.blood_group} onChange={(e) => set('blood_group', e.target.value)}>
                  {(meta?.bloodGroups || []).map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </Field>
              <Field label="Weight" unit="kg" error={saveErr?.details?.weight_kg}>
                <input type="number" step="0.5" value={form.weight_kg} onChange={(e) => set('weight_kg', e.target.value)} />
              </Field>
              <Field label="Phone">
                <input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
              </Field>
              <Field label="Last donated">
                <input type="date" value={form.last_donated_on} onChange={(e) => set('last_donated_on', e.target.value)} />
              </Field>
            </div>
            {saveErr && <ErrorBox error={saveErr} />}
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving...' : 'Register donor'}</button>
              <button type="button" onClick={() => { setAdding(false); setSaveErr(null); }}>Cancel</button>
            </div>
          </form>
        </Card>
      )}

      <Card
        title="Donor register"
        hint={criteria ? 'Eligibility: ' + criteria.criteria.map((c) => c.text).join('; ') : ''}
        action={
          <div className="row">
            <span className="search-field">
              <span className="glyph">{Icon.search({ width: 15, height: 15 })}</span>
              <input type="search" placeholder="Search name, code or group" value={q} onChange={(e) => setQ(e.target.value)} />
            </span>
            {can('bloodbank') && !adding && (
              <button className="primary sm" onClick={() => setAdding(true)}>
                {Icon.plus({ width: 14, height: 14 })} Add donor
              </button>
            )}
          </div>
        }
      >
        {loading ? <Loading what="donors" /> : error ? <ErrorBox error={error} /> :
          data.donors.length === 0 ? <Empty>No donors match that search.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Code</th><th>Name</th><th>Group</th><th className="num">Age</th><th className="num">Weight</th><th>Last donated</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {data.donors.map((d) => {
                  // The list view has no measured haemoglobin, so it reports only
                  // the blockers that can be known without one.
                  const hard = d.eligibility.checks.filter((c) => !c.pass && c.id !== 'HB');
                  return (
                    <tr key={d.id}>
                      <td className="mono tiny">{d.donor_code}</td>
                      <td><Link to={'/donors/' + d.id}>{d.full_name}</Link></td>
                      <td><GroupChip group={d.blood_group} /></td>
                      <td className="num">{d.age}</td>
                      <td className="num">{d.weight_kg ?? '-'}</td>
                      <td className="small muted">{d.last_donated_on ? fmtDate(d.last_donated_on) : 'never'}</td>
                      <td>
                        {hard.length === 0
                          ? <Badge tone="ok">screening pending</Badge>
                          : <Badge tone="high" title={hard.map((h) => h.reason).join('; ')}>{hard[0].id.toLowerCase()}</Badge>}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <Link to={'/donors/' + d.id}><button className="sm">Open</button></Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="tiny muted" style={{ marginTop: 10, marginBottom: 0 }}>
          &ldquo;Screening pending&rdquo; means nothing blocks this donor on record alone. Haemoglobin must
          still be measured on the day, on the donor page.
        </p>
      </Card>
    </div>
  );
}
