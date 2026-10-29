import { useState } from 'react';
import { api } from '../lib/api.js';
import { useApi, fmtDate } from '../lib/useApi.js';
import { useAuth } from '../lib/auth.jsx';
import { Badge, Card, Empty, ErrorBox, Field, GroupChip, Loading, Notice } from '../components/ui.jsx';

const STATUS_TONE = { planned: 'info', active: 'ok', completed: 'neutral', cancelled: 'data' };
const URGENCY_TONE = { high: 'high', medium: 'advisory', low: 'ok', unknown: 'data' };

const BLANK = { name: '', location: '', scheduled_on: '', target_units: 50, organiser: '' };

export default function Camps() {
  const { can } = useAuth();
  const { data, loading, error, reload } = useApi('/camps');
  const { data: priority } = useApi('/camps/collection-priority');
  const [form, setForm] = useState(BLANK);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.post('/camps', { ...form, target_units: Number(form.target_units) });
      setForm(BLANK); setAdding(false); reload();
    } catch (e2) { setErr(e2); } finally { setBusy(false); }
  };

  const setStatus = async (camp, status) => {
    setErr(null);
    try { await api.patch('/camps/' + camp.id + '/status', { status }); reload(); }
    catch (e) { setErr(e); }
  };

  if (loading) return <Loading what="camps" />;
  if (error) return <ErrorBox error={error} />;

  const urgent = (priority?.priority || []).filter((p) => p.urgency === 'high');

  return (
    <div className="grid split">
      <div className="stack">
        {adding && (
          <Card title="Schedule a camp">
            <form onSubmit={submit}>
              <div className="grid cols-2">
                <Field label="Camp name" error={err?.details?.name}>
                  <input value={form.name} onChange={(e) => set('name', e.target.value)} required />
                </Field>
                <Field label="Location" error={err?.details?.location}>
                  <input value={form.location} onChange={(e) => set('location', e.target.value)} required />
                </Field>
                <Field label="Scheduled on" error={err?.details?.scheduled_on}>
                  <input type="date" value={form.scheduled_on} onChange={(e) => set('scheduled_on', e.target.value)} required />
                </Field>
                <Field label="Target units">
                  <input type="number" min="0" value={form.target_units} onChange={(e) => set('target_units', e.target.value)} />
                </Field>
                <Field label="Organiser">
                  <input value={form.organiser} onChange={(e) => set('organiser', e.target.value)} />
                </Field>
              </div>
              {err && <ErrorBox error={err} />}
              <div className="btn-row" style={{ marginTop: 10 }}>
                <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving...' : 'Schedule camp'}</button>
                <button type="button" onClick={() => { setAdding(false); setErr(null); }}>Cancel</button>
              </div>
            </form>
          </Card>
        )}

        <Card
          title="Donation camps"
          action={can('bloodbank') && !adding ? <button className="primary sm" onClick={() => setAdding(true)}>Schedule camp</button> : null}
        >
          {data.camps.length === 0 ? <Empty>No camps scheduled.</Empty> : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Camp</th><th>Location</th><th>Date</th><th className="num">Target</th><th className="num">Recorded</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {data.camps.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}<div className="tiny muted">{c.organiser}</div></td>
                      <td className="small muted">{c.location}</td>
                      <td className="small">{fmtDate(c.scheduled_on)}</td>
                      <td className="num">{c.target_units}</td>
                      <td className="num">{c.donations_recorded}</td>
                      <td><Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge></td>
                      <td style={{ textAlign: 'right' }}>
                        {can('bloodbank') && c.status === 'planned' && (
                          <button className="sm" onClick={() => setStatus(c, 'active')}>Start</button>
                        )}
                        {can('bloodbank') && c.status === 'active' && (
                          <button className="sm" onClick={() => setStatus(c, 'completed')}>Complete</button>
                        )}
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
        <Card title="Collection priority by group" hint="Shortest days of cover first">
          {urgent.length > 0 && (
            <Notice level="warning">
              <strong>{urgent.map((u) => u.group).join(', ')}</strong> {urgent.length === 1 ? 'has' : 'have'} under
              three days of cover at the recent issue rate. Worth targeting at the next camp.
            </Notice>
          )}

          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table>
              <thead>
                <tr><th className="num">#</th><th>Group</th><th className="num">Stock</th><th className="num">Est. use/day</th><th className="num">Days cover</th><th>Priority</th></tr>
              </thead>
              <tbody>
                {(priority?.priority || []).map((p) => (
                  <tr key={p.group}>
                    <td className="muted num">{p.rank}</td>
                    <td><GroupChip group={p.group} /></td>
                    <td className="num">{p.stock}</td>
                    <td className="num">{p.estimatedDailyUse}</td>
                    <td className="num">{p.coverDays ?? '-'}</td>
                    <td><Badge tone={URGENCY_TONE[p.urgency]}>{p.urgency}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {priority && (
            <>
              <div className="sep" />
              <p className="tiny muted" style={{ marginBottom: 4 }}><strong>Method.</strong> {priority.method}</p>
              <p className="tiny muted" style={{ marginBottom: 0 }}>{priority.note}</p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
