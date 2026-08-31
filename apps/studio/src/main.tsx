import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './daemon-auth';
import { App } from './App';
import { I18nProvider } from './i18n/i18n';
import { ThemeProvider } from './theme/theme';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
);
