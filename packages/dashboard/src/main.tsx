import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from './lib/theme';
import { AuthProvider } from './lib/auth';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);

// Disable service worker caching for now to avoid stale deploys in production.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        registration.unregister().catch(() => {});
      });
    }).catch(() => {});
  });
}

// Clear legacy client-side caches created by older service worker revisions.
if ('caches' in window) {
  window.addEventListener('load', () => {
    caches.keys().then((keys) => {
      keys
        .filter((key) => key.startsWith('glyphor-'))
        .forEach((key) => {
          caches.delete(key).catch(() => {});
        });
    }).catch(() => {});
  });
}
