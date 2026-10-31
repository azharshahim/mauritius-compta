import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App';
import { I18nProvider } from './i18n';
import { SessionProvider } from './store';
import { demoEnabled } from './demo';
import './styles.css';

// The GitHub Pages build is served without server-side rewrites: hash routing
// keeps every deep link working. The real application keeps clean URLs.
const Router = demoEnabled ? HashRouter : BrowserRouter;
if (demoEnabled) document.body.classList.add('demo-mode');

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
