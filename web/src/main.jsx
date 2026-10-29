import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { AuthProvider } from './lib/auth.jsx';
import App from './App.jsx';
import { applyStoredTheme } from './lib/theme.js';
import './styles.css';

// Applied before the first render so the sign-in screen honours the stored
// preference too -- the toggle only lives inside the signed-in shell.
applyStoredTheme();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </StrictMode>,
);
