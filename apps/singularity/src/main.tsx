/**
 * Entry point — mounts The Singularity. Theme is applied before first paint
 * so a dark-mode user never sees a white flash (docs/MEMORY.md: light
 * default, real dark mode via data-theme).
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyTheme, loadTheme } from './lib/store';
import './styles.css';

applyTheme(loadTheme());

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element missing from index.html');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// PWA: register the offline shell in production only — dev builds skip the
// service worker so HMR stays predictable. API traffic is never cached
// (public/sw.js), so the feed stays live and honest.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // SW registration is a progressive enhancement — never block the app.
    });
  });
}
