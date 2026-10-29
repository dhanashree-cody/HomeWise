import { useState } from 'react';
import { Icon } from './icons.jsx';
import { getTheme, setTheme } from '../lib/theme.js';

export function Card({ title, hint, action, children, className = '' }) {
  return (
    <section className={'card ' + className}>
      {(title || action) && (
        <header className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {hint && <div className="hint">{hint}</div>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

const SEVERITY_LABEL = {
  high: 'High',
  moderate: 'Moderate',
  advisory: 'Advisory',
  data: 'Data quality',
  info: 'Information',
};

/** Severity never travels as colour alone - the word is always present. */
export function SeverityBadge({ severity }) {
  return (
    <span className={'badge badge-' + severity}>
      <span className="dot" style={{ background: 'currentColor' }} />
      {SEVERITY_LABEL[severity] || severity}
    </span>
  );
}

export function Badge({ tone = 'neutral', children }) {
  return <span className={'badge badge-' + tone}>{children}</span>;
}

export function GroupChip({ group }) {
  return <span className="group-chip">{group || '?'}</span>;
}

export function Stat({ label, value, note }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}

const NOTICE_ICON = { critical: Icon.bang, warning: Icon.bang, ok: Icon.check, info: Icon.info };

export function Notice({ level = 'info', children }) {
  const Glyph = NOTICE_ICON[level] || Icon.info;
  return (
    <div className={'notice notice-' + level}>
      <span className="ico">{Glyph({ width: 12, height: 12 })}</span>
      <div>{children}</div>
    </div>
  );
}

export function Empty({ children = 'Nothing to show yet.' }) {
  return <div className="empty">{children}</div>;
}

export function Loading({ what = 'data' }) {
  return <div className="empty">Loading {what}...</div>;
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return (
    <Notice level="critical">
      <strong>{error.message}</strong>
      {error.details && typeof error.details === 'object' && (
        <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
          {Array.isArray(error.details.outstanding)
            ? error.details.outstanding.map((o) => <li key={o.id}>{o.text}</li>)
            : Array.isArray(error.details.blockers)
              ? error.details.blockers.map((b) => <li key={b}>{b}</li>)
              : Object.entries(error.details).map(([k, v]) => (
                  <li key={k}>{k}: {String(v)}</li>
                ))}
        </ul>
      )}
    </Notice>
  );
}

export function Field({ label, unit, error, children }) {
  return (
    <label className="field">
      <span>
        {label} {unit && <span className="unit">({unit})</span>}
      </span>
      {children}
      {error && <div className="err">{error}</div>}
    </label>
  );
}

/**
 * Dark/light toggle. Starts from the OS setting; once the viewer picks a mode
 * it is stored and applied at startup, before the first render.
 */
export function ThemeToggle() {
  const [theme, setThemeState] = useState(getTheme);

  // Resolve 'system' to what the OS is actually showing, so the button offers
  // the opposite of what is on screen rather than always offering dark.
  const effective = theme !== 'system'
    ? theme
    : (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  const next = effective === 'dark' ? 'light' : 'dark';

  return (
    <button
      className="sm"
      onClick={() => { setTheme(next); setThemeState(next); }}
      title={'Switch to ' + next + ' theme'}
    >
      {next === 'light' ? Icon.sun({ width: 13, height: 13 }) : Icon.moon({ width: 13, height: 13 })}
      {next === 'light' ? 'Light' : 'Dark'}
    </button>
  );
}

export function SafetyBar() {
  return (
    <div className="safety-bar" role="note">
      <span className="ico">{Icon.alert({ width: 14, height: 14 })}</span>
      <span>
        <strong>Academic prototype.</strong>{' '}
        All patient, donor and inventory records shown are synthetic. HemoWise does not diagnose,
        does not decide whether to transfuse, and does not perform crossmatching. Every clinical
        decision rests with a qualified clinician.
      </span>
    </div>
  );
}
