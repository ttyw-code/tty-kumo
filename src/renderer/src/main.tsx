import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@/renderer/src/app';
import { ThemeProvider } from '@/renderer/src/components/theme/theme-context';
import '@/renderer/src/assets/main.css';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement,
);
root.render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
