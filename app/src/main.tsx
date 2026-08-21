import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';

// Root boundary (0.9.14): until now only the Marketplace overlay was guarded,
// so a throw anywhere else unmounted the whole tree — the "window goes
// black" failure. Now the failure is legible (surface + stack, Reload
// button) and the crash log records the same detail.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary surface="2ndMonitor" allowReload>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
