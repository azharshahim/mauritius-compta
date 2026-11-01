import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App';
import { I18nProvider } from './i18n';
import { SessionProvider } from './store';
import { demoEnabled } from './demo/mode';
import './styles.css';

// The GitHub Pages build is served without server-side rewrites: hash routing
// keeps every deep link working. The real application keeps clean URLs.
// Apply the saved theme before React renders to avoid a light flash in dark mode.
document.documentElement.dataset.theme =
  localStorage.getItem('mc.theme') === 'dark' ? 'dark' : 'light';

const Router = demoEnabled ? HashRouter : BrowserRouter;
if (demoEnabled) document.body.classList.add('demo-mode');

// Installability shell (manifest + icons). The worker never caches, so the
// application stays online-only and the demo switch remains the single source
// of fictional data. Registration is skipped in development.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const base = import.meta.env.BASE_URL;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => undefined);
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <SessionProvider>
        <Router>
          <App />
        </Router>
      </SessionProvider>
    </I18nProvider>
  </StrictMode>,
);
