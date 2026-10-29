import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { Card, ErrorBox, Field } from '../components/ui.jsx';

const DEMO = [
  ['dr.anand', 'clinician123', 'Clinician - reviews patients, raises requests'],
  ['bb.kumar', 'bloodbank123', 'Blood bank - manages stock, donors, issue'],
  ['admin', 'admin123', 'Admin - rule governance and audit'],
];

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState('dr.anand');
  const [password, setPassword] = useState('clinician123');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      nav('/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const useDemo = (u, p) => { setUsername(u); setPassword(p); setError(null); };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div
            className="brand-mark"
            style={{ width: 46, height: 46, fontSize: 21, borderRadius: 16, margin: '0 auto 14px' }}
            aria-hidden="true"
          >
            H
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 300, letterSpacing: '0.04em' }}>HemoWise</h1>
          <div className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.18em', marginTop: 6 }}>
            Transfusion support &amp; blood bank
          </div>
        </div>

        <Card>
          <form onSubmit={submit}>
            <Field label="Username">
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
            </Field>
            <Field label="Password">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </Field>
            {error && <div style={{ marginBottom: 12 }}><ErrorBox error={error} /></div>}
            <button className="primary" type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <div className="sep" />
          <div className="small" style={{ fontWeight: 600, marginBottom: 2 }}>Demonstration accounts</div>
          <div className="tiny muted">Select one to fill the form.</div>
          <table className="cred-table">
            <tbody>
              {DEMO.map(([u, p, desc]) => (
                <tr key={u}>
                  <td className="mono">{u}</td>
                  <td className="tiny muted">{desc}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="sm" onClick={() => useDemo(u, p)}>Use</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <p className="tiny muted" style={{ marginTop: 14, textAlign: 'center' }}>
          Academic prototype. All records are synthetic. Not for clinical use.
        </p>
      </div>
    </div>
  );
}
