import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { DatabaseProvider } from './database/provider';
import { markStart } from './utils/perf';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

markStart('app-bootstrap');

root.render(
  <React.StrictMode>
    <HashRouter>
      <DatabaseProvider>
        <App />
      </DatabaseProvider>
    </HashRouter>
  </React.StrictMode>
);
