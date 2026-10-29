import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApi, titleCase } from '../lib/useApi.js';
import { Card, ErrorBox, Field, GroupChip, Loading, Notice, Badge } from '../components/ui.jsx';
import { FlagList, ReadinessPanel, ReviewStatusBanner } from '../components/clinical.jsx';

const BLANK = {
  patient_id: '', clinical_context: 'medical', hb_g_dl: '', heart_rate: '', systolic_bp: '',
  blood_group: '', component: 'PRBC', units_requested: 1, active_bleeding: false, prior_reaction: false,
};

export default function NewAssessment() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { data: meta } = useApi('/assessments/meta/contexts');
  const { data: patientData, loading: loadingPatients } = useApi('/patients');

  const [form, setForm] = useState({ ...BLANK, patient_id: params.get('patient') || '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const timer = useRef(null);

  const patients = patientData?.patients || [];
  const patient = useMemo(
    () => patients.find((p) => String(p.id) === String(form.patient_id)),
    [patients, form.patient_id],
  );

  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setSaved(null); };

  // When a patient is chosen, default the group to the one on their record.
  useEffect(() => {
    if (patient && !form.blood_group) set('blood_group', patient.blood_group || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient]);

  const payload = useMemo(() => {
    const p = { ...form };
    ['hb_g_dl', 'heart_rate', 'systolic_bp'].forEach((k) => { if (p[k] === '') p[k] = null; });
    p.patient_id = Number(p.patient_id);
    p.units_requested = Number(p.units_requested) || 1;
    return p;
  }, [form]);

  /**
   * Live preview. The point of the coupled screen is that flags and stock move
   * together as values are entered, so a shortage surfaces during the review
   * rather than after the request has been sent.
   */
  useEffect(() => {
    if (!form.patient_id) { setResult(null); return; }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api.post('/assessments/preview', payload)
        .then((d) => { setResult(d); setError(null); })
        .catch((e) => { setError(e); setResult(null); });
    }, 280);
    return () => clearTimeout(timer.current);
  }, [payload, form.patient_id]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const d = await api.post('/assessments', payload);
      setSaved(d.assessment);
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  const raiseRequest = async () => {
    if (!saved) return;
    setSaving(true);
    try {
      const d = await api.post('/requests', {
        patient_id: saved.patient_id,
        assessment_id: saved.id,
        component: saved.component,
        blood_group: saved.blood_group,
        units_requested: saved.units_requested,
        urgency: saved.review_status?.startsWith('Priority') ? 'urgent' : 'routine',
        note: 'Raised from assessment #' + saved.id,
      });
      nav('/requests/' + d.request.id);
    } catch (e) {
      setError(e);
      setSaving(false);
    }
  };

  if (loadingPatients) return <Loading what="patients" />;

  const fieldErr = (k) => (error?.status === 400 && error.details?.[k]) || null;

  return (
    <div className="grid split">
      <div className="stack">
        <Card title="Patient and clinical context" hint="Synthetic data only">
          <Field label="Patient" error={fieldErr('patient_id')}>
            <select value={form.patient_id} onChange={(e) => set('patient_id', e.target.value)}>
              <option value="">Select a patient...</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.mrn} &mdash; {p.full_name}, {p.age}{p.sex} {p.blood_group ? '(' + p.blood_group + ')' : '(group not recorded)'}
                </option>
              ))}
            </select>
          </Field>

          {patient && (
            <div className="row" style={{ marginBottom: 12, gap: 8 }}>
              <GroupChip group={patient.blood_group} />
              <span className="small">{patient.full_name}, {patient.age} {patient.sex}</span>
              <span className="tiny muted">{patient.ward}</span>
              {!patient.blood_group && <Badge tone="data">no group on record</Badge>}
            </div>
          )}

          <Field label="Clinical context">
            <select value={form.clinical_context} onChange={(e) => set('clinical_context', e.target.value)}>
              {(meta?.contexts || []).map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
            </select>
          </Field>

          <div className="grid cols-3">
            <Field label="Haemoglobin" unit="g/dL" error={fieldErr('hb_g_dl')}>
              <input type="number" step="0.1" min="0" max="30" value={form.hb_g_dl}
                onChange={(e) => set('hb_g_dl', e.target.value)} placeholder="not recorded" />
            </Field>
            <Field label="Heart rate" unit="bpm" error={fieldErr('heart_rate')}>
              <input type="number" min="0" max="300" value={form.heart_rate}
                onChange={(e) => set('heart_rate', e.target.value)} placeholder="not recorded" />
            </Field>
            <Field label="Systolic BP" unit="mmHg" error={fieldErr('systolic_bp')}>
              <input type="number" min="0" max="300" value={form.systolic_bp}
                onChange={(e) => set('systolic_bp', e.target.value)} placeholder="not recorded" />
            </Field>
          </div>
          <p className="tiny muted" style={{ marginTop: -4 }}>
            Leave a field blank if the value is genuinely unknown. A blank is treated as unanswered,
            never as normal.
          </p>

          <div className="sep" />

          <label className="check">
            <input type="checkbox" checked={form.active_bleeding} onChange={(e) => set('active_bleeding', e.target.checked)} />
            <span>Active bleeding reported</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={form.prior_reaction} onChange={(e) => set('prior_reaction', e.target.checked)} />
            <span>Previous transfusion reaction reported</span>
          </label>
        </Card>

        <Card title="Component under discussion" hint="Drives the stock view on the right">
          <div className="grid cols-3">
            <Field label="Component">
              <select value={form.component} onChange={(e) => set('component', e.target.value)}>
                {Object.entries(meta?.components || {}).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Recipient group">
              <select value={form.blood_group} onChange={(e) => set('blood_group', e.target.value)}>
                <option value="">Not recorded</option>
                {(meta?.bloodGroups || []).map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </Field>
            <Field label="Units">
              <input type="number" min="1" max="20" value={form.units_requested}
                onChange={(e) => set('units_requested', e.target.value)} />
            </Field>
          </div>

          {error && <ErrorBox error={error} />}

          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="primary" onClick={save} disabled={!result || saving || !!saved}>
              {saved ? 'Assessment saved' : saving ? 'Saving...' : 'Save assessment'}
            </button>
            {saved && (
              <>
                <button onClick={() => nav('/assessments/' + saved.id)}>Open record</button>
                <button onClick={raiseRequest} disabled={saving || !saved.blood_group}>Raise blood request</button>
              </>
            )}
            <button onClick={() => { setForm(BLANK); setResult(null); setSaved(null); setError(null); }}>Clear</button>
          </div>
          {saved && (
            <p className="tiny muted" style={{ marginTop: 8, marginBottom: 0 }}>
              Saved as assessment #{saved.id} under rule set {saved.ruleSet?.version}. The stored record
              keeps this rule version permanently, even if the active version changes later.
            </p>
          )}
        </Card>
      </div>

      <div className="stack">
        {!form.patient_id && (
          <Card>
            <div className="empty">Select a patient to begin. Flags and stock update as you type.</div>
          </Card>
        )}

        {result && (
          <>
            <Card
              title="Review flags"
              hint={'Rule set ' + result.ruleSet.version}
              action={<Badge tone="neutral">{result.flags.length} flag(s)</Badge>}
            >
              <ReviewStatusBanner status={result.reviewStatus} flags={result.flags} />
              <div style={{ marginTop: 12 }}>
                <FlagList flags={result.flags} />
              </div>
              {result.notEvaluated?.length > 0 && (
                <p className="tiny muted" style={{ marginTop: 10, marginBottom: 0 }}>
                  {result.notEvaluated.length} rule(s) could not be evaluated because required values
                  were not supplied. They are reported as unanswered, not as negative findings.
                </p>
              )}
            </Card>

            <ReadinessPanel readiness={result.readiness} />
          </>
        )}
      </div>
    </div>
  );
}
