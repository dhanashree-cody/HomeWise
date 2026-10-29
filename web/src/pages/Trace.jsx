import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { fmtDate, fmtDateTime } from '../lib/useApi.js';
import { Badge, Card, Empty, ErrorBox, GroupChip, Notice } from '../components/ui.jsx';

function Step({ title, children, last }) {
  return (
    <div className="chain-step">
      <div className="chain-rail">
        <div className="chain-dot" />
        {!last && <div className="chain-line" />}
      </div>
      <div className="chain-body">
        <div className="small" style={{ fontWeight: 650, marginBottom: 2 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

export default function Trace() {
  const [params, setParams] = useSearchParams();
  const [code, setCode] = useState(params.get('unit') || '');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const lookup = async (c) => {
    if (!c) return;
    setBusy(true); setError(null); setData(null);
    try { setData(await api.get('/requests/trace/' + encodeURIComponent(c.trim()))); }
    catch (e) { setError(e); } finally { setBusy(false); }
  };

  useEffect(() => {
    const u = params.get('unit');
    if (u) { setCode(u); lookup(u); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('unit')]);

  const submit = (e) => {
    e.preventDefault();
    setParams(code ? { unit: code.trim() } : {});
    lookup(code);
  };

  const chain = data?.chain;

  return (
    <div className="grid split">
      <div className="stack">
        <Card title="Trace a unit" hint="Enter a unit code, for example U-000042">
          <form onSubmit={submit} className="row">
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="U-000001" style={{ maxWidth: 220 }} />
            <button className="primary" type="submit" disabled={busy || !code}>{busy ? 'Looking up...' : 'Trace'}</button>
          </form>
          <p className="tiny muted" style={{ marginTop: 10, marginBottom: 0 }}>
            Traceability runs both ways: from a transfused unit back to the donation it came from, and
            from a donation forward to where each component went.
          </p>
        </Card>

        {error && <ErrorBox error={error} />}

        {data && (
          <Card title={'Chain for ' + data.unit.unit_code}>
            <Step title="Donor">
              {chain.donor ? (
                <>
                  <div>{chain.donor.full_name} <GroupChip group={chain.donor.blood_group} /></div>
                  <div className="tiny muted mono">{chain.donor.donor_code} &middot; {chain.donor.age} {chain.donor.sex}</div>
                </>
              ) : <div className="tiny muted">No donor on record (unit added as a stock correction or transfer).</div>}
            </Step>

            <Step title="Collection">
              {chain.donation ? (
                <>
                  <div className="small">Donated {fmtDate(chain.donation.donated_on)}, {chain.donation.volume_ml} mL, Hb {chain.donation.hb_g_dl} g/dL</div>
                  <div className="tiny muted">
                    {chain.camp ? chain.camp.name + ' - ' + chain.camp.location : 'Walk-in at the centre'}
                    {' · screening '}
                    <Badge tone={chain.donation.screening === 'passed' ? 'ok' : chain.donation.screening === 'failed' ? 'high' : 'advisory'}>
                      {chain.donation.screening}
                    </Badge>
                  </div>
                </>
              ) : <div className="tiny muted">No donation record.</div>}
            </Step>

            <Step title="Component">
              <div className="small">{data.unit.component} &middot; {data.unit.volume_ml} mL &middot; <GroupChip group={data.unit.blood_group} /></div>
              <div className="tiny muted">
                Collected {data.unit.collected_on}, expires {data.unit.expires_on}
                {' '}({data.unit.daysToExpiry >= 0 ? data.unit.daysToExpiry + ' days left' : 'expired'})
                {' · '}{data.unit.storage_loc}
              </div>
              <div style={{ marginTop: 4 }}><Badge tone={data.unit.status === 'issued' ? 'ok' : 'info'}>{data.unit.status}</Badge></div>
              {data.unit.discard_reason && <div className="tiny" style={{ color: 'var(--critical)' }}>{data.unit.discard_reason}</div>}
            </Step>

            <Step title="Request">
              {chain.request ? (
                <>
                  <div className="small">
                    <Link to={'/requests/' + chain.request.id} className="mono">{chain.request.request_code}</Link>
                    {' '}&middot; {chain.request.units_requested} x {chain.request.component} &middot; {chain.request.urgency}
                  </div>
                  <div className="tiny muted">Status {chain.request.status}</div>
                </>
              ) : <div className="tiny muted">Not yet assigned to a request.</div>}
            </Step>

            <Step title="Patient" last>
              {chain.patient ? (
                <>
                  <div className="small">{chain.patient.full_name} <GroupChip group={chain.patient.blood_group} /></div>
                  <div className="tiny muted mono">{chain.patient.mrn} &middot; {chain.patient.ward}</div>
                  <div className="tiny muted">Issued {fmtDate(data.unit.issued_on)}</div>
                </>
              ) : <div className="tiny muted">Not issued to a patient.</div>}
            </Step>
          </Card>
        )}
      </div>

      <div className="stack">
        {data && (
          <Card title="Ledger entries for this unit" hint="From the hash-chained audit log">
            {data.events.length === 0 ? (
              <Empty>No ledger entries reference this unit directly.</Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>When</th><th>Actor</th><th>Action</th></tr></thead>
                  <tbody>
                    {data.events.map((e, i) => (
                      <tr key={i}>
                        <td className="tiny muted">{fmtDateTime(e.ts)}</td>
                        <td className="small">{e.actor_name}</td>
                        <td><Badge tone="neutral">{e.action}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
        {!data && !error && (
          <Card>
            <Notice level="info">
              Traceability is a safety requirement in transfusion practice: if a reaction or a screening
              problem comes to light later, the blood bank must be able to find every component from
              that donation and every patient who received one.
            </Notice>
          </Card>
        )}
      </div>
    </div>
  );
}
