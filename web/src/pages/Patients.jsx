import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApi } from '../lib/useApi.js';
import { useAuth } from '../lib/auth.jsx';
import { Badge, Card, Empty, ErrorBox, Field, GroupChip, Loading } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';

const BLANK = { full_name: '', age: '', sex: 'M', blood_group: '', ward: '', notes: '' };

export default function Patients() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const { data, loading, error, reload } = useApi('/patients?q=' + encodeURIComponent(q), [q]);
  const { data: meta } = useApi('/inventory/meta');
  const [form, setForm] = useState(BLANK);
  const [adding, setAdding] = useState(false);
  const [saveErr, setSaveErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setSaveErr(null);
    try {
      await api.post('/patients', { ...form, age: Number(form.age) });
      setForm(BLANK);
      setAdding(false);
      reload();
    } catch (err) {
      setSaveErr(err);
    } finally {
      setBusy(false);
    }
  };

  const fieldErr = (k) => saveErr?.details?.[k] || null;

  return (
    <div className="stack">
      {adding && (
        <Card title="Register a synthetic patient" hint="Demonstration data only - never enter real patient details">
          <form onSubmit={submit}>
            <div className="grid cols-3">
              <Field label="Full name" error={fieldErr('full_name')}>
                <input value={form.full_name} onChange={(e) => set('full_name', e.target.value)} required />
              </Field>
              <Field label="Age" unit="years" error={fieldErr('age')}>
                <input type="number" min="0" max="120" value={form.age} onChange={(e) => set('age', e.target.value)} required />
              </Field>
              <Field label="Sex">
                <select value={form.sex} onChange={(e) => set('sex', e.target.value)}>
                  <option value="M">Male</option><option value="F">Female</option><option value="O">Other</option>
                </select>
              </Field>
              <Field label="Blood group">
                <select value={form.blood_group} onChange={(e) => set('blood_group', e.target.value)}>
                  <option value="">Not yet grouped</option>
                  {(meta?.bloodGroups || []).map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </Field>
              <Field label="Ward">
                <input value={form.ward} onChange={(e) => set('ward', e.target.value)} />
              </Field>
              <Field label="Notes">
                <input value={form.notes} onChange={(e) => set('notes', e.target.value)} />
              </Field>
            </div>
            {saveErr && <ErrorBox error={saveErr} />}
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving...' : 'Register patient'}</button>
              <button type="button" onClick={() => { setAdding(false); setSaveErr(null); }}>Cancel</button>
            </div>
          </form>
        </Card>
      )}

      <Card
        title="Patient register"
        hint="All records are synthetic"
        action={
          <div className="row">
            <span className="search-field">
              <span className="glyph">{Icon.search({ width: 15, height: 15 })}</span>
              <input type="search" placeholder="Search name, MRN or ward" value={q} onChange={(e) => setQ(e.target.value)} />
            </span>
            {can('clinician') && !adding && (
              <button className="primary sm" onClick={() => setAdding(true)}>
                {Icon.plus({ width: 14, height: 14 })} Add patient
              </button>
            )}
          </div>
        }
      >
        {loading ? <Loading what="patients" /> : error ? <ErrorBox error={error} /> :
          data.patients.length === 0 ? <Empty>No patients match that search.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>MRN</th><th>Name</th><th className="num">Age</th><th>Sex</th><th>Group</th><th>Ward</th><th></th></tr>
              </thead>
              <tbody>
                {data.patients.map((p) => (
                  <tr key={p.id}>
                    <td className="mono tiny">{p.mrn}</td>
                    <td><Link to={'/patients/' + p.id}>{p.full_name}</Link></td>
                    <td className="num">{p.age}</td>
                    <td>{p.sex}</td>
                    <td>{p.blood_group ? <GroupChip group={p.blood_group} /> : <Badge tone="data">not grouped</Badge>}</td>
                    <td className="small muted">{p.ward || '-'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {can('clinician') && (
                        <Link to={'/assess?patient=' + p.id}><button className="sm">Assess</button></Link>
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
  );
}
