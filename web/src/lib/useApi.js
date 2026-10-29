import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

/** Fetch a path, with loading/error state and a refetch handle. */
export function useApi(path, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    if (!path) { setLoading(false); return; }
    let live = true;
    setLoading(true);
    api.get(path)
      .then((d) => { if (live) { setData(d); setError(null); } })
      .catch((e) => { if (live) setError(e); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [path]);

  useEffect(() => {
    const cancel = reload();
    return cancel;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  return { data, error, loading, reload };
}

export const fmtDate = (s) => (s ? String(s).slice(0, 10) : '-');

export const fmtDateTime = (s) => {
  if (!s) return '-';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(s).slice(0, 16).replace('T', ' ');
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export const titleCase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
