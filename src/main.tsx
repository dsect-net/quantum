import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { bootTheme } from './theme';
import App from './App';

// Boot the persisted theme (dark by default) before rendering.
bootTheme().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
