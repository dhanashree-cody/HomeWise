import { useState } from 'react';
import { api } from '../lib/api.js';
import { useApi, fmtDateTime } from '../lib/useApi.js';
import { useAuth } from '../lib/auth.jsx';
import { Badge, Card, Empty, ErrorBox, Field, Loading, Notice } from '../components/ui.jsx';

export default function AuditLog() {
  const { can } = useAuth();
  const [entity, setEntity] = useState('');
  const { data, loading, error } = useApi('/audit?limit=200' + (entity ? '&entity=' + entity : ''), [entity]);
  const [verify, setVerify] = useState(null);
  const [busy, setBusy] = useState(false);
  const [vErr, setVErr] = useState(null);

  const runVerify = async () => {
    setBusy(true); setVErr(null);
    try { setVerify(await api.get('/audit/verify')); }
    catch (e) { setVErr(e); } finally { setBusy(false); }
  };

  if (loading) return <Loading what="audit ledger" />;
  if (error) return <ErrorBox error={error} />;

  const entities = [...new Set(data.entries.map((e) => e.entity))].sort();

  return (
    <div className="stack">
      <Notice level="info">
        Each entry commits to the hash of the entry before it. The base paper reaches for a blockchain
        to protect the supply chain; a full chain is disproportionate for one institution, but the
        property that matters &mdash; history cannot be silently rewritten &mdash; is kept by chaining the hashes.
      </Notice>

      <Card
        title="Chain integrity"
        action={can('bloodbank', 'admin') ? <button className="primary sm" onClick={runVerify} disabled={busy}>{busy ? 'Verifying...' : 'Verify chain'}</button> : null}
      >
        {vErr && <ErrorBox error={vErr} />}
        {verify ? (
          verify.ok ? (
            <Notice level="ok">
              <strong>Chain intact.</strong> {verify.checked} entries recomputed and matched.
              <div className="ledger" style={{ marginTop: 5 }}>head {verify.head}</div>
            </Notice>
          ) : (
            <Notice level="critical">
              <strong>Chain broken at entry {verify.brokenAt}.</strong> {verify.reason}
            </Notice>
          )
        ) : (
          <p className="small muted" style={{ marginBottom: 0 }}>
            {data.total} entries recorded. Run a verification to recompute every hash from the first
            entry forward.
          </p>
        )}
      </Card>

      <Card
        title="Ledger"
        hint={'Showing the ' + data.entries.length + ' most recent of ' + data.total}
        action={
          <Field label="Entity">
            <select value={entity} onChange={(e) => setEntity(e.target.value)}>
              <option value="">All</option>
              {entities.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </Field>
        }
      >
        {data.entries.length === 0 ? <Empty /> : (
          <div className="table-wrap scroll-y" style={{ maxHeight: 600 }}>
            <table>
              <thead>
                <tr><th>#</th><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Detail</th></tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.id}>
                    <td className="muted num">{e.id}</td>
                    <td className="tiny muted">{fmtDateTime(e.ts)}</td>
                    <td className="small">{e.actor}</td>
                    <td><Badge tone="neutral">{e.action}</Badge></td>
                    <td className="tiny muted">{e.entity}{e.entityId ? ' #' + e.entityId : ''}</td>
                    <td className="tiny muted" style={{ maxWidth: 340 }}>
                      {e.detail ? JSON.stringify(e.detail).slice(0, 160) : '-'}
                      <div className="ledger">{e.hash.slice(0, 24)}...</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Action summary">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Action</th><th className="num">Count</th></tr></thead>
            <tbody>
              {data.actions.map((a) => (
                <tr key={a.action}><td className="small">{a.action}</td><td className="num">{a.n}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
