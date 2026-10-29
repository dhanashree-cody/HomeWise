import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApi, fmtDate } from '../lib/useApi.js';
import { useAuth } from '../lib/auth.jsx';
import { Badge, Card, Empty, ErrorBox, Field, GroupChip, Loading, Notice } from '../components/ui.jsx';

const today = () => new Date().toISOString().slice(0, 10);

function EligibilityList({ result }) {
  if (!result) return null;
  return (
    <>
      <Notice level={result.eligible ? 'ok' : 'critical'}>
        <strong>{result.eligible ? 'Meets the demonstration screening criteria' : 'Does not meet the screening criteria'}</strong>
        {!result.eligible && <div className="tiny" style={{ marginTop: 3 }}>{result.blockers.join(' · ')}</div>}
      </Notice>
      <div style={{ marginTop: 10 }}>
        {result.checks.map((c) => (
          <div key={c.id} className="spread small" style={{ padding: '5px 0', borderBottom: '1px solid var(--grid)' }}>
            <span>{c.reason}</span>
            <Badge tone={c.pass ? 'ok' : 'high'}>{c.pass ? 'pass' : 'fail'}</Badge>
          </div>
        ))}
      </div>
      <p className="tiny muted" style={{ marginTop: 10, marginBottom: 0 }}>{result.note}</p>
    </>
  );
}

function RecordDonation({ donor, camps, onDone }) {
  const [form, setForm] = useState({ donated_on: today(), hb_g_dl: '', camp_id: '', components: ['PRBC', 'FFP'] });
  const [screen, setScreen] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [override, setOverride] = useState('');

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = (c) => set('components', form.components.includes(c)
    ? form.components.filter((x) => x !== c)
    : [...form.components, c]);

  const runScreen = async () => {
    setErr(null);
    try {
      const d = await api.post('/donors/' + donor.id + '/screen', { hb_g_dl: Number(form.hb_g_dl) });
      setScreen(d.eligibility);
    } catch (e) { setErr(e); }
  };

  const donate = async () => {
    setBusy(true); setErr(null);
    try {
      await api.post('/donors/' + donor.id + '/donate', {
        donated_on: form.donated_on,
        hb_g_dl: Number(form.hb_g_dl),
        camp_id: form.camp_id || null,
        components: form.components.join(','),
        override_reason: override || null,
      });
      onDone();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  const blocked = err?.status === 409;

  return (
    <Card title="Record a donation" hint="Creates quarantined units linked to this donor">
      <div className="grid cols-3">
        <Field label="Donation date">
          <input type="date" max={today()} value={form.donated_on} onChange={(e) => { set('donated_on', e.target.value); setScreen(null); }} />
        </Field>
        <Field label="Pre-donation Hb" unit="g/dL">
          <input type="number" step="0.1" value={form.hb_g_dl} onChange={(e) => { set('hb_g_dl', e.target.value); setScreen(null); }} placeholder="measure on the day" />
        </Field>
        <Field label="Camp (optional)">
          <select value={form.camp_id} onChange={(e) => set('camp_id', e.target.value)}>
            <option value="">Walk-in at centre</option>
            {(camps || []).map((c) => <option key={c.id} value={c.id}>{c.name} &mdash; {fmtDate(c.scheduled_on)}</option>)}
          </select>
        </Field>
      </div>

      <div className="small" style={{ fontWeight: 600, marginBottom: 5 }}>Components to prepare</div>
      <div className="row" style={{ gap: 14, marginBottom: 12 }}>
        {[['PRBC', 'Packed red cells'], ['FFP', 'Plasma'], ['PLT', 'Platelets']].map(([k, t]) => (
          <label className="check" key={k} style={{ padding: 0 }}>
            <input type="checkbox" checked={form.components.includes(k)} onChange={() => toggle(k)} />
            <span>{t}</span>
          </label>
        ))}
      </div>

      <div className="btn-row">
        <button onClick={runScreen} disabled={!form.hb_g_dl}>Run eligibility screen</button>
        <button className="primary" onClick={donate} disabled={busy || !form.hb_g_dl || !form.components.length}>
          {busy ? 'Recording...' : 'Record donation'}
        </button>
      </div>

      {screen && <div style={{ marginTop: 12 }}><EligibilityList result={screen} /></div>}

      {err && (
        <div style={{ marginTop: 12 }}>
          <ErrorBox error={err} />
          {blocked && (
            <div style={{ marginTop: 10 }}>
              <Field label="Override reason (recorded in the audit ledger)">
                <input value={override} onChange={(e) => setOverride(e.target.value)}
                  placeholder="e.g. medical officer reviewed and accepted" />
              </Field>
              <button className="danger" onClick={donate} disabled={!override || busy}>
                Record anyway with override
              </button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export default function DonorDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data, loading, error, reload } = useApi('/donors/' + id);
  const { data: campData } = useApi('/camps');
  const [deferErr, setDeferErr] = useState(null);

  if (loading) return <Loading what="donor" />;
  if (error) return <ErrorBox error={error} />;

  const { donor: d, donations, units, eligibility } = data;

  const defer = async () => {
    const reason = window.prompt('Reason for deferral:');
    if (!reason) return;
    const until = window.prompt('Deferred until (YYYY-MM-DD):');
    if (!until) return;
    setDeferErr(null);
    try { await api.post('/donors/' + d.id + '/defer', { deferred_until: until, deferral_reason: reason }); reload(); }
    catch (e) { setDeferErr(e); }
  };

  return (
    <div className="grid split">
      <div className="stack">
        <Card
          title={d.full_name}
          hint={d.donor_code}
          action={can('bloodbank') ? <button className="sm" onClick={defer}>Record deferral</button> : null}
        >
          <div className="grid cols-4">
            <dl className="kv"><dt>Group</dt><dd><GroupChip group={d.blood_group} /></dd></dl>
            <dl className="kv"><dt>Age / sex</dt><dd>{d.age} {d.sex}</dd></dl>
            <dl className="kv"><dt>Weight</dt><dd>{d.weight_kg ? d.weight_kg + ' kg' : '-'}</dd></dl>
            <dl className="kv"><dt>Phone</dt><dd className="small">{d.phone || '-'}</dd></dl>
          </div>
          {d.deferred_until && (
            <div style={{ marginTop: 10 }}>
              <Notice level="warning">
                Deferred until {fmtDate(d.deferred_until)}{d.deferral_reason ? ' - ' + d.deferral_reason : ''}.
              </Notice>
            </div>
          )}
          {deferErr && <ErrorBox error={deferErr} />}
        </Card>

        {can('bloodbank') && <RecordDonation donor={d} camps={campData?.camps} onDone={reload} />}

        <Card title={'Donation history (' + donations.length + ')'}>
          {donations.length === 0 ? <Empty>No donations recorded.</Empty> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th className="num">Hb</th><th className="num">Volume</th><th>Camp</th><th>Screening</th></tr></thead>
                <tbody>
                  {donations.map((x) => (
                    <tr key={x.id}>
                      <td className="small">{fmtDate(x.donated_on)}</td>
                      <td className="num">{x.hb_g_dl}</td>
                      <td className="num">{x.volume_ml} mL</td>
                      <td className="tiny muted">{x.camp_name || 'Walk-in'}</td>
                      <td>
                        <Badge tone={x.screening === 'passed' ? 'ok' : x.screening === 'failed' ? 'high' : 'advisory'}>
                          {x.screening}
                        </Badge>
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
        <Card title="Eligibility on record" hint="Haemoglobin is measured on the day, so it shows as unanswered here">
          <EligibilityList result={eligibility} />
        </Card>

        <Card title={'Units produced (' + units.length + ')'} hint="Where this donor's blood ended up">
          {units.length === 0 ? <Empty>No units produced.</Empty> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Unit</th><th>Component</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {units.map((u) => (
                    <tr key={u.id}>
                      <td className="mono tiny">{u.unit_code}</td>
                      <td className="small">{u.component}</td>
                      <td><Badge tone={u.status === 'issued' ? 'ok' : u.status === 'available' ? 'info' : 'neutral'}>{u.status}</Badge></td>
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
    </div>
  );
}
