const KEY = 'hemowise.theme';

/** 'system' | 'light' | 'dark'. 'system' defers to the OS setting. */
export function getTheme() {
  try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; }
}

export function setTheme(theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  try { localStorage.setItem(KEY, theme); } catch { /* storage blocked */ }
}

/** Called once at startup, before the first render. */
export function applyStoredTheme() {
  const theme = getTheme();
  if (theme !== 'system') document.documentElement.setAttribute('data-theme', theme);
}
