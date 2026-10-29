import { createContext, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) { setReady(true); return; }
    api.get('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => setToken(null))
      .finally(() => setReady(true));
  }, []);

  const login = async (username, password) => {
    const d = await api.post('/auth/login', { username, password });
    setToken(d.token);
    setUser(d.user);
    return d.user;
  };

  const logout = async () => {
    try { await api.post('/auth/logout'); } catch { /* already gone */ }
    setToken(null);
    setUser(null);
  };

  const can = (...roles) => !!user && (user.role === 'admin' || roles.includes(user.role));

  return <AuthCtx.Provider value={{ user, ready, login, logout, can }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
